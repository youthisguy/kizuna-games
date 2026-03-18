#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, String, Vec};

mod events;

#[cfg(not(feature = "testutils"))]
mod payout {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32-unknown-unknown/release/payout.wasm"
    );
}

#[cfg(feature = "testutils")]
extern crate std;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Game(u64),
    NextId,
    PayoutContract,
    ActiveGames,
    PlayerGames(Address),
}

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
    pub id: u64,
    pub white: Address,
    pub black: Address,
    pub stake: i128,
    pub token: Address,
    pub status: GameStatus,
    pub created_at: u64,
    pub join_deadline: u64,
    pub move_hash: String,
    pub draw_offered_by: Option<Address>,
}

#[contract]
pub struct KingFallEscrow;

#[contractimpl]
impl KingFallEscrow {
    const FEE_BPS: u32 = 150;

    pub fn set_payout_contract(env: Env, caller: Address, payout: Address) {
        caller.require_auth();
        assert!(
            !env.storage().instance().has(&DataKey::PayoutContract),
            "payout already set"
        );
        env.storage().instance().set(&DataKey::PayoutContract, &payout);
    }

    pub fn create_game(
        env: Env,
        white: Address,
        token: Address,
        stake: i128,
        join_deadline: u64,
    ) -> u64 {
        white.require_auth();
        assert!(stake > 0, "stake must be positive");
        let contract = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&white, &contract, &stake);
        let id = Self::next_id(&env);
        let data = GameData {
            id,
            white: white.clone(),
            black: white.clone(),
            stake,
            token,
            status: GameStatus::Waiting,
            created_at: env.ledger().timestamp(),
            join_deadline,
            move_hash: String::from_str(&env, ""),
            draw_offered_by: None,
        };
        env.storage().instance().set(&DataKey::Game(id), &data);
        Self::index_active(&env, id);
        Self::index_player(&env, &white, id);
        events::game_created(&env, id, white, stake, join_deadline);
        id
    }

    pub fn join_game(env: Env, id: u64, black: Address) {
        black.require_auth();
        let mut data: GameData = Self::load_game(&env, id);
        assert!(data.status == GameStatus::Waiting, "game not open");
        assert!(data.white != black, "cannot play yourself");
        if data.join_deadline > 0 {
            assert!(
                env.ledger().timestamp() <= data.join_deadline,
                "join deadline passed"
            );
        }
        let contract = env.current_contract_address();
        token::Client::new(&env, &data.token).transfer(&black, &contract, &data.stake);
        data.black = black.clone();
        data.status = GameStatus::Active;
        env.storage().instance().set(&DataKey::Game(id), &data);
        Self::remove_active(&env, id);
        Self::index_player(&env, &black, id);
        events::game_joined(&env, id, black);
    }

    pub fn finish_game(
        env: Env,
        id: u64,
        caller: Address,
        outcome: Outcome,
        move_hash: String,
    ) {
        caller.require_auth();
        Self::finish_game_internal(env, id, caller, outcome, move_hash);
    }

    fn finish_game_internal(
        env: Env,
        id: u64,
        caller: Address,
        outcome: Outcome,
        move_hash: String,
    ) {
        let mut data: GameData = Self::load_game(&env, id);
        assert!(data.status == GameStatus::Active, "game not active");
        assert!(
            caller == data.white || caller == data.black,
            "not a player"
        );

        let pot = data.stake * 2;
        let fee = pot * (Self::FEE_BPS as i128) / 10_000;
        let client = token::Client::new(&env, &data.token);
        let contract = env.current_contract_address();

        let (winner, loser, winnings, is_draw) = match outcome {
            Outcome::WhiteWins => {
                let w = pot - fee;
                client.transfer(&contract, &data.white, &w);
                (Some(data.white.clone()), Some(data.black.clone()), w, false)
            }
            Outcome::BlackWins => {
                let w = pot - fee;
                client.transfer(&contract, &data.black, &w);
                (Some(data.black.clone()), Some(data.white.clone()), w, false)
            }
            Outcome::Draw => {
                let each = pot / 2 - fee / 2;
                client.transfer(&contract, &data.white, &each);
                client.transfer(&contract, &data.black, &each);
                (None, None, each, true)
            }
        };

        data.status = if is_draw { GameStatus::Drawn } else { GameStatus::Finished };
        data.move_hash = move_hash.clone();
        env.storage().instance().set(&DataKey::Game(id), &data);

        if is_draw {
            events::game_drawn(&env, id, data.white.clone(), data.black.clone(), winnings);
        } else {
            events::game_finished(&env, id, winner.clone().unwrap(), winnings, move_hash);
        }

        #[cfg(not(feature = "testutils"))]
        if let Some(payout_addr) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::PayoutContract)
        {
            payout::Client::new(&env, &payout_addr).record_result(
                &id,
                &winner,
                &loser,
                &data.token,
                &fee,
                &winnings,
                &is_draw,
                &data.white,
                &data.black,
            );
        }
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
        let offerer = data.draw_offered_by.clone().expect("no draw offered");
        assert!(caller != offerer, "cannot accept your own draw offer");
        assert!(
            caller == data.white || caller == data.black,
            "not a player"
        );
        Self::finish_game_internal(
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
        assert!(data.status == GameStatus::Waiting, "can only cancel a waiting game");
        data.status = GameStatus::Cancelled;
        env.storage().instance().set(&DataKey::Game(id), &data);
        Self::remove_active(&env, id);
        let client = token::Client::new(&env, &data.token);
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
        let pot = data.stake * 2;
        let fee = pot * (Self::FEE_BPS as i128) / 10_000;
        let winnings = pot - fee;
        data.status = GameStatus::Timeout;
        env.storage().instance().set(&DataKey::Game(id), &data);
        let client = token::Client::new(&env, &data.token);
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
            GameStatus::Waiting => data.stake,
            GameStatus::Active => data.stake * 2,
            _ => 0,
        }
    }

    pub fn get_active_games(env: Env) -> Vec<u64> {
        env.storage()
            .instance()
            .get(&DataKey::ActiveGames)
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_player_games(env: Env, player: Address) -> Vec<u64> {
        env.storage()
            .instance()
            .get(&DataKey::PlayerGames(player))
            .unwrap_or(Vec::new(&env))
    }

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

    fn index_active(env: &Env, id: u64) {
        let mut list: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveGames)
            .unwrap_or(Vec::new(env));
        list.push_back(id);
        env.storage().instance().set(&DataKey::ActiveGames, &list);
    }

    fn remove_active(env: &Env, id: u64) {
        let list: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveGames)
            .unwrap_or(Vec::new(env));
        let mut updated: Vec<u64> = Vec::new(env);
        for item in list.iter() {
            if item != id { updated.push_back(item); }
        }
        env.storage().instance().set(&DataKey::ActiveGames, &updated);
    }

    fn index_player(env: &Env, player: &Address, id: u64) {
        let key = DataKey::PlayerGames(player.clone());
        let mut list: Vec<u64> = env
            .storage()
            .instance()
            .get(&key)
            .unwrap_or(Vec::new(env));
        list.push_back(id);
        env.storage().instance().set(&key, &list);
    }
}