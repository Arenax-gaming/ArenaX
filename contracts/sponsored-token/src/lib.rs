//! Branded sponsor assets distributed on Stellar (Issue #1258).
//!
//! Each sponsor registers one custom asset with display metadata. A participant
//! must open a trustline before the admin can distribute tokens from that
//! sponsor's pool. Distribution is the Soroban entry point the backend calls.

#![no_std]
#![allow(clippy::too_many_arguments)]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Bytes, Env, String, Symbol,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SponsorAsset {
    pub asset_code: String,
    pub name: String,
    pub logo_url: String,
    pub color: String,
    pub issuer: Address,
    pub pool: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
enum DataKey {
    Admin,
    Sponsor(Symbol),
    Trustline(Symbol, Address),
    Balance(Symbol, Address),
}

#[contract]
pub struct SponsoredToken;

#[allow(deprecated)]
#[contractimpl]
impl SponsoredToken {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Register one custom asset and its brand metadata.
    pub fn register_sponsor(
        env: Env,
        sponsor_id: Symbol,
        asset_code: String,
        name: String,
        logo_url: String,
        color: String,
        issuer: Address,
        pool: i128,
    ) {
        require_admin(&env);
        if env
            .storage()
            .instance()
            .has(&DataKey::Sponsor(sponsor_id.clone()))
        {
            panic!("sponsor already registered");
        }
        if pool <= 0 {
            panic!("pool must be positive");
        }
        assert_asset_code(&asset_code);
        assert_brand(&env, &name, &logo_url, &color);
        let asset = SponsorAsset {
            asset_code,
            name,
            logo_url,
            color,
            issuer,
            pool,
        };
        env.storage()
            .instance()
            .set(&DataKey::Sponsor(sponsor_id.clone()), &asset);
        env.events()
            .publish((symbol_short!("brand"), sponsor_id), asset.pool);
    }

    /// Participant opts in to hold the sponsor's asset.
    pub fn open_trustline(env: Env, sponsor_id: Symbol, participant: Address) {
        let _asset = load_sponsor(&env, &sponsor_id);
        participant.require_auth();
        env.storage().persistent().set(
            &DataKey::Trustline(sponsor_id.clone(), participant.clone()),
            &true,
        );
        env.events()
            .publish((symbol_short!("trust"), sponsor_id), participant);
    }

    /// Move tokens from the sponsor pool to a participant who has a trustline.
    pub fn distribute(env: Env, sponsor_id: Symbol, recipient: Address, amount: i128) -> i128 {
        require_admin(&env);
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let mut asset = load_sponsor(&env, &sponsor_id);
        if !trustline_open(&env, &sponsor_id, &recipient) {
            panic!("recipient has no trustline");
        }
        if amount > asset.pool {
            panic!("amount exceeds sponsor pool");
        }
        asset.pool -= amount;
        let current: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(sponsor_id.clone(), recipient.clone()))
            .unwrap_or(0);
        let next = current + amount;
        env.storage()
            .instance()
            .set(&DataKey::Sponsor(sponsor_id.clone()), &asset);
        env.storage().persistent().set(
            &DataKey::Balance(sponsor_id.clone(), recipient.clone()),
            &next,
        );
        env.events()
            .publish((symbol_short!("dist"), sponsor_id), amount);
        next
    }

    pub fn brand(env: Env, sponsor_id: Symbol) -> SponsorAsset {
        load_sponsor(&env, &sponsor_id)
    }

    pub fn balance(env: Env, sponsor_id: Symbol, account: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(sponsor_id, account))
            .unwrap_or(0)
    }

    pub fn has_trustline(env: Env, sponsor_id: Symbol, account: Address) -> bool {
        trustline_open(&env, &sponsor_id, &account)
    }
}

fn require_admin(env: &Env) {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("not initialized");
    admin.require_auth();
}

fn load_sponsor(env: &Env, sponsor_id: &Symbol) -> SponsorAsset {
    env.storage()
        .instance()
        .get(&DataKey::Sponsor(sponsor_id.clone()))
        .expect("unknown sponsor")
}

