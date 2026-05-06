#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Bytes, Env, String, Vec, symbol_short as s};

mod types;
mod error;

use types::*;
use error::ContractError;

#[contract]
pub struct GameStateContract;

#[contractimpl]
impl GameStateContract {
    /// Initialize the contract with an admin and initial state
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::GameCounter, &0u64);
        Ok(())
    }

    /// Configure settings for a specific game mode
    pub fn set_game_mode_config(
        env: Env,
        game_mode: GameMode,
        config: GameModeConfig,
    ) -> Result<(), ContractError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(ContractError::NotInitialized)?;
        admin.require_auth();

        env.storage().instance().set(&DataKey::ModeConfig(game_mode), &config);
        Ok(())
    }

    /// Create a new game session
    pub fn create_game(
        env: Env,
        players: Vec<Address>,
        game_mode: GameMode,
        initial_state_hash: Bytes,
    ) -> Result<u64, ContractError> {
        Self::ensure_not_paused(&env)?;

        // Implementation Task: Validate players based on mode configuration
        if let Some(config) = env.storage().instance().get::<_, GameModeConfig>(&DataKey::ModeConfig(game_mode.clone())) {
            if players.len() < config.min_players || players.len() > config.max_players {
                return Err(ContractError::InvalidPlayers);
            }
        } else {
            // Default fallback if no config is set
            if players.len() < 2 {
                return Err(ContractError::InvalidPlayers);
            }
        }

        let mut counter: u64 = env.storage().instance().get(&DataKey::GameCounter).unwrap_or(0);
        counter += 1;
        
        let game_state = GameState {
            game_id: counter,
            players: players.clone(),
            game_mode,
            status: GameStatus::Active,
            current_state_hash: initial_state_hash,
            version: 1,
            last_updated: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&DataKey::Game(counter), &game_state);
        env.storage().instance().set(&DataKey::GameCounter, &counter);
        env.storage().persistent().set(&DataKey::History(counter), &Vec::<PlayerAction>::new(&env));
        
        // Gas Optimization: Extend TTL for persistent storage
        env.storage().persistent().extend_ttl(&DataKey::Game(counter), 1000, 5000);
        env.storage().persistent().extend_ttl(&DataKey::History(counter), 1000, 5000);

        env.events().publish((s!("game"), s!("created"), counter), players);
        
        Ok(counter)
    }

    /// Update game state (restricted to Admin/Oracle)
    pub fn update_game_state(
        env: Env,
        game_id: u64,
        new_state_hash: Bytes,
    ) -> Result<(), ContractError> {
        Self::ensure_not_paused(&env)?;
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(ContractError::NotInitialized)?;
        admin.require_auth();

        let mut game: GameState = env.storage().persistent().get(&DataKey::Game(game_id)).ok_or(ContractError::GameNotFound)?;
        
        if game.status != GameStatus::Active {
            return Err(ContractError::InvalidStatus);
        }

        game.current_state_hash = new_state_hash;
        game.version += 1;
        game.last_updated = env.ledger().timestamp();

        env.storage().persistent().set(&DataKey::Game(game_id), &game);
        env.events().publish((s!("game"), s!("updated"), game_id), game.version);
        
        Ok(())
    }

    /// Core Function: Rule validation logic
    pub fn validate_game_rules(
        env: Env,
        game_id: u64,
        player: Address,
        _action: String,
    ) -> Result<(), ContractError> {
        let game: GameState = env.storage().persistent().get(&DataKey::Game(game_id)).ok_or(ContractError::GameNotFound)?;
        
        if !game.players.contains(&player) {
            return Err(ContractError::Unauthorized);
        }
        
        Ok(())
    }

    /// Submit a player action
    pub fn submit_player_action(
        env: Env,
        game_id: u64,
        player: Address,
        action_type: String,
        payload: Bytes,
    ) -> Result<(), ContractError> {
        Self::ensure_not_paused(&env)?;
        player.require_auth();

        let mut game: GameState = env.storage().persistent().get(&DataKey::Game(game_id)).ok_or(ContractError::GameNotFound)?;
        
        if game.status != GameStatus::Active {
            return Err(ContractError::InvalidStatus);
        }

        // Implementation Task: Player action validation system
        Self::validate_game_rules(env.clone(), game_id, player.clone(), action_type.clone())?;

        let action = PlayerAction {
            player: player.clone(),
            action_type: action_type.clone(),
            payload,
            timestamp: env.ledger().timestamp(),
        };

        let mut history: Vec<PlayerAction> = env.storage().persistent().get(&DataKey::History(game_id)).unwrap_or(Vec::new(&env));
        history.push_back(action);
        env.storage().persistent().set(&DataKey::History(game_id), &history);

        env.events().publish((s!("game"), s!("action"), game_id), (player, action_type));

        Ok(())
    }

    /// Finalize game and record results
    pub fn complete_game(
        env: Env,
        game_id: u64,
        result: GameResult,
    ) -> Result<(), ContractError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(ContractError::NotInitialized)?;
        admin.require_auth();

        let mut game: GameState = env.storage().persistent().get(&DataKey::Game(game_id)).ok_or(ContractError::GameNotFound)?;
        
        if game.status != GameStatus::Active {
            return Err(ContractError::InvalidStatus);
        }

        game.status = GameStatus::Completed;
        game.last_updated = env.ledger().timestamp();

        env.storage().persistent().set(&DataKey::Game(game_id), &game);
        env.events().publish((s!("game"), s!("ended"), game_id), result.winner);

        Ok(())
    }

    /// Set contract pause state
    pub fn set_pause(env: Env, paused: bool) -> Result<(), ContractError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(ContractError::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &paused);
        Ok(())
    }

    /// Get game details
    pub fn get_game(env: Env, game_id: u64) -> Option<GameState> {
        env.storage().persistent().get(&DataKey::Game(game_id))
    }

    /// Get history of player actions for a game
    pub fn get_game_history(env: Env, game_id: u64) -> Vec<PlayerAction> {
        env.storage().persistent().get(&DataKey::History(game_id)).unwrap_or(Vec::new(&env))
    }

    fn ensure_not_paused(env: &Env) -> Result<(), ContractError> {
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        if paused {
            return Err(ContractError::ContractPaused);
        }
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _};

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, GameStateContract);
        let client = GameStateContractClient::new(&env, &contract_id);
        client.initialize(&admin);
    }
}