# ArenaX Governance Contract

A decentralized governance system enabling token holders to vote on platform parameters, game rules, and treasury management.

## Overview

The Governance Contract implements a token-based voting system where token holders can:
- Create proposals for governance actions
- Cast votes on active proposals
- Delegate voting power to other addresses
- Execute passed proposals after a timelock period

## Features

### Core Functions

- **`initialize(env, admin, token_contract)`** - Initialize the governance contract with admin and token contract addresses
- **`create_proposal(env, proposer, title, description, proposal_type, voting_period, execution_data)`** - Create a new governance proposal
- **`cast_vote(env, voter, proposal_id, choice)`** - Cast a vote on an active proposal
- **`calculate_voting_power(env, voter, proposal_id)`** - Calculate voting power for a voter
- **`tally_votes(env, proposal_id)`** - Tally votes and determine proposal outcome
- **`execute_proposal(env, proposal_id)`** - Execute a passed proposal after timelock
- **`delegate_voting_power(env, delegator, delegatee)`** - Delegate voting power to another address
- **`cancel_proposal(env, proposal_id, caller)`** - Cancel an active proposal (admin only)
- **`update_governance_params(env, caller, params)`** - Update governance parameters (admin only)

### Proposal Types

- **ParameterUpdate** - Update governance or protocol parameters
- **TreasuryAllocation** - Allocate funds from treasury
- **RuleChange** - Modify game or platform rules
- **EmergencyAction** - Execute emergency actions
- **Other** - Other governance actions

### Vote Choices

- **For** - Vote in favor of proposal
- **Against** - Vote against proposal
- **Abstain** - Abstain from voting

### Proposal Status

- **Active** - Proposal is open for voting
- **Passed** - Proposal has passed voting
- **Rejected** - Proposal has been rejected
- **Executed** - Proposal has been executed
- **Cancelled** - Proposal was cancelled by admin
- **Expired** - Proposal voting period ended without quorum

## Governance Parameters

Default parameters set on initialization:

- **min_voting_period**: 604800 seconds (7 days)
- **max_voting_period**: 2592000 seconds (30 days)
- **quorum_threshold**: 40% (minimum participation required)
- **execution_threshold**: 51% (votes required to pass)
- **proposal_deposit**: 1000 tokens
- **timelock_period**: 86400 seconds (1 day)

## Data Structures

### Proposal
```rust
pub struct Proposal {
    pub proposal_id: BytesN<32>,
    pub proposer: Address,
    pub title: String,
    pub description: String,
    pub proposal_type: ProposalType,
    pub voting_start: u64,
    pub voting_end: u64,
    pub status: ProposalStatus,
    pub for_votes: u128,
    pub against_votes: u128,
    pub abstain_votes: u128,
    pub total_voting_power: u128,
    pub execution_data: Vec<u8>,
    pub created_at: u64,
}
```

### Vote
```rust
pub struct Vote {
    pub voter: Address,
    pub proposal_id: BytesN<32>,
    pub choice: VoteChoice,
    pub voting_power: u128,
    pub voted_at: u64,
}
```

### Delegation
```rust
pub struct Delegation {
    pub delegator: Address,
    pub delegatee: Address,
    pub voting_power: u128,
    pub delegated_at: u64,
}
```

### GovernanceParams
```rust
pub struct GovernanceParams {
    pub min_voting_period: u64,
    pub max_voting_period: u64,
    pub quorum_threshold: u32,
    pub execution_threshold: u32,
    pub proposal_deposit: u128,
    pub timelock_period: u64,
}
```

## Voting Power Calculation

Voting power is currently calculated based on:
1. Token balance (to be integrated with token contract)
2. Delegated voting power from other addresses

In production, this will query the token contract for actual token holdings.

## Proposal Execution Flow

1. **Creation**: Admin creates a proposal with title, description, and execution data
2. **Voting**: Token holders cast votes during the voting period
3. **Tallying**: After voting period ends, votes are tallied
4. **Quorum Check**: If quorum threshold is met, proposal passes if for votes >= execution threshold
5. **Timelock**: Passed proposals must wait for timelock period before execution
6. **Execution**: Proposal is executed after timelock period

## Security Considerations

- Only admin can create proposals (can be extended to token holders)
- Quorum requirements prevent low-participation attacks
- Timelock period provides time for review before execution
- Voting power calculation prevents Sybil attacks
- Delegation system allows for representative democracy

## Events

The contract emits the following events:

- **ProposalCreated** - When a new proposal is created
- **VoteCast** - When a vote is cast
- **ProposalTallied** - When votes are tallied
- **ProposalExecuted** - When a proposal is executed
- **ProposalCancelled** - When a proposal is cancelled
- **VotingPowerDelegated** - When voting power is delegated
- **GovernanceParamsUpdated** - When governance parameters are updated

## Testing

Run tests with:

```bash
cargo test
```

## Building

Build the contract for deployment:

```bash
cargo build --target wasm32-unknown-unknown --release
```

## Future Enhancements

- [ ] Integrate with token contract for actual balance-based voting
- [ ] Implement quadratic voting
- [ ] Add proposal discussion system
- [ ] Implement governance reward distribution
- [ ] Add cross-chain governance support
- [ ] Implement privacy features for voting
- [ ] Add emergency controls
- [ ] Implement governance analytics tracking
