use soroban_sdk::{contracttype, Address, Bytes, Vec, String};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GameStatus {
    Created = 0,
    Active = 1,
    Completed = 2,
    Paused = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GameMode {
    Ranked = 0,
    Tournament = 1,
    Casual = 2,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct GameModeConfig {
    pub max_players: u32,
    pub min_players: u32,
    pub allows_spectators: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct GameState {
    pub game_id: u64,
    pub players: Vec<Address>,
    pub game_mode: GameMode,
    pub status: GameStatus,
    pub current_state_hash: Bytes,
    pub version: u32,
    pub last_updated: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct PlayerAction {
    pub player: Address,
    pub action_type: String,
    pub payload: Bytes,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct GameResult {
    pub winner: Address,
    pub scores: Vec<u32>,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Paused,
    Game(u64),
    History(u64),
    GameCounter,
    ModeConfig(GameModeMode),
}