#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};
 
#[contracttype]
enum DataKey {
    Admin,
    TotalSupply,
    Balance(Address),
    Allowance(Address, Address),  
    Initialized,
}

#[contract]
pub struct Token;

#[contractimpl]
impl Token {
    pub fn initialize(env: Env, admin: Address) {
        assert!(!env.storage().instance().has(&DataKey::Initialized), "already initialized");
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Admin, &admin);  
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        assert!(amount > 0, "amount must be positive");
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();   
        let mut supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        supply += amount;
        env.storage().instance().set(&DataKey::TotalSupply, &supply);
        let mut balance: i128 = env.storage().instance().get(&DataKey::Balance(to.clone())).unwrap_or(0);
        balance += amount;
        env.storage().instance().set(&DataKey::Balance(to), &balance);
    }

    pub fn balance(env: Env, addr: Address) -> i128 {
        env.storage().instance().get(&DataKey::Balance(addr)).unwrap_or(0)
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        assert!(amount > 0, "amount must be positive");
        let from_balance: i128 = env.storage().instance().get(&DataKey::Balance(from.clone())).unwrap_or(0);
        assert!(from_balance >= amount, "insufficient balance");
        env.storage().instance().set(&DataKey::Balance(from), &(from_balance - amount));
        let to_balance: i128 = env.storage().instance().get(&DataKey::Balance(to.clone())).unwrap_or(0);
        env.storage().instance().set(&DataKey::Balance(to), &(to_balance + amount));
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        assert!(amount > 0, "amount must be positive");
        let allowance: i128 = env.storage().instance().get(&DataKey::Allowance(from.clone(), spender.clone())).unwrap_or(0);
        assert!(allowance >= amount, "insufficient allowance");
        let from_balance: i128 = env.storage().instance().get(&DataKey::Balance(from.clone())).unwrap_or(0);
        assert!(from_balance >= amount, "insufficient balance");
        env.storage().instance().set(&DataKey::Allowance(from.clone(), spender), &(allowance - amount));
        env.storage().instance().set(&DataKey::Balance(from), &(from_balance - amount));
        let to_balance: i128 = env.storage().instance().get(&DataKey::Balance(to.clone())).unwrap_or(0);
        env.storage().instance().set(&DataKey::Balance(to), &(to_balance + amount));
    }

    pub fn approve(env: Env, owner: Address, spender: Address, amount: i128) {
        owner.require_auth();
        assert!(amount >= 0, "amount must be non-negative");
        env.storage().instance().set(&DataKey::Allowance(owner, spender), &amount);
    }

    pub fn allowance(env: Env, owner: Address, spender: Address) -> i128 {
        env.storage().instance().get(&DataKey::Allowance(owner, spender)).unwrap_or(0)
    }
}