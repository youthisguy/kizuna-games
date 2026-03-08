#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, String};

mod events;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Game(u64),   
    NextId,  
}

// ── Game Phases ───
//
//  0 = WAITING   — white created the game, waiting for black to join & stake
//  1 = ACTIVE    — both players staked, match is live
//  2 = FINISHED  — winner claimed the pot
//  3 = DRAWN     — both players agreed draw, stakes returned minus fee
//  4 = CANCELLED — black never joined before deadline; white refunded
//  5 = TIMEOUT   — active game abandoned; opponent can claim after timeout

#[derive(Clone, PartialEq)]
#[contracttype]
pub enum GameStatus {
    Waiting,
    Active,
    Finished,
    Drawn,
    Cancelled,
    Timeout,
}

#[derive(Clone, PartialEq)]
#[contracttype]
pub enum Outcome {
    WhiteWins,
    BlackWins,
    Draw,
}

#[derive(Clone)]
#[contracttype]
pub struct GameData {
    pub white:          Address,       
    pub black:          Address,      
    pub stake:          i128,          
    pub token:          Address,      
    pub status:         GameStatus,
    pub created_at:     u64,         
    pub join_deadline:  u64,      
    pub move_hash:      String,        
    pub draw_offered_by: Option<Address>,  
}
 
#[contract]
pub struct KingFallEscrow;

#[contractimpl]
impl KingFallEscrow {

    const FEE_BPS: u32 = 150; // 1.5% protocol fee 

    pub fn create_game(
        env:           Env,
        white:         Address,
        token:         Address,
        stake:         i128,
        join_deadline: u64,
    ) -> u64 {
        white.require_auth();

        assert!(stake > 0, "stake must be positive");
  
 
        let contract = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&white, &contract, &stake);

        let id = Self::next_id(&env);

        let data = GameData {
            white:           white.clone(),
            black:           white.clone(), 
            stake,
            token,
            status:          GameStatus::Waiting,
            created_at:      env.ledger().timestamp(),
            join_deadline,
            move_hash:       String::from_str(&env, ""),
            draw_offered_by: None,
        };

        env.storage().instance().set(&DataKey::Game(id), &data);
        events::game_created(&env, id, white, stake, join_deadline);

