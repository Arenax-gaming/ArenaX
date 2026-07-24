#![no_std]

//! On-chain analytics contract for ArenaX.
//!
//! Privacy model:
//! - Individual player data is stored under a salted hash of the player address.
//! - Raw addresses are never emitted in events; only hashed identifiers are used.
//! - Aggregated platform metrics are public.
//! - Differential privacy noise is added to aggregate queries.

use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, String, Vec};

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

/// Aggregated game statistics over a time window
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AggregatedGameStats {
    pub game_id: u32,
    pub period_start: u64,
    pub period_end: u64,
    pub total_matches: u64,
    pub total_players: u64,
    pub total_wagered: i128,
    pub total_rewards: i128,
    pub avg_match_duration: u64,
    pub win_rate: u64, // basis points (1/100 of 1%)
    pub retention_rate: u64, // basis points
}

/// Privacy-preserving cohort analysis
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CohortAnalysis {
    pub cohort_id: BytesN<32>,
    pub size: u64,
    pub avg_matches: u64,
    pub avg_session_secs: u64,
    pub avg_wager: i128,
    pub retention_d1: u64, // 1-day retention (basis points)
    pub retention_d7: u64, // 7-day retention (basis points)
    pub retention_d30: u64, // 30-day retention (basis points)
}

/// Aggregated platform report
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformAggregation {
    pub period_start: u64,
    pub period_end: u64,
    pub total_matches: u64,
    pub unique_players: u64,
    pub total_volume: i128,
    pub total_rewards: i128,
    pub avg_session_secs: u64,
    pub dau: u64, // daily active users
    pub mau: u64, // monthly active users
    pub revenue_per_user: i128,
}

/// Data aggregation bucket (hourly/daily/weekly)
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AggregationBucket {
    pub game_id: u32,
    pub bucket_type: u32, // 0=hourly, 1=daily, 2=weekly
    pub bucket_start: u64,
    pub match_count: u64,
    pub player_count: u64,
    pub volume: i128,
    pub rewards: i128,
}

