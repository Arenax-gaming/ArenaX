use soroban_sdk::{contracttype, Address, BytesN, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Oracle,
    RequestCount,
    Request(u64),
    GameRng(BytesN<32>, u32),
    TourneySeeds(BytesN<32>),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RngRequest {
    pub id: u64,
    pub requester: Address,
    pub seed: u64,
    pub commitment: BytesN<32>,
    pub timestamp: u64,
    pub status: RequestStatus,
    pub random_value: Option<u64>,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RequestStatus {
    Pending = 1,
    Fulfilled = 2,
    Failed = 3,
}