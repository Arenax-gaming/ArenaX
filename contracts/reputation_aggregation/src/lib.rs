#![no_std]

mod error;
mod events;
mod storage;

use soroban_sdk::{contract, contractimpl, Address, Env, Vec};
use storage::{DataKey, MatchOutcome, PlayerReputation, ReputationConfig};

pub use error::ReputationError;

#[contract]
pub struct ArenaXReputationAggregation;

#[contractimpl]
impl ArenaXReputationAggregation {
    /// Initialize the reputation contract
    pub fn initialize(env: Env, admin: Address) -> Result<(), ReputationError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ReputationError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);

        // Set default configuration
        let default_config = ReputationConfig {
            win_weight: 25,   // +25 points for win
            loss_weight: -10, // -10 points for loss
            draw_weight: 5,   // +5 points for draw
            base_score: 1000, // Starting score
            decay_factor: 0,  // No decay for now
        };
        env.storage()
            .instance()
            .set(&DataKey::Config, &default_config);

        let timestamp = env.ledger().timestamp();
        events::emit_initialized(&env, &admin, timestamp);
        Ok(())
    }

    /// Add an authorized match resolver
    pub fn add_authorized_resolver(env: Env, resolver: Address) -> Result<(), ReputationError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ReputationError::NotInitialized)?;

        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::AuthorizedResolver(resolver.clone()), &true);

        let timestamp = env.ledger().timestamp();
        events::emit_authorizer_added(&env, &resolver, timestamp);
        Ok(())
    }

    /// Remove an authorized match resolver
    pub fn remove_authorized_resolver(env: Env, resolver: Address) -> Result<(), ReputationError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ReputationError::NotInitialized)?;

        admin.require_auth();

        env.storage()
            .instance()
            .remove(&DataKey::AuthorizedResolver(resolver.clone()));

        let timestamp = env.ledger().timestamp();
        events::emit_authorizer_removed(&env, &resolver, timestamp);
        Ok(())
    }

    /// Check if an address is an authorized resolver
    pub fn is_authorized_resolver(env: Env, resolver: Address) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::AuthorizedResolver(resolver))
            .unwrap_or(false)
    }

    /// Update player reputation after match completion
    pub fn update_reputation(
        env: Env,
        resolver: Address,
        player: Address,
        outcome: u32,
        match_id: u64,
    ) -> Result<(), ReputationError> {
        // Check if resolver is authorized
        resolver.require_auth();
        if !Self::is_authorized_resolver(env.clone(), resolver) {
            return Err(ReputationError::Unauthorized);
        }

        // Validate outcome
        let outcome_enum = match outcome {
            0 => MatchOutcome::Win,
            1 => MatchOutcome::Loss,
            2 => MatchOutcome::Draw,
            _ => return Err(ReputationError::InvalidMatchOutcome),
        };

        let config: ReputationConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(ReputationError::NotInitialized)?;

        let timestamp = env.ledger().timestamp();

        // Get or create player reputation
        let mut reputation = env
            .storage()
            .instance()
            .get(&DataKey::PlayerReputation(player.clone()))
            .unwrap_or_else(|| PlayerReputation {
                player: player.clone(),
                wins: 0,
                losses: 0,
                draws: 0,
                matches_played: 0,
                score: config.base_score,
                last_updated: timestamp,
            });

        let previous_score = reputation.score;

        // Update statistics based on outcome
        match outcome_enum {
            MatchOutcome::Win => {
                reputation.wins = reputation
                    .wins
                    .checked_add(1)
                    .ok_or(ReputationError::ArithmeticOverflow)?;
                reputation.score = reputation
                    .score
                    .checked_add(config.win_weight)
                    .ok_or(ReputationError::ArithmeticOverflow)?;
            }
            MatchOutcome::Loss => {
                reputation.losses = reputation
                    .losses
                    .checked_add(1)
                    .ok_or(ReputationError::ArithmeticOverflow)?;
                reputation.score = reputation
                    .score
                    .checked_add(config.loss_weight)
                    .ok_or(ReputationError::ArithmeticOverflow)?;
            }
            MatchOutcome::Draw => {
                reputation.draws = reputation
                    .draws
                    .checked_add(1)
                    .ok_or(ReputationError::ArithmeticOverflow)?;
                reputation.score = reputation
                    .score
                    .checked_add(config.draw_weight)
                    .ok_or(ReputationError::ArithmeticOverflow)?;
            }
        }

        reputation.matches_played = reputation
            .matches_played
            .checked_add(1)
            .ok_or(ReputationError::ArithmeticOverflow)?;
        reputation.last_updated = timestamp;

        // Ensure score doesn't go below 0
        if reputation.score < 0 {
            reputation.score = 0;
        }

        // Save updated reputation
        env.storage()
            .instance()
            .set(&DataKey::PlayerReputation(player.clone()), &reputation);

        // Emit events
        events::emit_reputation_updated(
            &env,
            &player,
            previous_score,
            reputation.score,
            match_id,
            timestamp,
        );
        events::emit_match_recorded(&env, &player, outcome, match_id, timestamp);

        Ok(())
    }

    /// Get player reputation data
    pub fn get_reputation(env: Env, player: Address) -> PlayerReputation {
        env.storage()
            .instance()
            .get(&DataKey::PlayerReputation(player.clone()))
            .unwrap_or_else(|| {
                let config: ReputationConfig = env
                    .storage()
                    .instance()
                    .get(&DataKey::Config)
                    .unwrap_or_else(|| ReputationConfig {
                        win_weight: 25,
                        loss_weight: -10,
                        draw_weight: 5,
                        base_score: 1000,
                        decay_factor: 0,
                    });

                PlayerReputation {
                    player,
                    wins: 0,
                    losses: 0,
                    draws: 0,
                    matches_played: 0,
                    score: config.base_score,
                    last_updated: 0,
                }
            })
    }

    /// Get player wins
    pub fn get_wins(env: Env, player: Address) -> u32 {
        Self::get_reputation(env, player).wins
    }

    /// Get player losses
    pub fn get_losses(env: Env, player: Address) -> u32 {
        Self::get_reputation(env, player).losses
    }

    /// Get player draws
    pub fn get_draws(env: Env, player: Address) -> u32 {
        Self::get_reputation(env, player).draws
    }

    /// Get player matches played
    pub fn get_matches_played(env: Env, player: Address) -> u32 {
        Self::get_reputation(env, player).matches_played
    }

    /// Get player score
    pub fn get_score(env: Env, player: Address) -> i128 {
        Self::get_reputation(env, player).score
    }

    /// Get batch of player reputations for leaderboard
    pub fn get_batch_reputations(env: Env, players: Vec<Address>) -> Vec<PlayerReputation> {
        let mut reputations = Vec::new(&env);
        for player in players.iter() {
            reputations.push_back(Self::get_reputation(env.clone(), player));
        }
        reputations
    }

    /// Update reputation configuration (admin only)
    pub fn update_config(env: Env, new_config: ReputationConfig) -> Result<(), ReputationError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ReputationError::NotInitialized)?;

        admin.require_auth();

        env.storage().instance().set(&DataKey::Config, &new_config);
        Ok(())
    }

    /// Get current configuration
    pub fn get_config(env: Env) -> Result<ReputationConfig, ReputationError> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(ReputationError::NotInitialized)
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Result<Address, ReputationError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ReputationError::NotInitialized)
    }
}

mod test;
