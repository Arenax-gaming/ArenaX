#![no_std]

//! On-chain analytics contract for ArenaX.
//!
//! Privacy model:
//! - Individual player data is stored under a salted hash of the player address.
//! - Raw addresses are never emitted in events; only hashed identifiers are used.
//! - Aggregated platform metrics are public.

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, BytesN, Env};

// ─── Types ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameMetrics {
    pub game_id: u32,
    pub total_matches: u64,
    pub total_players: u64,
    pub total_wagered: i128,
    pub total_rewards_paid: i128,
    pub avg_match_duration_secs: u64,
    pub last_updated: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformMetrics {
    pub total_matches_all_time: u64,
    pub active_players_30d: u64,
    pub total_staked: i128,
    pub total_volume: i128,
    pub last_updated: u64,
}

/// Privacy-preserving player behaviour snapshot.
/// Stored under hash(salt || player_address) — never the raw address.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerBehaviourSnapshot {
    /// Hashed player identifier (privacy-preserving)
    pub player_hash: BytesN<32>,
    pub game_id: u32,
    pub matches_played: u64,
    pub wins: u64,
    pub losses: u64,
    pub avg_session_secs: u64,
    pub last_seen_bucket: u64, // Unix timestamp rounded to nearest day
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MatchRecorded {
    pub game_id: u32,
    pub match_id: BytesN<32>,
    pub duration_secs: u64,
    pub wager_amount: i128,
    pub reward_amount: i128,
    pub player_count: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerBehaviour {
    pub player_hash: BytesN<32>,
    pub game_id: u32,
    pub won: bool,
    pub session_secs: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MatchEvent {
    pub game_id: u32,
    pub match_id: BytesN<32>,
    pub duration_secs: u64,
    pub wager_amount: i128,
    pub reward_amount: i128,
    pub player_count: u32,
    pub recorded_at: u64,
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Salt,
    GameMetrics(u32),
    Platform,
    PlayerBehaviour(BytesN<32>), // keyed by player_hash
    /// Authorised reporter contracts (match contracts, etc.)
    AuthReporter(Address),
    Paused,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct AnalyticsContract;

#[contractimpl]
impl AnalyticsContract {
    // ── Init ──────────────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address, salt: BytesN<32>) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Salt, &salt);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(
            &DataKey::Platform,
            &PlatformMetrics {
                total_matches_all_time: 0,
                active_players_30d: 0,
                total_staked: 0,
                total_volume: 0,
                last_updated: env.ledger().timestamp(),
            },
        );
    }

    pub fn add_reporter(env: Env, reporter: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::AuthReporter(reporter), &true);
    }

    pub fn remove_reporter(env: Env, reporter: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .remove(&DataKey::AuthReporter(reporter));
    }

    // ── Recording ─────────────────────────────────────────────────────────────

    /// Record a completed match. Called by authorised match/game contracts.
    #[allow(clippy::too_many_arguments)]
    pub fn record_match(
        env: Env,
        reporter: Address,
        game_id: u32,
        match_id: BytesN<32>,
        duration_secs: u64,
        wager_amount: i128,
        reward_amount: i128,
        player_count: u32,
    ) {
        Self::require_not_paused(&env);
        reporter.require_auth();
        Self::require_reporter(&env, &reporter);

        let now = env.ledger().timestamp();

        // Update game metrics
        let mut gm: GameMetrics = env
            .storage()
            .persistent()
            .get(&DataKey::GameMetrics(game_id))
            .unwrap_or(GameMetrics {
                game_id,
                total_matches: 0,
                total_players: 0,
                total_wagered: 0,
                total_rewards_paid: 0,
                avg_match_duration_secs: 0,
                last_updated: now,
            });

        // Rolling average for duration
        let prev_total_dur = gm.avg_match_duration_secs * gm.total_matches;
        gm.total_matches += 1;
        gm.total_players += player_count as u64;
        gm.total_wagered += wager_amount;
        gm.total_rewards_paid += reward_amount;
        gm.avg_match_duration_secs = (prev_total_dur + duration_secs) / gm.total_matches;
        gm.last_updated = now;
        env.storage()
            .persistent()
            .set(&DataKey::GameMetrics(game_id), &gm);

        // Update platform metrics
        let mut pm: PlatformMetrics = env.storage().instance().get(&DataKey::Platform).unwrap();
        pm.total_matches_all_time += 1;
        pm.total_volume += wager_amount;
        pm.last_updated = now;
        env.storage().instance().set(&DataKey::Platform, &pm);

        // Emit privacy-safe event (no player addresses)
        #[allow(deprecated)]
        env.events().publish(
            (
                soroban_sdk::symbol_short!("MATCH_REC"),
                game_id,
                match_id.clone(),
            ),
            MatchRecorded {
                game_id,
                match_id,
                duration_secs,
                wager_amount,
                reward_amount,
                player_count,
            },
        );
    }

    /// Record player behaviour. Player address is hashed before storage.
    pub fn record_player_behaviour(
        env: Env,
        reporter: Address,
        player: Address,
        game_id: u32,
        won: bool,
        session_secs: u64,
    ) {
        Self::require_not_paused(&env);
        reporter.require_auth();
        Self::require_reporter(&env, &reporter);

        let player_hash = Self::hash_player(&env, &player);
        let now = env.ledger().timestamp();
        // Round to nearest day for coarse bucketing (privacy)
        let day_bucket = now / 86_400 * 86_400;

        let key = DataKey::PlayerBehaviour(player_hash.clone());
        let mut snap: PlayerBehaviourSnapshot =
            env.storage()
                .persistent()
                .get(&key)
                .unwrap_or(PlayerBehaviourSnapshot {
                    player_hash: player_hash.clone(),
                    game_id,
                    matches_played: 0,
                    wins: 0,
                    losses: 0,
                    avg_session_secs: 0,
                    last_seen_bucket: day_bucket,
                });

        let prev_total = snap.avg_session_secs * snap.matches_played;
        snap.matches_played += 1;
        if won {
            snap.wins += 1;
        } else {
            snap.losses += 1;
        }
        snap.avg_session_secs = (prev_total + session_secs) / snap.matches_played;
        snap.last_seen_bucket = day_bucket;
        env.storage().persistent().set(&key, &snap);

        // Update active player count (approximate — increments per unique hash per day)
        // In production this would use a HyperLogLog approximation; here we use a simple counter
        let mut pm: PlatformMetrics = env.storage().instance().get(&DataKey::Platform).unwrap();
        pm.active_players_30d += 1; // simplified; real impl would deduplicate
        pm.last_updated = now;
        env.storage().instance().set(&DataKey::Platform, &pm);

        // Emit only the hash, never the raw address
        #[allow(deprecated)]
        env.events().publish(
            (
                soroban_sdk::symbol_short!("PLR_BEH"),
                player_hash.clone(),
            ),
            PlayerBehaviour {
                player_hash,
                game_id,
                won,
                session_secs,
            },
        );
    }

    /// Update total staked amount (called by staking contract).
    pub fn update_staked(env: Env, reporter: Address, total_staked: i128) {
        Self::require_not_paused(&env);
        reporter.require_auth();
        Self::require_reporter(&env, &reporter);
        let mut pm: PlatformMetrics = env.storage().instance().get(&DataKey::Platform).unwrap();
        pm.total_staked = total_staked;
        pm.last_updated = env.ledger().timestamp();
        env.storage().instance().set(&DataKey::Platform, &pm);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn get_game_metrics(env: Env, game_id: u32) -> Option<GameMetrics> {
        env.storage()
            .persistent()
            .get(&DataKey::GameMetrics(game_id))
    }

    pub fn get_platform_metrics(env: Env) -> PlatformMetrics {
        env.storage().instance().get(&DataKey::Platform).unwrap()
    }

    /// Query player behaviour by providing the player address (caller must be admin or the player).
    pub fn get_player_behaviour(
        env: Env,
        caller: Address,
        player: Address,
    ) -> Option<PlayerBehaviourSnapshot> {
        caller.require_auth();
        // Only admin or the player themselves can query
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if caller != admin && caller != player {
            panic!("not authorised");
        }
        let hash = Self::hash_player(&env, &player);
        env.storage()
            .persistent()
            .get(&DataKey::PlayerBehaviour(hash))
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    pub fn set_paused(env: Env, paused: bool) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Paused, &paused);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /// Hash player address with contract salt for privacy.
    fn hash_player(env: &Env, player: &Address) -> BytesN<32> {
        let salt: BytesN<32> = env.storage().instance().get(&DataKey::Salt).unwrap();
        // XOR salt bytes with a deterministic hash of the address bytes
        // Soroban doesn't expose SHA-256 directly; we use the crypto module
        let mut input = soroban_sdk::Bytes::new(env);
        input.append(&salt.into());
        input.append(&player.to_xdr(env));
        env.crypto().sha256(&input).into()
    }

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
    }

    fn require_not_paused(env: &Env) {
        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Paused)
            .unwrap_or(false)
        {
            panic!("contract is paused");
        }
    }

    fn require_reporter(env: &Env, reporter: &Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if reporter == &admin {
            return;
        }
        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::AuthReporter(reporter.clone()))
            .unwrap_or(false)
        {
            return;
        }
        panic!("not an authorised reporter");
    }
}
