use soroban_sdk::{symbol_short, Address, Env, String};

pub fn game_created(env: &Env, id: u64, white: Address, stake: i128, join_deadline: u64) {
    env.events().publish(
        (symbol_short!("kf"), symbol_short!("created"), id),
        (white, stake, join_deadline),
    );
}

pub fn game_joined(env: &Env, id: u64, black: Address) {
    env.events().publish(
        (symbol_short!("kf"), symbol_short!("joined"), id),
        black,
    );
}

pub fn game_finished(env: &Env, id: u64, winner: Address, winnings: i128, move_hash: String) {
    env.events().publish(
        (symbol_short!("kf"), symbol_short!("finished"), id),
        (winner, winnings, move_hash),
    );
}

pub fn game_drawn(env: &Env, id: u64, white: Address, black: Address, each: i128) {
    env.events().publish(
        (symbol_short!("kf"), symbol_short!("drawn"), id),
        (white, black, each),
    );
}

pub fn game_cancelled(env: &Env, id: u64, white: Address) {
    env.events().publish(
        (symbol_short!("kf"), symbol_short!("cancelled"), id),
        white,
    );
}

pub fn draw_offered(env: &Env, id: u64, offerer: Address) {
    env.events().publish(
        (symbol_short!("kf"), symbol_short!("drawoffer"), id),
        offerer,
    );
}

pub fn timeout_claimed(env: &Env, id: u64, claimer: Address, winnings: i128) {
    env.events().publish(
        (symbol_short!("kf"), symbol_short!("timeout"), id),
        (claimer, winnings),
    );
}