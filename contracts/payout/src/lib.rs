#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype,
    symbol_short, token, Address, Env, Vec,
};

#[contracttype]
pub enum DataKey {
    Admin,
    EscrowContract,
    NftContract,
    FeeBalance(Address),   // token > accumulated fees
    PrizePool(Address),    // token > prize pool balance
    LeaderboardEntry(Address), // player > LifetimeStats
    TopPlayers,            // Vec<Address> — ordered leaderboard snapshot
    SeasonActive,
    SeasonId,
}

#[derive(Clone)]
#[contracttype]
pub struct LifetimeStats {
    pub player:  Address,
    pub wins:    u32,
    pub losses:  u32,
    pub draws:   u32,
    pub earned:  i128,
}

#[derive(Clone)]
#[contracttype]
pub struct PrizeAllocation {
    pub player: Address,
    pub amount: i128,
}

#[contract]
pub struct KingFallPayout;

#[contractimpl]
impl KingFallPayout {
    pub fn initialize(
        env:              Env,
        admin:            Address,
        escrow_contract:  Address,
        nft_contract:     Address,
    ) {
        assert!(
            !env.storage().instance().has(&DataKey::Admin),
            "already initialized"
        );
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::EscrowContract, &escrow_contract);
        env.storage().instance().set(&DataKey::NftContract, &nft_contract);
        env.storage().instance().set(&DataKey::SeasonActive, &false);
        env.storage().instance().set(&DataKey::SeasonId, &0u32);
    }

    // Called by the escrow contract after finish_game.
    // Deposits fee into treasury, updates leaderboard stats,
    // and triggers NFT mint for the winner if applicable.

    pub fn record_result(
        env:       Env,
        game_id:   u64,
        winner:    Option<Address>,
        loser:     Option<Address>,
        token:     Address,
        fee:       i128,
        winnings:  i128,
        is_draw:   bool,
        white:     Address,
        black:     Address,
    ) {
        let escrow: Address = env
            .storage()
            .instance()
            .get(&DataKey::EscrowContract)
            .expect("not initialized");
        escrow.require_auth();

        assert!(fee >= 0, "fee cannot be negative");

        Self::accumulate_fee(&env, &token, fee);

        if is_draw {
            Self::update_stats(&env, &white, 0, 0, 1, winnings);
            Self::update_stats(&env, &black, 0, 0, 1, winnings);
        } else if let (Some(w), Some(l)) = (winner.clone(), loser.clone()) {
            Self::update_stats(&env, &w, 1, 0, 0, winnings);
            Self::update_stats(&env, &l, 0, 1, 0, 0);
            Self::trigger_nft_mint(&env, game_id, &w);
        }

        env.events().publish(
            (symbol_short!("kfp"), symbol_short!("result"), game_id),
            (winner, fee, is_draw),
        );
    }

    // ── FEE TREASURY ───

    pub fn withdraw_fees(env: Env, token: Address, amount: i128, to: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        assert!(amount > 0, "amount must be positive");

        let balance: i128 = env
            .storage()
            .instance()
            .get(&DataKey::FeeBalance(token.clone()))
            .unwrap_or(0);

        assert!(balance >= amount, "insufficient fee balance");

        env.storage()
            .instance()
            .set(&DataKey::FeeBalance(token.clone()), &(balance - amount));

        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );

        env.events().publish(
            (symbol_short!("kfp"), symbol_short!("feewith"), token),
            (to, amount),
        );
    }

    pub fn fee_balance(env: Env, token: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::FeeBalance(token))
            .unwrap_or(0)
    }

    // ── PRIZE POOL ───

    pub fn fund_prize_pool(env: Env, funder: Address, token: Address, amount: i128) {
        funder.require_auth();
        assert!(amount > 0, "amount must be positive");

        token::Client::new(&env, &token).transfer(
            &funder,
            &env.current_contract_address(),
            &amount,
        );

        let current: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PrizePool(token.clone()))
            .unwrap_or(0);

        env.storage()
            .instance()
            .set(&DataKey::PrizePool(token.clone()), &(current + amount));

        env.events().publish(
            (symbol_short!("kfp"), symbol_short!("funded"), token),
            (funder, amount),
        );
    }

    pub fn prize_pool_balance(env: Env, token: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::PrizePool(token))
            .unwrap_or(0)
    }

    // Admin builds allocation list off-chain from leaderboard snapshot,
    // then calls distribute_season to push prize pool funds to players.

    pub fn start_season(env: Env) -> u32 {
        Self::require_admin(&env);

        let mut id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::SeasonId)
            .unwrap_or(0);
        id += 1;

        env.storage().instance().set(&DataKey::SeasonId, &id);
        env.storage().instance().set(&DataKey::SeasonActive, &true);

        env.events().publish(
            (symbol_short!("kfp"), symbol_short!("season"), id),
            true,
        );

        id
    }

    pub fn end_season(env: Env) {
        Self::require_admin(&env);

        let active: bool = env
            .storage()
            .instance()
            .get(&DataKey::SeasonActive)
            .unwrap_or(false);
        assert!(active, "no active season");

        env.storage().instance().set(&DataKey::SeasonActive, &false);

        let id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::SeasonId)
            .unwrap_or(0);

        env.events().publish(
            (symbol_short!("kfp"), symbol_short!("season"), id),
            false,
        );
    }

    pub fn distribute_season(
        env:         Env,
        token:       Address,
        allocations: Vec<PrizeAllocation>,
    ) {
        Self::require_admin(&env);

        let active: bool = env
            .storage()
            .instance()
            .get(&DataKey::SeasonActive)
            .unwrap_or(false);
        assert!(!active, "end the season before distributing");

        let total: i128 = allocations.iter().map(|a| a.amount).sum();
        let pool: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PrizePool(token.clone()))
            .unwrap_or(0);

        assert!(pool >= total, "prize pool insufficient for allocations");

        let token_client = token::Client::new(&env, &token);

        for alloc in allocations.iter() {
            assert!(alloc.amount > 0, "allocation must be positive");
            token_client.transfer(
                &env.current_contract_address(),
                &alloc.player,
                &alloc.amount,
            );
        }

        env.storage()
            .instance()
            .set(&DataKey::PrizePool(token.clone()), &(pool - total));

        let season_id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::SeasonId)
            .unwrap_or(0);

        env.events().publish(
            (symbol_short!("kfp"), symbol_short!("distrib"), season_id),
            (token, total),
        );
    }

    // ── LEADERBOARD ──

    pub fn get_stats(env: Env, player: Address) -> LifetimeStats {
        env.storage()
            .instance()
            .get(&DataKey::LeaderboardEntry(player.clone()))
            .unwrap_or(LifetimeStats {
                player,
                wins:   0,
                losses: 0,
                draws:  0,
                earned: 0,
            })
    }

    pub fn snapshot_leaderboard(env: Env, players: Vec<Address>) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::TopPlayers, &players);
    }

    pub fn get_leaderboard(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::TopPlayers)
            .unwrap_or(Vec::new(&env))
    }

    // ── ADMIN ───
    pub fn transfer_admin(env: Env, new_admin: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events().publish(
            (symbol_short!("kfp"), symbol_short!("admin")),
            new_admin,
        );
    }

    pub fn update_nft_contract(env: Env, nft_contract: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::NftContract, &nft_contract);
    }

    pub fn update_escrow_contract(env: Env, escrow_contract: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::EscrowContract, &escrow_contract);
    }

    // ── Private ──

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
    }

    fn accumulate_fee(env: &Env, token: &Address, fee: i128) {
        if fee == 0 {
            return;
        }
        let current: i128 = env
            .storage()
            .instance()
            .get(&DataKey::FeeBalance(token.clone()))
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::FeeBalance(token.clone()), &(current + fee));
    }

    fn update_stats(
        env:     &Env,
        player:  &Address,
        wins:    u32,
        losses:  u32,
        draws:   u32,
        earned:  i128,
    ) {
        let key = DataKey::LeaderboardEntry(player.clone());
        let mut stats: LifetimeStats = env
            .storage()
            .instance()
            .get(&key)
            .unwrap_or(LifetimeStats {
                player:  player.clone(),
                wins:    0,
                losses:  0,
                draws:   0,
                earned:  0,
            });
        stats.wins   += wins;
        stats.losses += losses;
        stats.draws  += draws;
        stats.earned += earned;
        env.storage().instance().set(&key, &stats);
    }

    fn trigger_nft_mint(env: &Env, game_id: u64, winner: &Address) {
        let nft: Address = env
            .storage()
            .instance()
            .get(&DataKey::NftContract)
            .expect("nft contract not set");

        env.events().publish(
            (symbol_short!("kfp"), symbol_short!("nftmint"), game_id),
            (nft, winner.clone()),
        );
    }
}