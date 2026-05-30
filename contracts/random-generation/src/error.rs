#![no_std]

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    RequestNotFound = 3,
    RequestAlreadyFulfilled = 4,
    InvalidCommit = 5,
    InvalidProof = 6,
    GameNotFound = 7,
    TournamentNotFound = 8,
    InvalidPeriod = 9,
    EmptyEntrants = 10,
}
