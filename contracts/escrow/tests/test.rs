#[cfg(test)]
mod tests {
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token, Address, Env, String,
    };

    use crate::{KingFallEscrow, KingFallEscrowClient, Outcome};

    // ── Test Helpers ──

    fn setup_env() -> Env {
        let env = Env::default();
        env.mock_all_auths();
        env
    }

    fn deploy_contract(env: &Env) -> KingFallEscrowClient {
        let id = env.register_contract(None, KingFallEscrow);
        KingFallEscrowClient::new(env, &id)
    }

    /// Creates a native XLM-like token, mints `amount` to `recipient`.
    fn create_token<'a>(
        env: &'a Env,
        admin: &Address,
        amount: i128,
    ) -> (Address, token::Client<'a>) {
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        token::StellarAssetClient::new(env, &asset.address()).mint(admin, &amount);
        let client = token::Client::new(env, &asset.address());
        (asset.address(), client)
    }

    fn pgn_hash(env: &Env) -> String {
        // Simulate a SHA-256 hex of a PGN string
        String::from_str(env, "a3f1b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2")
    }

    // ── 1. Create Game ───

    #[test]
    fn test_create_game_locks_stake() {
        let env = setup_env();
        let client = deploy_contract(&env);

        let white = Address::generate(&env);
        let (token_id, token) = create_token(&env, &white, 10_000_000);

        let id = client.create_game(&white, &token_id, &5_000_000i128, &0u64, &200u32);

        assert_eq!(id, 1u64);

        let game = client.get_game(&id);
        assert_eq!(game.stake,  5_000_000i128);
        assert_eq!(game.white,  white);
        assert_eq!(game.fee_bps, 200u32);

        // Contract holds white's stake
        assert_eq!(token.balance(&client.address), 5_000_000i128);
    }

    #[test]
    #[should_panic(expected = "stake must be positive")]
    fn test_create_game_rejects_zero_stake() {
        let env = setup_env();
        let client = deploy_contract(&env);
        let white = Address::generate(&env);
        let (token_id, _) = create_token(&env, &white, 1_000_000);
        client.create_game(&white, &token_id, &0i128, &0u64, &200u32);
    }

    #[test]
    #[should_panic(expected = "fee cannot exceed 10%")]
    fn test_create_game_rejects_excessive_fee() {
        let env = setup_env();
        let client = deploy_contract(&env);
        let white = Address::generate(&env);
        let (token_id, _) = create_token(&env, &white, 1_000_000);
        client.create_game(&white, &token_id, &1_000_000i128, &0u64, &1001u32);
    }

    // ── 2. Join Game ──

    #[test]
    fn test_join_game_activates_match() {
        let env = setup_env();
        let client = deploy_contract(&env);

        let white = Address::generate(&env);
        let black = Address::generate(&env);
        let (token_id, token) = create_token(&env, &white, 10_000_000);
        token.transfer(&white, &black, &5_000_000i128);

        let id = client.create_game(&white, &token_id, &5_000_000i128, &0u64, &200u32);
        client.join_game(&id, &black);

        let game = client.get_game(&id);
        assert_eq!(game.black, black);
        // status == Active (1)
        assert_eq!(client.get_pot(&id), 10_000_000i128);

        // Contract holds both stakes
        assert_eq!(token.balance(&client.address), 10_000_000i128);
    }

    #[test]
    #[should_panic(expected = "cannot play yourself")]
    fn test_join_own_game_rejected() {
        let env = setup_env();
        let client = deploy_contract(&env);
        let white = Address::generate(&env);
        let (token_id, _) = create_token(&env, &white, 10_000_000);
        let id = client.create_game(&white, &token_id, &5_000_000i128, &0u64, &200u32);
        client.join_game(&id, &white);
    }

    #[test]
    #[should_panic(expected = "join deadline passed")]
    fn test_join_after_deadline_rejected() {
        let env = setup_env();
        let client = deploy_contract(&env);

        let white = Address::generate(&env);
        let black = Address::generate(&env);
        let (token_id, token) = create_token(&env, &white, 10_000_000);
        token.transfer(&white, &black, &5_000_000i128);

        // Deadline at ledger time 100
        let id = client.create_game(&white, &token_id, &5_000_000i128, &100u64, &200u32);

        // Advance ledger past deadline
        env.ledger().set_timestamp(200);

        client.join_game(&id, &black);
    }

    // ── 3. White Wins ──

    #[test]
    fn test_white_wins_receives_pot_minus_fee() {
        let env = setup_env();
        let client = deploy_contract(&env);

        let white = Address::generate(&env);
        let black = Address::generate(&env);
        let (token_id, token) = create_token(&env, &white, 10_000_000);
        token.transfer(&white, &black, &5_000_000i128);

        let id = client.create_game(&white, &token_id, &5_000_000i128, &0u64, &200u32);
        client.join_game(&id, &black);

        // Pot = 10_000_000, fee = 2% = 200_000, winnings = 9_800_000
        client.finish_game(&id, &white, &Outcome::WhiteWins, &pgn_hash(&env));

        assert_eq!(token.balance(&white), 9_800_000i128);
        assert_eq!(token.balance(&black), 0i128);

        let game = client.get_game(&id);
        assert_eq!(game.move_hash, pgn_hash(&env));
    }

    // ── 4. Black Wins ──

    #[test]
    fn test_black_wins_receives_pot_minus_fee() {
        let env = setup_env();
        let client = deploy_contract(&env);

        let white = Address::generate(&env);
        let black = Address::generate(&env);
        let (token_id, token) = create_token(&env, &white, 10_000_000);
        token.transfer(&white, &black, &5_000_000i128);

        let id = client.create_game(&white, &token_id, &5_000_000i128, &0u64, &200u32);
        client.join_game(&id, &black);

        client.finish_game(&id, &black, &Outcome::BlackWins, &pgn_hash(&env));

        assert_eq!(token.balance(&black), 9_800_000i128);
        assert_eq!(token.balance(&white), 0i128);
    }

    // ── 5. Draw ──
    #[test]
    fn test_draw_splits_stake_equally() {
        let env = setup_env();
        let client = deploy_contract(&env);

        let white = Address::generate(&env);
        let black = Address::generate(&env);
        let (token_id, token) = create_token(&env, &white, 10_000_000);
        token.transfer(&white, &black, &5_000_000i128);

        let id = client.create_game(&white, &token_id, &5_000_000i128, &0u64, &200u32);
        client.join_game(&id, &black);

        // Draw: each gets 5_000_000 - 1% fee = 4_900_000
        // pot=10_000_000, fee=200_000, each = 5_000_000 - 100_000 = 4_900_000
        client.finish_game(&id, &white, &Outcome::Draw, &pgn_hash(&env));

        assert_eq!(token.balance(&white), 4_900_000i128);
        assert_eq!(token.balance(&black), 4_900_000i128);
    }

    // ── 6. Draw Handshake ─── 

    #[test]
    fn test_draw_offer_and_accept() {
        let env = setup_env();
        let client = deploy_contract(&env);

        let white = Address::generate(&env);
        let black = Address::generate(&env);
        let (token_id, token) = create_token(&env, &white, 10_000_000);
        token.transfer(&white, &black, &5_000_000i128);

        let id = client.create_game(&white, &token_id, &5_000_000i128, &0u64, &200u32);
        client.join_game(&id, &black);

        client.offer_draw(&id, &white);

        // draw_offered_by should be set
        let game = client.get_game(&id);
        assert!(game.draw_offered_by.is_some());

        client.accept_draw(&id, &black);

        // Both get their share back
        assert!(token.balance(&white) > 0);
        assert!(token.balance(&black) > 0);
    }

    #[test]
    #[should_panic(expected = "cannot accept your own draw offer")]
    fn test_cannot_accept_own_draw_offer() {
        let env = setup_env();
        let client = deploy_contract(&env);

        let white = Address::generate(&env);
        let black = Address::generate(&env);
        let (token_id, token) = create_token(&env, &white, 10_000_000);
        token.transfer(&white, &black, &5_000_000i128);

        let id = client.create_game(&white, &token_id, &5_000_000i128, &0u64, &200u32);
        client.join_game(&id, &black);
        client.offer_draw(&id, &white);
        client.accept_draw(&id, &white); // should panic
    }

    // ── 7. Cancel ──

    #[test]
    fn test_cancel_refunds_white_after_deadline() {
        let env = setup_env();
        let client = deploy_contract(&env);

        let white = Address::generate(&env);
        let (token_id, token) = create_token(&env, &white, 5_000_000);

        // Deadline at 100
        let id = client.create_game(&white, &token_id, &5_000_000i128, &100u64, &200u32);

        assert_eq!(token.balance(&white), 0i128); // locked

        env.ledger().set_timestamp(200); // advance past deadline
        client.cancel_game(&id);

        assert_eq!(token.balance(&white), 5_000_000i128); // refunded
    }

    #[test]
    #[should_panic(expected = "deadline not yet passed")]
    fn test_cancel_before_deadline_rejected() {
        let env = setup_env();
        let client = deploy_contract(&env);

        let white = Address::generate(&env);
        let (token_id, _) = create_token(&env, &white, 5_000_000);

        let id = client.create_game(&white, &token_id, &5_000_000i128, &9999u64, &200u32);

        // Ledger at 0, deadline at 9999 — should panic
        client.cancel_game(&id);
    }

    // ── 8. Timeout ───

    #[test]
    fn test_timeout_claim_pays_claimer() {
        let env = setup_env();
        let client = deploy_contract(&env);

        let white = Address::generate(&env);
        let black = Address::generate(&env);
        let (token_id, token) = create_token(&env, &white, 10_000_000);
        token.transfer(&white, &black, &5_000_000i128);

        let id = client.create_game(&white, &token_id, &5_000_000i128, &0u64, &200u32);
        client.join_game(&id, &black);

        // Timeout at ledger 500, advance past it
        env.ledger().set_timestamp(600);

        client.claim_timeout(&id, &white, &500u64);

        // White gets pot minus fee
        assert_eq!(token.balance(&white), 9_800_000i128);
    }

    #[test]
    #[should_panic(expected = "timeout not reached")]
    fn test_timeout_before_window_rejected() {
        let env = setup_env();
        let client = deploy_contract(&env);

        let white = Address::generate(&env);
        let black = Address::generate(&env);
        let (token_id, token) = create_token(&env, &white, 10_000_000);
        token.transfer(&white, &black, &5_000_000i128);

        let id = client.create_game(&white, &token_id, &5_000_000i128, &0u64, &200u32);
        client.join_game(&id, &black);

        // Ledger at 0, timeout at 500 — should panic
        client.claim_timeout(&id, &white, &500u64);
    }

    // ── 9. Non-player cannot finish ───

    #[test]
    #[should_panic(expected = "not a player")]
    fn test_stranger_cannot_finish_game() {
        let env = setup_env();
        let client = deploy_contract(&env);

        let white = Address::generate(&env);
        let black = Address::generate(&env);
        let stranger = Address::generate(&env);
        let (token_id, token) = create_token(&env, &white, 10_000_000);
        token.transfer(&white, &black, &5_000_000i128);

        let id = client.create_game(&white, &token_id, &5_000_000i128, &0u64, &200u32);
        client.join_game(&id, &black);

        client.finish_game(&id, &stranger, &Outcome::WhiteWins, &pgn_hash(&env));
    }

    // ── 10. get_pot returns correct values per phase ───

    #[test]
    fn test_get_pot_reflects_game_phase() {
        let env = setup_env();
        let client = deploy_contract(&env);

        let white = Address::generate(&env);
        let black = Address::generate(&env);
        let (token_id, token) = create_token(&env, &white, 10_000_000);
        token.transfer(&white, &black, &5_000_000i128);

        let id = client.create_game(&white, &token_id, &5_000_000i128, &0u64, &200u32);
        assert_eq!(client.get_pot(&id), 5_000_000i128);  

        client.join_game(&id, &black);
        assert_eq!(client.get_pot(&id), 10_000_000i128); 

        client.finish_game(&id, &white, &Outcome::WhiteWins, &pgn_hash(&env));
        assert_eq!(client.get_pot(&id), 0i128);  
    }
}