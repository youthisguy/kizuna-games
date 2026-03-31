use soroban_sdk::{
    testutils::{Address as _},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Vec,
};

use payout::{KingFallPayout, KingFallPayoutClient, PrizeAllocation};

fn setup_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env
}

fn deploy(env: &Env) -> KingFallPayoutClient<'_> {
    let id = env.register(KingFallPayout {}, ());
    KingFallPayoutClient::new(env, &id)
}

fn deploy_token(env: &Env, admin: &Address) -> Address {
    let asset = env.register_stellar_asset_contract_v2(admin.clone());
    asset.address()
}

fn mint(env: &Env, token: &Address, admin: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
    let _ = admin;
}

// ── Init ──────────────────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let env = setup_env();
    let client = deploy(&env);
    let admin   = Address::generate(&env);
    let escrow  = Address::generate(&env);
    let nft     = Address::generate(&env);
    client.initialize(&admin, &escrow, &nft);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice_rejected() {
    let env = setup_env();
    let client = deploy(&env);
    let admin  = Address::generate(&env);
    let escrow = Address::generate(&env);
    let nft    = Address::generate(&env);
    client.initialize(&admin, &escrow, &nft);
    client.initialize(&admin, &escrow, &nft);
}

// ── record_result ─────────────────────────────────────────────────────────────

#[test]
fn test_record_result_win_updates_stats_and_fee() {
    let env    = setup_env();
    let client = deploy(&env);
    let admin  = Address::generate(&env);
    let escrow = Address::generate(&env);
    let nft    = Address::generate(&env);
    let white  = Address::generate(&env);
    let black  = Address::generate(&env);
    let token  = deploy_token(&env, &admin);

    client.initialize(&admin, &escrow, &nft);

    client.record_result(
        &1u64,
        &Some(white.clone()),
        &Some(black.clone()),
        &token,
        &150_000i128,
        &9_850_000i128,
        &false,
        &white,
        &black,
    );

    assert_eq!(client.fee_balance(&token), 150_000i128);
    let stats = client.get_stats(&white);
    assert_eq!(stats.wins, 1u32);
    assert_eq!(stats.earned, 9_850_000i128);
    let loser_stats = client.get_stats(&black);
    assert_eq!(loser_stats.losses, 1u32);
    assert_eq!(loser_stats.earned, 0i128);
}

#[test]
fn test_record_result_draw_updates_both_players() {
    let env    = setup_env();
    let client = deploy(&env);
    let admin  = Address::generate(&env);
    let escrow = Address::generate(&env);
    let nft    = Address::generate(&env);
    let white  = Address::generate(&env);
    let black  = Address::generate(&env);
    let token  = deploy_token(&env, &admin);

    client.initialize(&admin, &escrow, &nft);

    client.record_result(
        &1u64,
        &None,
        &None,
        &token,
        &150_000i128,
        &4_925_000i128,
        &true,
        &white,
        &black,
    );

    let ws = client.get_stats(&white);
    let bs = client.get_stats(&black);
    assert_eq!(ws.draws, 1u32);
    assert_eq!(bs.draws, 1u32);
    assert_eq!(ws.earned, 4_925_000i128);
    assert_eq!(bs.earned, 4_925_000i128);
}

#[test]
fn test_record_result_accumulates_fees_across_games() {
    let env    = setup_env();
    let client = deploy(&env);
    let admin  = Address::generate(&env);
    let escrow = Address::generate(&env);
    let nft    = Address::generate(&env);
    let token  = deploy_token(&env, &admin);
    let white  = Address::generate(&env);
    let black  = Address::generate(&env);

    client.initialize(&admin, &escrow, &nft);

    for i in 0u64..3 {
        client.record_result(
            &i,
            &Some(white.clone()),
            &Some(black.clone()),
            &token,
            &150_000i128,
            &9_850_000i128,
            &false,
            &white,
            &black,
        );
    }

    assert_eq!(client.fee_balance(&token), 450_000i128);
    assert_eq!(client.get_stats(&white).wins, 3u32);
}

// ── Fee withdrawal ────────────────────────────────────────────────────────────

#[test]
fn test_withdraw_fees() {
    let env      = setup_env();
    let client   = deploy(&env);
    let admin    = Address::generate(&env);
    let escrow   = Address::generate(&env);
    let nft      = Address::generate(&env);
    let token    = deploy_token(&env, &admin);
    let treasury = Address::generate(&env);
    let white    = Address::generate(&env);
    let black    = Address::generate(&env);

    mint(&env, &token, &admin, &client.address, 150_000i128);
    client.initialize(&admin, &escrow, &nft);

    client.record_result(
        &1u64,
        &Some(white.clone()),
        &Some(black.clone()),
        &token,
        &150_000i128,
        &9_850_000i128,
        &false,
        &white,
        &black,
    );

    client.withdraw_fees(&token, &150_000i128, &treasury);

    assert_eq!(client.fee_balance(&token), 0i128);
    assert_eq!(TokenClient::new(&env, &token).balance(&treasury), 150_000i128);
}

