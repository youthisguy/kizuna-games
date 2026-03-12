#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, String, Vec,
};

#[contracttype]
pub enum DataKey {
    Game(u64),   
    NextId,        
    EscrowContract, // address of the escrow contract (set on init)
}

#[derive(Clone, PartialEq)]
#[contracttype]
pub enum GamePhase {
    Active,
    Completed,
    Settled,
    Abandoned,
}

#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub enum GameOutcome {
    WhiteWins,
    BlackWins,
    Draw,
    Undecided,
}

// Moves are stored in Standard Algebraic Notation (SAN), e.g. "e4", "Nf3", "O-O"
// `committed_at` is the ledger timestamp used for timeout enforcement.

#[derive(Clone)]
#[contracttype]
pub struct MoveRecord {
    pub player:       Address,
    pub san:          String,  
    pub move_number:  u32,       
    pub committed_at: u64,  
}

#[derive(Clone)]
#[contracttype]
pub struct GameState {
    pub game_id:       u64,
    pub white:         Address,
    pub black:         Address,
    pub phase:         GamePhase,
    pub outcome:       GameOutcome,
    pub moves:         Vec<MoveRecord>,
    pub move_timeout:  u64,      // seconds a player has to move (0 = no timeout)
    pub created_at:    u64,
    pub last_move_at:  u64,
    pub pgn_hash:      String,   // SHA-256 of full PGN, committed on completion
    pub escrow_id:     u64,      // corresponding escrow game_id for cross-contract link
}

#[contract]
pub struct KingFallGame;

#[contractimpl]
impl KingFallGame {
    pub fn initialize(env: Env, escrow_contract: Address) {
        assert!(
            !env.storage().instance().has(&DataKey::EscrowContract),
            "already initialized"
        );
        env.storage()
            .instance()
            .set(&DataKey::EscrowContract, &escrow_contract);
    }

    // Called after both players have staked in the escrow contract.
    // `escrow_id` links this game record to the corresponding escrow entry.
    // `move_timeout` = 0 means no per-move clock.

    pub fn create_game(
        env:          Env,
        white:        Address,
        black:        Address,
        escrow_id:    u64,
        move_timeout: u64,
    ) -> u64 {
        white.require_auth();

        assert!(white != black, "players must be different");

        let id = Self::next_id(&env);
        let now = env.ledger().timestamp();

        let state = GameState {
            game_id:      id,
            white:        white.clone(),
            black:        black.clone(),
            phase:        GamePhase::Active,
            outcome:      GameOutcome::Undecided,
            moves:        Vec::new(&env),
            move_timeout,
            created_at:   now,
            last_move_at: now,
            pgn_hash:     String::from_str(&env, ""),
            escrow_id,
        };

        env.storage().instance().set(&DataKey::Game(id), &state);

        env.events().publish(
            (symbol_short!("kfg"), symbol_short!("created"), id),
            (white, black, escrow_id),
        );

        id
    }

    // Either player submits their move in SAN.
    // Enforces turn order white moves on odd half-moves (1,3,5..),
    // black on even (2,4,6..).
    // If move_timeout is set, rejects a move submitted after the window.

    pub fn commit_move(
        env:    Env,
        id:     u64,
        player: Address,
        san:    String,
    ) {
        player.require_auth();

        let mut state: GameState = Self::load_game(&env, id);

        assert!(state.phase == GamePhase::Active, "game not active");
        assert!(
            player == state.white || player == state.black,
            "not a player"
        );

        let total_half_moves = state.moves.len();

        // White moves on half-moves 0, 2, 4 ... (even index)
        // Black moves on half-moves 1, 3, 5 ... (odd index)
        let expected_player = if total_half_moves % 2 == 0 {
            state.white.clone()
        } else {
            state.black.clone()
        };
        assert!(player == expected_player, "not your turn");

        // Enforce per-move timeout
        let now = env.ledger().timestamp();
        if state.move_timeout > 0 {
            assert!(
                now <= state.last_move_at + state.move_timeout,
                "move timeout exceeded — use claim_abandonment"
            );
        }

        let move_number = (total_half_moves / 2) + 1;

        let record = MoveRecord {
            player: player.clone(),
            san: san.clone(),
            move_number,
            committed_at: now,
        };

        state.moves.push_back(record);
        state.last_move_at = now;
        env.storage().instance().set(&DataKey::Game(id), &state);

        env.events().publish(
            (symbol_short!("kfg"), symbol_short!("move"), id),
            (player, san, move_number),
        );
    }

