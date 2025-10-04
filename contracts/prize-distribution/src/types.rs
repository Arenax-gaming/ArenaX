use soroban_sdk::{contracttype, Address, Vec};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Paused,
    PrizePool(u64),
    Participants(u64),
    DistributionRules(u64),
    TokenAddress,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum PrizePoolStatus {
    Active = 0,
    Completed = 1,
    Cancelled = 2,
    Refunded = 3,
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct PrizePool {
    pub tournament_id: u64,
    pub total_amount: i128,
    pub entry_fee: i128,
    pub max_participants: u32,
    pub current_participants: u32,
    pub status: PrizePoolStatus,
    pub created_at: u64,
    pub admin: Address,
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct DistributionRules {
    pub first_place_percentage: u32,
    pub second_place_percentage: u32,
    pub third_place_percentage: u32,
    pub min_participants: u32,
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct Winner {
    pub address: Address,
    pub position: u32,
    pub prize_amount: i128,
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct Participant {
    pub address: Address,
    pub entry_fee_paid: i128,
}