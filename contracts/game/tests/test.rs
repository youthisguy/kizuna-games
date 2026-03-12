use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String,
};

use game::{GameOutcome, KingFallGame, KingFallGameClient};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env
}

fn deploy(env: &Env) -> KingFallGameClient<'_> {
    let id = env.register(KingFallGame {}, ());
    KingFallGameClient::new(env, &id)
}

fn san(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

fn pgn(env: &Env) -> String {
    String::from_str(env, "a3f1b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2")
}

// ── Init ──────────────────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let env = setup_env();
    let client = deploy(&env);
    let escrow = Address::generate(&env);
    client.initialize(&escrow);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice_rejected() {
    let env = setup_env();
    let client = deploy(&env);
    let escrow = Address::generate(&env);
    client.initialize(&escrow);
    client.initialize(&escrow);
}

// ── Create ────────────────────────────────────────────────────────────────────

#[test]
fn test_create_game() {
    let env = setup_env();
    let client = deploy(&env);
    let white = Address::generate(&env);
    let black = Address::generate(&env);

    let id = client.create_game(&white, &black, &1u64, &0u64);

    assert_eq!(id, 1u64);
    let state = client.get_game(&id);
    assert_eq!(state.white, white);
    assert_eq!(state.black, black);
    assert_eq!(state.escrow_id, 1u64);
    assert_eq!(client.get_move_count(&id), 0u32);
}

#[test]
#[should_panic(expected = "players must be different")]
fn test_create_game_same_player_rejected() {
    let env = setup_env();
    let client = deploy(&env);
    let white = Address::generate(&env);
    client.create_game(&white, &white, &1u64, &0u64);
}

// ── Moves ─────────────────────────────────────────────────────────────────────

#[test]
fn test_commit_moves_alternates_turns() {
    let env = setup_env();
    let client = deploy(&env);
    let white = Address::generate(&env);
    let black = Address::generate(&env);

    let id = client.create_game(&white, &black, &1u64, &0u64);

    // White opens
    client.commit_move(&id, &white, &san(&env, "e4"));
    assert_eq!(client.get_move_count(&id), 1u32);
    assert_eq!(client.get_turn(&id), black);

    // Black responds
    client.commit_move(&id, &black, &san(&env, "e5"));
    assert_eq!(client.get_move_count(&id), 2u32);
    assert_eq!(client.get_turn(&id), white);

    // Scholar's mate setup
    client.commit_move(&id, &white, &san(&env, "Qh5"));
    client.commit_move(&id, &black, &san(&env, "Nc6"));
    client.commit_move(&id, &white, &san(&env, "Bc4"));
    client.commit_move(&id, &black, &san(&env, "Nf6"));

    assert_eq!(client.get_move_count(&id), 6u32);
}

#[test]
#[should_panic(expected = "not your turn")]
fn test_wrong_turn_rejected() {
    let env = setup_env();
    let client = deploy(&env);
    let white = Address::generate(&env);
    let black = Address::generate(&env);

    let id = client.create_game(&white, &black, &1u64, &0u64);

    // Black tries to move first
    client.commit_move(&id, &black, &san(&env, "e5"));
}

#[test]
#[should_panic(expected = "not a player")]
fn test_stranger_cannot_move() {
    let env = setup_env();
    let client = deploy(&env);
    let white = Address::generate(&env);
    let black = Address::generate(&env);
    let stranger = Address::generate(&env);

    let id = client.create_game(&white, &black, &1u64, &0u64);
    client.commit_move(&id, &stranger, &san(&env, "e4"));
}

// ── Complete ──────────────────────────────────────────────────────────────────

#[test]
fn test_complete_game_white_wins() {
    let env = setup_env();
    let client = deploy(&env);
    let white = Address::generate(&env);
    let black = Address::generate(&env);

    let id = client.create_game(&white, &black, &1u64, &0u64);
    client.commit_move(&id, &white, &san(&env, "e4"));
    client.commit_move(&id, &black, &san(&env, "e5"));

    client.complete_game(&id, &white, &GameOutcome::WhiteWins, &pgn(&env));

    let state = client.get_game(&id);
    assert_eq!(state.outcome, GameOutcome::WhiteWins);
    assert_eq!(state.pgn_hash, pgn(&env));
}

#[test]
#[should_panic(expected = "must submit a real outcome")]
fn test_complete_with_undecided_rejected() {
    let env = setup_env();
    let client = deploy(&env);
    let white = Address::generate(&env);
    let black = Address::generate(&env);

    let id = client.create_game(&white, &black, &1u64, &0u64);
    client.complete_game(&id, &white, &GameOutcome::Undecided, &pgn(&env));
}

#[test]
#[should_panic(expected = "game not active")]
fn test_cannot_complete_twice() {
    let env = setup_env();
    let client = deploy(&env);
    let white = Address::generate(&env);
    let black = Address::generate(&env);

    let id = client.create_game(&white, &black, &1u64, &0u64);
    client.complete_game(&id, &white, &GameOutcome::WhiteWins, &pgn(&env));
    client.complete_game(&id, &white, &GameOutcome::BlackWins, &pgn(&env));
}

// ── Resign ────────────────────────────────────────────────────────────────────

#[test]
fn test_resign_gives_win_to_opponent() {
    let env = setup_env();
    let client = deploy(&env);
    let white = Address::generate(&env);
    let black = Address::generate(&env);

    let id = client.create_game(&white, &black, &1u64, &0u64);
    client.commit_move(&id, &white, &san(&env, "e4"));

    // White resigns > black wins
    client.resign(&id, &white);

    let state = client.get_game(&id);
    assert_eq!(state.outcome, GameOutcome::BlackWins);
}

#[test]
fn test_black_resign_gives_white_win() {
    let env = setup_env();
    let client = deploy(&env);
    let white = Address::generate(&env);
    let black = Address::generate(&env);

    let id = client.create_game(&white, &black, &1u64, &0u64);
    client.commit_move(&id, &white, &san(&env, "e4"));
    client.commit_move(&id, &black, &san(&env, "e5"));
    client.resign(&id, &black);

    let state = client.get_game(&id);
    assert_eq!(state.outcome, GameOutcome::WhiteWins);
}

// ── Abandonment ───────────────────────────────────────────────────────────────

#[test]
fn test_claim_abandonment_after_timeout() {
    let env = setup_env();
    let client = deploy(&env);
    let white = Address::generate(&env);
    let black = Address::generate(&env);

    // 300 second move timeout
    let id = client.create_game(&white, &black, &1u64, &300u64);
    client.commit_move(&id, &white, &san(&env, "e4"));

    // Advance past timeout
    env.ledger().set_timestamp(400);
    client.claim_abandonment(&id, &white);

    let state = client.get_game(&id);
    assert_eq!(state.outcome, GameOutcome::WhiteWins);
}

#[test]
#[should_panic(expected = "timeout not reached")]
fn test_abandonment_before_timeout_rejected() {
    let env = setup_env();
    let client = deploy(&env);
    let white = Address::generate(&env);
    let black = Address::generate(&env);

    let id = client.create_game(&white, &black, &1u64, &300u64);
    client.commit_move(&id, &white, &san(&env, "e4"));

    // Ledger at 0 — timeout hasn't passed
    client.claim_abandonment(&id, &white);
}

#[test]
#[should_panic(expected = "no move timeout set")]
fn test_abandonment_without_timeout_rejected() {
    let env = setup_env();
    let client = deploy(&env);
    let white = Address::generate(&env);
    let black = Address::generate(&env);

    // move_timeout = 0
    let id = client.create_game(&white, &black, &1u64, &0u64);
    client.claim_abandonment(&id, &white);
}

// ── Reads ─────────────────────────────────────────────────────────────────────

#[test]
fn test_get_moves_returns_full_history() {
    let env = setup_env();
    let client = deploy(&env);
    let white = Address::generate(&env);
    let black = Address::generate(&env);

    let id = client.create_game(&white, &black, &1u64, &0u64);
    client.commit_move(&id, &white, &san(&env, "d4"));
    client.commit_move(&id, &black, &san(&env, "d5"));
    client.commit_move(&id, &white, &san(&env, "c4"));

    let moves = client.get_moves(&id);
    assert_eq!(moves.len(), 3u32);
    assert_eq!(moves.get(0).unwrap().san, san(&env, "d4"));
    assert_eq!(moves.get(1).unwrap().san, san(&env, "d5"));
    assert_eq!(moves.get(2).unwrap().san, san(&env, "c4"));
}

#[test]
fn test_get_turn_is_correct() {
    let env = setup_env();
    let client = deploy(&env);
    let white = Address::generate(&env);
    let black = Address::generate(&env);

    let id = client.create_game(&white, &black, &1u64, &0u64);
    assert_eq!(client.get_turn(&id), white);

    client.commit_move(&id, &white, &san(&env, "e4"));
    assert_eq!(client.get_turn(&id), black);
}