    // Either player submits the final outcome + SHA-256 hash of the full PGN.
    // This transitions the game to Completed and the frontend then calls
    // finish_game on the escrow contract with the same pgn_hash.
    //
    // Both players must agree on the outcome (or use resign for a unilateral end).

    pub fn complete_game(
        env:      Env,
        id:       u64,
        caller:   Address,
        outcome:  GameOutcome,
        pgn_hash: String,
    ) {
        caller.require_auth();
        Self::complete_game_internal(env, id, caller, outcome, pgn_hash);
    }

    fn complete_game_internal(
        env:      Env,
        id:       u64,
        caller:   Address,
        outcome:  GameOutcome,
        pgn_hash: String,
    ) {
        let mut state: GameState = Self::load_game(&env, id);

        assert!(state.phase == GamePhase::Active, "game not active");
        assert!(
            caller == state.white || caller == state.black,
            "not a player"
        );
        assert!(outcome != GameOutcome::Undecided, "must submit a real outcome");

        state.phase    = GamePhase::Completed;
        state.outcome  = outcome.clone();
        state.pgn_hash = pgn_hash.clone();
        env.storage().instance().set(&DataKey::Game(id), &state);

        env.events().publish(
            (symbol_short!("kfg"), symbol_short!("completed"), id),
            (caller, outcome, pgn_hash),
        );
    }

    // A player unilaterally resigns so opponent wins immediately.
    // Convenience wrapper around complete_game.

    pub fn resign(env: Env, id: u64, caller: Address) {
        caller.require_auth();

        let state: GameState = Self::load_game(&env, id);

        assert!(state.phase == GamePhase::Active, "game not active");
        assert!(
            caller == state.white || caller == state.black,
            "not a player"
        );

        let outcome = if caller == state.white {
            GameOutcome::BlackWins
        } else {
            GameOutcome::WhiteWins
        };

        Self::complete_game_internal(
            env,
            id,
            caller,
            outcome,
            String::from_str(&state.white.env(), "resign"),
        );
    }

    // Called by the escrow contract after it has paid out, to mark this
    // game record as fully settled onchain.
    // Auth: only the registered escrow contract may call this.

    pub fn mark_settled(env: Env, id: u64) {
        let escrow: Address = env
            .storage()
            .instance()
            .get(&DataKey::EscrowContract)
            .expect("not initialized");

        escrow.require_auth();

        let mut state: GameState = Self::load_game(&env, id);
        assert!(state.phase == GamePhase::Completed, "game not completed");

        state.phase = GamePhase::Settled;
        env.storage().instance().set(&DataKey::Game(id), &state);

        env.events().publish(
            (symbol_short!("kfg"), symbol_short!("settled"), id),
            state.escrow_id,
        );
    }

    // If the opponent hasn't moved within move_timeout seconds,
    // the waiting player can mark the game Abandoned and claim via escrow.

    pub fn claim_abandonment(env: Env, id: u64, caller: Address) {
        caller.require_auth();

        let mut state: GameState = Self::load_game(&env, id);

        assert!(state.phase == GamePhase::Active, "game not active");
        assert!(
            caller == state.white || caller == state.black,
            "not a player"
        );
        assert!(state.move_timeout > 0, "no move timeout set");
        assert!(
            env.ledger().timestamp() > state.last_move_at + state.move_timeout,
            "timeout not reached"
        );

        // The caller is the one who waited, opponent forfeits
        let outcome = if caller == state.white {
            GameOutcome::WhiteWins
        } else {
            GameOutcome::BlackWins
        };

        state.phase   = GamePhase::Abandoned;
        state.outcome = outcome.clone();
        env.storage().instance().set(&DataKey::Game(id), &state);

        env.events().publish(
            (symbol_short!("kfg"), symbol_short!("abandoned"), id),
            (caller, outcome),
        );
    }

    // ── READS ──

    pub fn get_game(env: Env, id: u64) -> GameState {
        Self::load_game(&env, id)
    }

    pub fn get_moves(env: Env, id: u64) -> Vec<MoveRecord> {
        Self::load_game(&env, id).moves
    }

    pub fn get_move_count(env: Env, id: u64) -> u32 {
        Self::load_game(&env, id).moves.len()
    }

    pub fn get_turn(env: Env, id: u64) -> Address {
        let state = Self::load_game(&env, id);
        if state.moves.len() % 2 == 0 {
            state.white
        } else {
            state.black
        }
    }

    // ── Private ───

    fn load_game(env: &Env, id: u64) -> GameState {
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