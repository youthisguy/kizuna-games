#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, String, Vec,
};

#[contracttype]
pub enum DataKey {
    Game(u64),
    NextId,
    EscrowContract,
    AllGames,
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

#[derive(Clone)]
#[contracttype]
pub struct MoveRecord {
    pub player:       Address,
    pub san:          String,
    pub move_number:  u32,
    pub fen_after:    String,
    pub committed_at: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct GameState {
    pub game_id:      u64,
    pub white:        Address,
    pub black:        Address,
    pub phase:        GamePhase,
    pub outcome:      GameOutcome,
    pub moves:        Vec<MoveRecord>,
    pub current_fen:  String,
    pub move_timeout: u64,
    pub created_at:   u64,
    pub last_move_at: u64,
    pub pgn_hash:     String,
    pub escrow_id:    u64,
}

const STARTING_FEN: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

#[contract]
pub struct KingFallGame;

#[contractimpl]
impl KingFallGame {

    pub fn initialize(env: Env, escrow_contract: Address) {
        assert!(
            !env.storage().instance().has(&DataKey::EscrowContract),
            "already initialized"
        );
        env.storage().instance().set(&DataKey::EscrowContract, &escrow_contract);
    }

    pub fn create_game(
        env:          Env,
        white:        Address,
        black:        Address,
        escrow_id:    u64,
        move_timeout: u64,
    ) -> u64 {
        white.require_auth();
        assert!(white != black, "players must be different");

        let id  = Self::next_id(&env);
        let now = env.ledger().timestamp();

        let state = GameState {
            game_id:      id,
            white:        white.clone(),
            black:        black.clone(),
            phase:        GamePhase::Active,
            outcome:      GameOutcome::Undecided,
            moves:        Vec::new(&env),
            current_fen:  String::from_str(&env, STARTING_FEN),
            move_timeout,
            created_at:   now,
            last_move_at: now,
            pgn_hash:     String::from_str(&env, ""),
            escrow_id,
        };

        env.storage().instance().set(&DataKey::Game(id), &state);
        Self::index_all(&env, id);

        env.events().publish(
            (symbol_short!("kfg"), symbol_short!("created"), id),
            (white, black, escrow_id),
        );

        id
    }

    // commit_move records a move onchain.
    // fen_after: the FEN string of the board after this move (computed client-side).
    // Either player must call this for each move — both white and black.
    // Turn order is enforced: white on even half-moves, black on odd.

    pub fn commit_move(
        env:       Env,
        id:        u64,
        player:    Address,
        san:       String,
        fen_after: String,
    ) {
        player.require_auth();

        let mut state: GameState = Self::load_game(&env, id);

        assert!(state.phase == GamePhase::Active, "game not active");
        assert!(
            player == state.white || player == state.black,
            "not a player"
        );

        let total = state.moves.len();
        let expected = if total % 2 == 0 { state.white.clone() } else { state.black.clone() };
        assert!(player == expected, "not your turn");

        let now = env.ledger().timestamp();
        if state.move_timeout > 0 {
            assert!(now <= state.last_move_at + state.move_timeout, "move timeout exceeded");
        }

        let move_number = (total / 2) + 1;

        state.moves.push_back(MoveRecord {
            player:       player.clone(),
            san:          san.clone(),
            move_number,
            fen_after:    fen_after.clone(),
            committed_at: now,
        });
        state.current_fen  = fen_after.clone();
        state.last_move_at = now;
        env.storage().instance().set(&DataKey::Game(id), &state);

        env.events().publish(
            (symbol_short!("kfg"), symbol_short!("move"), id),
            (player, san, move_number, fen_after),
        );
    }

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
        assert!(caller == state.white || caller == state.black, "not a player");
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

    pub fn resign(env: Env, id: u64, caller: Address) {
        caller.require_auth();
        let state: GameState = Self::load_game(&env, id);
        assert!(state.phase == GamePhase::Active, "game not active");
        assert!(caller == state.white || caller == state.black, "not a player");

        let outcome = if caller == state.white { GameOutcome::BlackWins } else { GameOutcome::WhiteWins };
        Self::complete_game_internal(env, id, caller, outcome, String::from_str(&state.white.env(), "resign"));
    }

    pub fn mark_settled(env: Env, id: u64) {
        let escrow: Address = env.storage().instance().get(&DataKey::EscrowContract).expect("not initialized");
        escrow.require_auth();
        let mut state: GameState = Self::load_game(&env, id);
        assert!(state.phase == GamePhase::Completed, "game not completed");
        state.phase = GamePhase::Settled;
        env.storage().instance().set(&DataKey::Game(id), &state);
        env.events().publish((symbol_short!("kfg"), symbol_short!("settled"), id), state.escrow_id);
    }

    pub fn claim_abandonment(env: Env, id: u64, caller: Address) {
        caller.require_auth();
        let mut state: GameState = Self::load_game(&env, id);
        assert!(state.phase == GamePhase::Active, "game not active");
        assert!(caller == state.white || caller == state.black, "not a player");
        assert!(state.move_timeout > 0, "no move timeout set");
        assert!(env.ledger().timestamp() > state.last_move_at + state.move_timeout, "timeout not reached");

        let outcome = if caller == state.white { GameOutcome::WhiteWins } else { GameOutcome::BlackWins };
        state.phase   = GamePhase::Abandoned;
        state.outcome = outcome.clone();
        env.storage().instance().set(&DataKey::Game(id), &state);
        env.events().publish((symbol_short!("kfg"), symbol_short!("abandoned"), id), (caller, outcome));
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

    pub fn get_current_fen(env: Env, id: u64) -> String {
        Self::load_game(&env, id).current_fen
    }

    pub fn get_turn(env: Env, id: u64) -> Address {
        let state = Self::load_game(&env, id);
        if state.moves.len() % 2 == 0 { state.white } else { state.black }
    }

    pub fn get_all_games(env: Env) -> Vec<u64> {
        env.storage().instance().get(&DataKey::AllGames).unwrap_or(Vec::new(&env))
    }

    // ── Private ──

    fn load_game(env: &Env, id: u64) -> GameState {
        env.storage().instance().get(&DataKey::Game(id)).expect("game not found")
    }

    fn next_id(env: &Env) -> u64 {
        let key = DataKey::NextId;
        let mut id: u64 = env.storage().instance().get(&key).unwrap_or(0);
        id += 1;
        env.storage().instance().set(&key, &id);
        id
    }

    fn index_all(env: &Env, id: u64) {
        let mut list: Vec<u64> = env.storage().instance().get(&DataKey::AllGames).unwrap_or(Vec::new(env));
        list.push_back(id);
        env.storage().instance().set(&DataKey::AllGames, &list);
    }
}