#[test]
#[should_panic(expected = "insufficient fee balance")]
fn test_withdraw_fees_exceeds_balance() {
    let env    = setup_env();
    let client = deploy(&env);
    let admin  = Address::generate(&env);
    let escrow = Address::generate(&env);
    let nft    = Address::generate(&env);
    let token  = deploy_token(&env, &admin);
    let to     = Address::generate(&env);

    client.initialize(&admin, &escrow, &nft);
    client.withdraw_fees(&token, &1i128, &to);
}

// ── Prize pool ────────────────────────────────────────────────────────────────

#[test]
fn test_fund_prize_pool() {
    let env    = setup_env();
    let client = deploy(&env);
    let admin  = Address::generate(&env);
    let escrow = Address::generate(&env);
    let nft    = Address::generate(&env);
    let token  = deploy_token(&env, &admin);
    let funder = Address::generate(&env);

    mint(&env, &token, &admin, &funder, 1_000_000i128);
    client.initialize(&admin, &escrow, &nft);

    client.fund_prize_pool(&funder, &token, &1_000_000i128);
    assert_eq!(client.prize_pool_balance(&token), 1_000_000i128);
}

#[test]
fn test_distribute_season() {
    let env    = setup_env();
    let client = deploy(&env);
    let admin  = Address::generate(&env);
    let escrow = Address::generate(&env);
    let nft    = Address::generate(&env);
    let token  = deploy_token(&env, &admin);
    let p1     = Address::generate(&env);
    let p2     = Address::generate(&env);

    mint(&env, &token, &admin, &client.address, 1_000_000i128);
    client.initialize(&admin, &escrow, &nft);
    client.fund_prize_pool(&client.address, &token, &1_000_000i128);

    client.start_season();
    client.end_season();

    let mut allocs = Vec::new(&env);
    allocs.push_back(PrizeAllocation { player: p1.clone(), amount: 600_000i128 });
    allocs.push_back(PrizeAllocation { player: p2.clone(), amount: 400_000i128 });

    client.distribute_season(&token, &allocs);

    assert_eq!(TokenClient::new(&env, &token).balance(&p1), 600_000i128);
    assert_eq!(TokenClient::new(&env, &token).balance(&p2), 400_000i128);
    assert_eq!(client.prize_pool_balance(&token), 0i128);
}

#[test]
#[should_panic(expected = "end the season before distributing")]
fn test_distribute_during_active_season_rejected() {
    let env    = setup_env();
    let client = deploy(&env);
    let admin  = Address::generate(&env);
    let escrow = Address::generate(&env);
    let nft    = Address::generate(&env);
    let token  = deploy_token(&env, &admin);

    client.initialize(&admin, &escrow, &nft);
    client.start_season();

    let allocs = Vec::new(&env);
    client.distribute_season(&token, &allocs);
}

#[test]
#[should_panic(expected = "prize pool insufficient")]
fn test_distribute_exceeds_pool_rejected() {
    let env    = setup_env();
    let client = deploy(&env);
    let admin  = Address::generate(&env);
    let escrow = Address::generate(&env);
    let nft    = Address::generate(&env);
    let token  = deploy_token(&env, &admin);
    let p1     = Address::generate(&env);

    client.initialize(&admin, &escrow, &nft);

    let mut allocs = Vec::new(&env);
    allocs.push_back(PrizeAllocation { player: p1, amount: 1_000_000i128 });
    client.distribute_season(&token, &allocs);
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

#[test]
fn test_snapshot_and_get_leaderboard() {
    let env    = setup_env();
    let client = deploy(&env);
    let admin  = Address::generate(&env);
    let escrow = Address::generate(&env);
    let nft    = Address::generate(&env);
    let p1     = Address::generate(&env);
    let p2     = Address::generate(&env);

    client.initialize(&admin, &escrow, &nft);

    let mut players = Vec::new(&env);
    players.push_back(p1.clone());
    players.push_back(p2.clone());
    client.snapshot_leaderboard(&players);

    let board = client.get_leaderboard();
    assert_eq!(board.len(), 2u32);
    assert_eq!(board.get(0).unwrap(), p1);
    assert_eq!(board.get(1).unwrap(), p2);
}

// ── Admin ─────────────────────────────────────────────────────────────────────

#[test]
fn test_transfer_admin() {
    let env       = setup_env();
    let client    = deploy(&env);
    let admin     = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let escrow    = Address::generate(&env);
    let nft       = Address::generate(&env);
    let token    = deploy_token(&env, &admin);
    let to       = Address::generate(&env);

    client.initialize(&admin, &escrow, &nft);
    client.transfer_admin(&new_admin);
}