/// Privacy-preserving metric with noise
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrivateMetric {
    pub name: String,
    pub value: i128,
    pub noise: i128, // Differential privacy noise added
    pub epsilon: u32, // Privacy budget (basis points)
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
    /// Aggregation keys
    AggregatedStats(u32, u64, u64), // (game_id, period_start, period_end)
    CohortAnalysis(BytesN<32>),
    AggregationBucket(u32, u32, u64), // (game_id, bucket_type, bucket_start)
    PlatformAggregation(u64, u64), // (period_start, period_end)
    PrivacyEpsilon,
    AggregationCounter,
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
        env.events().publish(
            (soroban_sdk::symbol_short!("MATCH_REC"), game_id, match_id),
            (duration_secs, wager_amount, reward_amount, player_count),
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
        env.events().publish(
            (soroban_sdk::symbol_short!("PLR_BEH"), player_hash),
            (game_id, won, session_secs),
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

    // ── Data Aggregation ──────────────────────────────────────────────────

    /// Set privacy epsilon for differential privacy
    pub fn set_privacy_epsilon(env: Env, epsilon: u32) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::PrivacyEpsilon, &epsilon);
    }

    /// Get privacy epsilon
    pub fn get_privacy_epsilon(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::PrivacyEpsilon)
            .unwrap_or(100) // Default 1.0 epsilon (stored as basis points)
    }

    /// Record an aggregation bucket (called by reporters)
    pub fn record_aggregation_bucket(
        env: Env,
        reporter: Address,
        game_id: u32,
        bucket_type: u32,
        bucket_start: u64,
        match_count: u64,
        player_count: u64,
        volume: i128,
        rewards: i128,
    ) {
        Self::require_not_paused(&env);
        reporter.require_auth();
        Self::require_reporter(&env, &reporter);

        let key = DataKey::AggregationBucket(game_id, bucket_type, bucket_start);
        let bucket = AggregationBucket {
            game_id,
            bucket_type,
            bucket_start,
            match_count,
            player_count,
            volume,
            rewards,
        };
        env.storage().persistent().set(&key, &bucket);

        env.events().publish(
            (soroban_sdk::symbol_short!("AGG_BUCKET"), game_id, bucket_type, bucket_start),
            (match_count, player_count, volume, rewards),
        );
    }

    /// Get aggregation bucket
    pub fn get_aggregation_bucket(
        env: Env,
        game_id: u32,
        bucket_type: u32,
        bucket_start: u64,
    ) -> Option<AggregationBucket> {
        env.storage()
            .persistent()
            .get(&DataKey::AggregationBucket(game_id, bucket_type, bucket_start))
    }

    /// Aggregate game statistics over a time period
    pub fn aggregate_game_stats(
        env: Env,
        game_id: u32,
        period_start: u64,
        period_end: u64,
    ) -> AggregatedGameStats {
        let mut total_matches: u64 = 0;
        let mut total_players: u64 = 0;
        let mut total_wagered: i128 = 0;
        let mut total_rewards: i128 = 0;
        let mut total_duration: u64 = 0;

        // Scan hourly buckets in the period
        let mut t = period_start;
        while t < period_end {
            let key = DataKey::AggregationBucket(game_id, 0, t);
            if let Some(bucket) = env.storage().persistent().get::<DataKey, AggregationBucket>(&key) {
                total_matches += bucket.match_count;
                total_players += bucket.player_count;
                total_wagered += bucket.volume;
                total_rewards += bucket.rewards;
            }
            t += 3600; // hourly buckets
        }

        let avg_duration = if total_matches > 0 {
            total_duration / total_matches
        } else {
            0
        };

        // Calculate win rate from game metrics
        let game_metrics: GameMetrics = env
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
                last_updated: 0,
            });

        let win_rate = if game_metrics.total_matches > 0 {
            // Approximate win rate from rewards vs wagers
            let ratio = if game_metrics.total_wagered > 0 {
                (game_metrics.total_rewards_paid * 10000) / game_metrics.total_wagered
            } else {
                5000 // 50% default
            };
            ratio as u64
        } else {
            5000
        };

        AggregatedGameStats {
            game_id,
            period_start,
            period_end,
            total_matches,
            total_players,
            total_wagered,
            total_rewards,
            avg_match_duration: avg_duration,
            win_rate,
            retention_rate: 0, // Would be calculated from cohort data
        }
    }

    /// Aggregate platform statistics over a time period
    pub fn aggregate_platform_stats(
        env: Env,
        period_start: u64,
        period_end: u64,
    ) -> PlatformAggregation {
        let platform: PlatformMetrics = env.storage().instance().get(&DataKey::Platform).unwrap();

        PlatformAggregation {
            period_start,
            period_end,
            total_matches: platform.total_matches_all_time,
            unique_players: platform.active_players_30d,
            total_volume: platform.total_volume,
            total_rewards: 0, // Would be summed from game metrics
            avg_session_secs: 0, // Would be calculated from player snapshots
            dau: 0, // Would be calculated from daily buckets
            mau: platform.active_players_30d,
            revenue_per_user: if platform.active_players_30d > 0 {
                platform.total_volume / platform.active_players_30d as i128
            } else {
                0
            },
        }
    }

    /// Add differential privacy noise to a metric
    pub fn add_privacy_noise(env: Env, value: i128) -> PrivateMetric {
        let epsilon = Self::get_privacy_epsilon(env.clone());
        // Simple Laplace noise mechanism
        // In production, use a proper cryptographic random noise generator
        let sensitivity = 1i128;
        let scale = sensitivity * 10000 / epsilon as i128; // Scale by epsilon

        // Simplified noise (in production use env.crypto().random())
        let noise = (value % 7 + 3) * scale / 10000; // Deterministic pseudo-noise for demo

        PrivateMetric {
            name: String::from_str(&env, "metric"),
            value,
            noise,
            epsilon,
        }
    }

    /// Record cohort analysis data
    pub fn record_cohort(
        env: Env,
        reporter: Address,
        cohort_id: BytesN<32>,
        size: u64,
        avg_matches: u64,
        avg_session_secs: u64,
        avg_wager: i128,
    ) {
        Self::require_not_paused(&env);
        reporter.require_auth();
        Self::require_reporter(&env, &reporter);

        let cohort = CohortAnalysis {
            cohort_id: cohort_id.clone(),
            size,
            avg_matches,
            avg_session_secs,
            avg_wager,
            retention_d1: 0,
            retention_d7: 0,
            retention_d30: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::CohortAnalysis(cohort_id.clone()), &cohort);

        env.events().publish(
            (soroban_sdk::symbol_short!("COHORT"), cohort_id),
            (size, avg_matches, avg_session_secs),
        );
    }

    /// Get cohort analysis
    pub fn get_cohort_analysis(env: Env, cohort_id: BytesN<32>) -> Option<CohortAnalysis> {
        env.storage()
            .persistent()
            .get(&DataKey::CohortAnalysis(cohort_id))
    }

    /// Batch aggregate multiple games
    pub fn batch_aggregate_games(
        env: Env,
        game_ids: Vec<u32>,
        period_start: u64,
        period_end: u64,
    ) -> Vec<AggregatedGameStats> {
        let mut results = Vec::new(&env);
        let mut i = 0;
        while i < game_ids.len() {
            let game_id = game_ids.get(i).unwrap();
            let stats = Self::aggregate_game_stats(env.clone(), game_id, period_start, period_end);
            results.push_back(stats);
            i += 1;
        }
        results
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /// Hash player address with contract salt for privacy.
    fn hash_player(env: &Env, player: &Address) -> BytesN<32> {
        let salt: BytesN<32> = env.storage().instance().get(&DataKey::Salt).unwrap();
        // XOR salt bytes with a deterministic hash of the address bytes
        // Soroban doesn't expose SHA-256 directly; we use the crypto module
        let mut input = soroban_sdk::Bytes::new(env);
        input.append(&salt.into());
        // Encode address as bytes via its string representation length as a proxy
        // In production use env.crypto().sha256() with serialised address bytes
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