        id
    }

 

    pub fn join_game(env: Env, id: u64, black: Address) {
        black.require_auth();

        let mut data: GameData = Self::load_game(&env, id);

        assert!(data.status == GameStatus::Waiting, "game not open");
        assert!(data.white != black,                "cannot play yourself");

        // Enforce join deadline if set
        if data.join_deadline > 0 {
            assert!(
                env.ledger().timestamp() <= data.join_deadline,
                "join deadline passed"
            );
        }

 
        let contract = env.current_contract_address();
        token::Client::new(&env, &data.token).transfer(&black, &contract, &data.stake);

        data.black  = black.clone();
        data.status = GameStatus::Active;
        env.storage().instance().set(&DataKey::Game(id), &data);

        events::game_joined(&env, id, black);
    }
 
    pub fn finish_game(
        env:       Env,
        id:        u64,
        caller:    Address,
        outcome:   Outcome,
        move_hash: String,
    ) {
        caller.require_auth();

        let mut data: GameData = Self::load_game(&env, id);

        assert!(data.status == GameStatus::Active, "game not active");
        assert!(
            caller == data.white || caller == data.black,
            "not a player"
        );

        let pot      = data.stake * 2;
        let fee      = pot * (Self::FEE_BPS as i128) / 10_000;
        let winnings = pot - fee;

        let client   = token::Client::new(&env, &data.token);
        let contract = env.current_contract_address();

        let winner = match outcome {
            Outcome::WhiteWins => {
                client.transfer(&contract, &data.white, &winnings);
                data.white.clone()
            }
            Outcome::BlackWins => {
                client.transfer(&contract, &data.black, &winnings);
                data.black.clone()
            }
            Outcome::Draw => {
 
                let each = pot / 2 - fee / 2;
                client.transfer(&contract, &data.white, &each);
                client.transfer(&contract, &data.black, &each);
                data.status    = GameStatus::Drawn;
                data.move_hash = move_hash.clone();
                env.storage().instance().set(&DataKey::Game(id), &data);
                events::game_drawn(&env, id, data.white.clone(), data.black.clone(), each);
                return;
            }
        };

        data.status    = GameStatus::Finished;
        data.move_hash = move_hash.clone();
        env.storage().instance().set(&DataKey::Game(id), &data);

        events::game_finished(&env, id, winner.clone(), winnings, move_hash);
    }

 

    pub fn offer_draw(env: Env, id: u64, caller: Address) {
        caller.require_auth();

        let mut data: GameData = Self::load_game(&env, id);

        assert!(data.status == GameStatus::Active, "game not active");
        assert!(
            caller == data.white || caller == data.black,
            "not a player"
        );
        assert!(data.draw_offered_by.is_none(), "draw already offered");

        data.draw_offered_by = Some(caller.clone());
        env.storage().instance().set(&DataKey::Game(id), &data);

        events::draw_offered(&env, id, caller);
    }

    pub fn accept_draw(env: Env, id: u64, caller: Address) {
        caller.require_auth();

        let data: GameData = Self::load_game(&env, id);

        assert!(data.status == GameStatus::Active, "game not active");

        let offerer = data.draw_offered_by.clone()
            .expect("no draw offered");

        assert!(caller != offerer, "cannot accept your own draw offer");
        assert!(
            caller == data.white || caller == data.black,
            "not a player"
        );
 
        Self::finish_game(
            env,
            id,
            caller,
            Outcome::Draw,
            String::from_str(&data.token.env(), "draw-agreed"),
        );
    }

 

    pub fn cancel_game(env: Env, id: u64) {
        let mut data: GameData = Self::load_game(&env, id);

        data.white.require_auth();
        assert!(data.status == GameStatus::Waiting, "game not waiting");

        if data.join_deadline > 0 {
            assert!(
                env.ledger().timestamp() > data.join_deadline,
                "deadline not yet passed"
            );
        }

        data.status = GameStatus::Cancelled;
        env.storage().instance().set(&DataKey::Game(id), &data);

        let client   = token::Client::new(&env, &data.token);
        let contract = env.current_contract_address();
        client.transfer(&contract, &data.white, &data.stake);

        events::game_cancelled(&env, id, data.white.clone());
    }

 

    pub fn claim_timeout(env: Env, id: u64, caller: Address, timeout_at: u64) {
        caller.require_auth();

        let mut data: GameData = Self::load_game(&env, id);

        assert!(data.status == GameStatus::Active, "game not active");
        assert!(
            caller == data.white || caller == data.black,
            "not a player"
        );
        assert!(
            env.ledger().timestamp() > timeout_at,
            "timeout not reached"
        );

        let pot      = data.stake * 2;
        let fee      = pot * (Self::FEE_BPS as i128) / 10_000;
        let winnings = pot - fee;

        data.status = GameStatus::Timeout;
        env.storage().instance().set(&DataKey::Game(id), &data);

        let client   = token::Client::new(&env, &data.token);
        let contract = env.current_contract_address();
        client.transfer(&contract, &caller, &winnings);

        events::timeout_claimed(&env, id, caller, winnings);
    }

  
    pub fn get_game(env: Env, id: u64) -> GameData {
        Self::load_game(&env, id)
    }

    pub fn get_pot(env: Env, id: u64) -> i128 {
        let data: GameData = Self::load_game(&env, id);
        match data.status {
            GameStatus::Waiting  => data.stake,           
            GameStatus::Active   => data.stake * 2,
            _                    => 0,                   
        }
    }

    // ── Private Helpers ───

    fn load_game(env: &Env, id: u64) -> GameData {
        env.storage()
            .instance()
            .get(&DataKey::Game(id))
            .expect("game not found")
    }

    fn next_id(env: &Env) -> u64 {
        let key = DataKey::NextId;
        let mut id: u64 = env.storage().instance().get(&key).unwrap_or(0);
        id += 1;
        env.storage().instance().set(&key, &id);
        id
    }
}