fn trustline_open(env: &Env, sponsor_id: &Symbol, account: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Trustline(sponsor_id.clone(), account.clone()))
        .unwrap_or(false)
}

fn assert_asset_code(code: &String) {
    let bytes = code.to_bytes();
    let len = bytes.len();
    if !(1..=12).contains(&len) {
        panic!("asset code must be 1-12 characters");
    }
    let mut index = 0u32;
    while index < len {
        let byte = bytes.get(index).unwrap_or(0);
        if !byte.is_ascii_alphanumeric() {
            panic!("asset code must be 1-12 characters");
        }
        index += 1;
    }
}

fn assert_brand(env: &Env, name: &String, logo_url: &String, color: &String) {
    if name.is_empty() || name.len() > 64 {
        panic!("brand name must be 1-64 characters");
    }
    let color_bytes = color.to_bytes();
    if color_bytes.len() != 7 || color_bytes.get(0).unwrap_or(0) != b'#' {
        panic!("brand color must be #rrggbb");
    }
    let mut hex = 1u32;
    while hex < color_bytes.len() {
        let byte = color_bytes.get(hex).unwrap_or(0);
        let ok =
            byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte) || (b'A'..=b'F').contains(&byte);
        if !ok {
            panic!("brand color must be #rrggbb");
        }
        hex += 1;
    }
    let logo = logo_url.to_bytes();
    let prefix = Bytes::from_slice(env, b"https://");
    if logo.len() < prefix.len() {
        panic!("logo url must be https");
    }
    let mut index = 0u32;
    while index < prefix.len() {
        if logo.get(index).unwrap_or(0) != prefix.get(index).unwrap_or(0) {
            panic!("logo url must be https");
        }
        index += 1;
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{symbol_short, testutils::Address as _, Env};

    fn setup(env: &Env) -> (SponsoredTokenClient<'_>, Address, Address) {
        env.mock_all_auths();
        let contract_id = env.register(SponsoredToken, ());
        let client = SponsoredTokenClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let issuer = Address::generate(env);
        client.initialize(&admin);
        (client, admin, issuer)
    }

    #[test]
    fn distribute_requires_a_trustline_and_stays_inside_the_pool() {
        let env = Env::default();
        let (client, _admin, issuer) = setup(&env);
        let sponsor = symbol_short!("acme");
        let code = String::from_str(&env, "ACME");
        client.register_sponsor(
            &sponsor,
            &code,
            &String::from_str(&env, "Acme Cup"),
            &String::from_str(&env, "https://cdn.example/acme.png"),
            &String::from_str(&env, "#112233"),
            &issuer,
            &1_000,
        );

        let brand = client.brand(&sponsor);
        assert_eq!(brand.pool, 1_000);
        assert_eq!(brand.color, String::from_str(&env, "#112233"));

        let player = Address::generate(&env);
        let err = client.try_distribute(&sponsor, &player, &10);
        assert!(err.is_err());

        client.open_trustline(&sponsor, &player);
        assert!(client.has_trustline(&sponsor, &player));
        assert_eq!(client.distribute(&sponsor, &player, &10), 10);
        assert_eq!(client.balance(&sponsor, &player), 10);
        assert_eq!(client.brand(&sponsor).pool, 990);

        assert!(client.try_distribute(&sponsor, &player, &991).is_err());
    }

    #[test]
    #[should_panic(expected = "asset code must be 1-12 characters")]
    fn asset_code_longer_than_twelve_is_rejected() {
        let env = Env::default();
        let (client, _admin, issuer) = setup(&env);
        let long = String::from_str(&env, "ABCDEFGHIJKLM");
        client.register_sponsor(
            &symbol_short!("acme"),
            &long,
            &String::from_str(&env, "Acme"),
            &String::from_str(&env, "https://cdn.example/acme.png"),
            &String::from_str(&env, "#112233"),
            &issuer,
            &10,
        );
    }
}
