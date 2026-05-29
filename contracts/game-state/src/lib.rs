#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, String, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GameStatus {
    Created,
    Active,
    Completed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameConfig {
    pub max_players: u32,
    pub min_action_interval: u64,
    pub allow_spectators: bool,
    pub scoring_version: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub game_id: BytesN<32>,
    pub creator: Address,
    pub players: Vec<Address>,
    pub game_mode: String,
    pub state_hash: BytesN<32>,
    pub version: u32,
    pub status: GameStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub completed_at: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerAction {
    pub player: Address,
    pub action: Bytes,
    pub version: u32,
    pub submitted_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameResult {
    pub player: Address,
    pub score: i128,
    pub rank: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameHistoryEntry {
    pub version: u32,
    pub actor: Address,
    pub state_hash: BytesN<32>,
    pub action_hash: BytesN<32>,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Paused,
    GameCounter,
    ModeConfig(String),
    Game(BytesN<32>),
    History(BytesN<32>),
    Results(BytesN<32>),
    LastAction(BytesN<32>, Address),
}

#[contract]
pub struct GameStateContract;

#[contractimpl]
impl GameStateContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::GameCounter, &0u32);
    }

    pub fn configure_game_mode(env: Env, admin: Address, game_mode: String, config: GameConfig) {
        Self::require_admin(&env, &admin);
        if config.max_players == 0 {
            panic!("max players required");
        }

        env.storage()
            .persistent()
            .set(&DataKey::ModeConfig(game_mode.clone()), &config);
        env.events().publish(
            (soroban_sdk::symbol_short!("MODE_CFG"), game_mode),
            config.scoring_version,
        );
    }

    pub fn create_game(
        env: Env,
        players: Vec<Address>,
        game_mode: String,
        initial_state: BytesN<32>,
    ) -> BytesN<32> {
        Self::require_not_paused(&env);
        if players.is_empty() {
            panic!("players required");
        }

        let config: GameConfig = env
            .storage()
            .persistent()
            .get(&DataKey::ModeConfig(game_mode.clone()))
            .unwrap_or(GameConfig {
                max_players: 64,
                min_action_interval: 0,
                allow_spectators: true,
                scoring_version: 1,
            });
        if players.len() > config.max_players {
            panic!("too many players");
        }

        let creator = players.get(0).expect("players required");
        creator.require_auth();

        let counter: u32 = env
            .storage()
            .instance()
            .get(&DataKey::GameCounter)
            .unwrap_or(0);
        let next = counter + 1;
        env.storage().instance().set(&DataKey::GameCounter, &next);
        let game_id = Self::id_from_counter(&env, next);
        let now = env.ledger().timestamp();

        let game = Game {
            game_id: game_id.clone(),
            creator: creator.clone(),
            players,
            game_mode: game_mode.clone(),
            state_hash: initial_state.clone(),
            version: 1,
            status: GameStatus::Active,
            created_at: now,
            updated_at: now,
            completed_at: None,
        };

        let mut history = Vec::new(&env);
        history.push_back(GameHistoryEntry {
            version: 1,
            actor: creator.clone(),
            state_hash: initial_state.clone(),
            action_hash: initial_state,
            timestamp: now,
        });

        env.storage()
            .persistent()
            .set(&DataKey::Game(game_id.clone()), &game);
        env.storage()
            .persistent()
            .set(&DataKey::History(game_id.clone()), &history);
        env.events().publish(
            (soroban_sdk::symbol_short!("GAME_NEW"), game_id.clone()),
            game_mode,
        );
        game_id
    }

    pub fn update_game_state(
        env: Env,
        game_id: BytesN<32>,
        new_state: BytesN<32>,
        signer: Address,
    ) {
        Self::require_not_paused(&env);
        signer.require_auth();

        let mut game: Game = env
            .storage()
            .persistent()
            .get(&DataKey::Game(game_id.clone()))
            .expect("game not found");
        if game.status != GameStatus::Active {
            panic!("game not active");
        }
        if !Self::is_player(&game.players, &signer) {
            panic!("unauthorized signer");
        }

        game.version += 1;
        game.state_hash = new_state.clone();
        game.updated_at = env.ledger().timestamp();
        Self::append_history(
            &env,
            &game_id,
            &signer,
            &new_state,
            &new_state,
            game.version,
        );
        env.storage()
            .persistent()
            .set(&DataKey::Game(game_id.clone()), &game);
        env.events().publish(
            (soroban_sdk::symbol_short!("STATE_UPD"), game_id),
            (game.version, signer),
        );
    }

    pub fn submit_player_action(
        env: Env,
        game_id: BytesN<32>,
        player: Address,
        action: Bytes,
        signature: BytesN<32>,
    ) {
        Self::require_not_paused(&env);
        player.require_auth();
        if !Self::validate_game_rules(env.clone(), game_id.clone(), player.clone(), action.clone())
        {
            panic!("invalid action");
        }

        let mut game: Game = env
            .storage()
            .persistent()
            .get(&DataKey::Game(game_id.clone()))
            .expect("game not found");
        game.version += 1;
        game.updated_at = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&DataKey::Game(game_id.clone()), &game);
        env.storage().persistent().set(
            &DataKey::LastAction(game_id.clone(), player.clone()),
            &env.ledger().timestamp(),
        );
        Self::append_history(
            &env,
            &game_id,
            &player,
            &game.state_hash,
            &signature,
            game.version,
        );
        env.events().publish(
            (soroban_sdk::symbol_short!("ACTION"), game_id),
            (player, game.version),
        );
    }

    pub fn validate_game_rules(
        env: Env,
        game_id: BytesN<32>,
        player: Address,
        action: Bytes,
    ) -> bool {
        let game: Game = env
            .storage()
            .persistent()
            .get(&DataKey::Game(game_id.clone()))
            .expect("game not found");
        if game.status != GameStatus::Active
            || action.is_empty()
            || !Self::is_player(&game.players, &player)
        {
            return false;
        }

        let config: GameConfig = env
            .storage()
            .persistent()
            .get(&DataKey::ModeConfig(game.game_mode))
            .unwrap_or(GameConfig {
                max_players: 64,
                min_action_interval: 0,
                allow_spectators: true,
                scoring_version: 1,
            });
        let last: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::LastAction(game_id, player))
            .unwrap_or(0);
        last == 0 || env.ledger().timestamp().saturating_sub(last) >= config.min_action_interval
    }

    pub fn complete_game(
        env: Env,
        game_id: BytesN<32>,
        results: Vec<GameResult>,
        scores: Vec<i128>,
    ) {
        Self::require_not_paused(&env);
        let mut game: Game = env
            .storage()
            .persistent()
            .get(&DataKey::Game(game_id.clone()))
            .expect("game not found");
        game.creator.require_auth();
        if game.status != GameStatus::Active {
            panic!("game not active");
        }
        if results.is_empty() || results.len() != scores.len() {
            panic!("invalid results");
        }

        game.status = GameStatus::Completed;
        game.completed_at = Some(env.ledger().timestamp());
        game.updated_at = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&DataKey::Game(game_id.clone()), &game);
        env.storage()
            .persistent()
            .set(&DataKey::Results(game_id.clone()), &results);
        env.events().publish(
            (soroban_sdk::symbol_short!("GAME_DONE"), game_id),
            scores.len(),
        );
    }

    pub fn get_game_history(env: Env, game_id: BytesN<32>) -> Vec<GameHistoryEntry> {
        env.storage()
            .persistent()
            .get(&DataKey::History(game_id))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_game(env: Env, game_id: BytesN<32>) -> Game {
        env.storage()
            .persistent()
            .get(&DataKey::Game(game_id))
            .expect("game not found")
    }

    pub fn get_game_results(env: Env, game_id: BytesN<32>) -> Vec<GameResult> {
        env.storage()
            .persistent()
            .get(&DataKey::Results(game_id))
            .unwrap_or(Vec::new(&env))
    }

    pub fn set_paused(env: Env, admin: Address, paused: bool) {
        Self::require_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Paused, &paused);
    }

    fn append_history(
        env: &Env,
        game_id: &BytesN<32>,
        actor: &Address,
        state_hash: &BytesN<32>,
        action_hash: &BytesN<32>,
        version: u32,
    ) {
        let mut history: Vec<GameHistoryEntry> = env
            .storage()
            .persistent()
            .get(&DataKey::History(game_id.clone()))
            .unwrap_or(Vec::new(env));
        history.push_back(GameHistoryEntry {
            version,
            actor: actor.clone(),
            state_hash: state_hash.clone(),
            action_hash: action_hash.clone(),
            timestamp: env.ledger().timestamp(),
        });
        env.storage()
            .persistent()
            .set(&DataKey::History(game_id.clone()), &history);
    }

    fn require_admin(env: &Env, admin: &Address) {
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if &stored != admin {
            panic!("admin required");
        }
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

    fn is_player(players: &Vec<Address>, player: &Address) -> bool {
        let mut i = 0;
        while i < players.len() {
            if players.get(i).expect("player") == *player {
                return true;
            }
            i += 1;
        }
        false
    }

    fn id_from_counter(env: &Env, counter: u32) -> BytesN<32> {
        let mut bytes = [0u8; 32];
        bytes[0..4].copy_from_slice(&counter.to_be_bytes());
        BytesN::from_array(env, &bytes)
    }
}
