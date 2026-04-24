# Tournament Manager Contract

## Overview

The Tournament Manager contract is a comprehensive Soroban smart contract for managing tournament lifecycles on the ArenaX gaming platform. It handles tournament creation, player registration, bracket generation, match results, tournament progression, and prize distribution.

## Features

### Core Functionality

- **Tournament Creation**: Create tournaments with configurable parameters (type, player limits, entry fees, prize pools, timing)
- **Player Registration**: Handle player registration with capacity limits and eligibility validation
- **Bracket Generation**: Support multiple tournament formats:
  - Single Elimination
  - Double Elimination
  - Swiss System
  - Round Robin
- **Match Management**: Track match states, update results with validation
- **Tournament Progression**: Automated advancement through tournament phases and rounds
- **Prize Distribution**: Secure prize escrow and distribution system
- **Governance Controls**: Pause/resume functionality for organizers
- **Emergency Controls**: Tournament cancellation with reason tracking
- **Dispute Resolution**: Raise and resolve match disputes
- **Analytics Tracking**: Track tournament statistics (matches, disputes, duration, prizes)

### Tournament States

- `Created`: Tournament initialized, not yet open for registration
- `RegistrationOpen`: Players can register
- `RegistrationClosed`: Registration period ended
- `BracketGenerated`: Bracket has been generated
- `InProgress`: Tournament is active
- `Paused`: Tournament temporarily paused
- `Completed`: Tournament finished
- `Cancelled`: Tournament cancelled

### Tournament Types

- `SingleElimination`: Standard knockout bracket
- `DoubleElimination`: Winners and losers bracket
- `SwissSystem`: Pairing based on performance
- `RoundRobin`: All players play each other

## Contract Functions

### Initialization

```rust
pub fn initialize(env: Env, admin: Address)
```
Initializes the contract with an admin address.

### Tournament Management

```rust
pub fn create_tournament(env: Env, organizer: Address, config: TournamentConfig) -> BytesN<32>
```
Creates a new tournament with the specified configuration.

```rust
pub fn open_registration(env: Env, tournament_id: BytesN<32>)
```
Opens registration for a tournament.

```rust
pub fn register_player(env: Env, tournament_id: BytesN<32>, player: Address, seed_value: u32)
```
Registers a player for the tournament.

```rust
pub fn close_registration(env: Env, tournament_id: BytesN<32>)
```
Closes registration and prepares for bracket generation.

### Bracket Generation

```rust
pub fn generate_bracket(env: Env, tournament_id: BytesN<32>, seed_data: Vec<u32>)
```
Generates the tournament bracket based on the tournament type.

### Match Management

```rust
pub fn start_tournament(env: Env, tournament_id: BytesN<32>)
```
Starts the tournament.

```rust
pub fn update_match_result(env: Env, tournament_id: BytesN<32>, match_id: BytesN<32>, winner: Address, score_a: u32, score_b: u32)
```
Updates a match result with validation.

```rust
pub fn advance_tournament(env: Env, tournament_id: BytesN<32>)
```
Advances the tournament to the next round.

### Prize Distribution

```rust
pub fn set_prize_allocations(env: Env, tournament_id: BytesN<32>, allocations: Vec<PrizeAllocation>)
```
Sets the prize allocation structure.

```rust
pub fn distribute_prizes(env: Env, tournament_id: BytesN<32>, winners: Map<Address, u32>)
```
Distributes prizes to tournament winners.

### Governance Controls

```rust
pub fn pause_tournament(env: Env, tournament_id: BytesN<32>)
```
Pauses an in-progress tournament.

```rust
pub fn resume_tournament(env: Env, tournament_id: BytesN<32>)
```
Resumes a paused tournament.

### Emergency Controls

```rust
pub fn cancel_tournament(env: Env, tournament_id: BytesN<32>, reason: String)
```
Cancels a tournament with a reason.

### Dispute Resolution

```rust
pub fn raise_dispute(env: Env, tournament_id: BytesN<32>, match_id: BytesN<32>, reporter: Address, reason: String)
```
Raises a dispute for a match.

```rust
pub fn resolve_dispute(env: Env, tournament_id: BytesN<32>, match_id: BytesN<32>, resolution: String)
```
Resolves a dispute.

### Query Functions

```rust
pub fn get_tournament(env: Env, tournament_id: BytesN<32>) -> Tournament
pub fn get_tournament_players(env: Env, tournament_id: BytesN<32>) -> Vec<PlayerRegistration>
pub fn get_tournament_bracket(env: Env, tournament_id: BytesN<32>) -> Bracket
pub fn get_match(env: Env, tournament_id: BytesN<32>, match_id: BytesN<32>) -> Match
pub fn get_prize_escrow(env: Env, tournament_id: BytesN<32>) -> PrizeEscrow
pub fn get_tournament_analytics(env: Env, tournament_id: BytesN<32>) -> TournamentAnalytics
pub fn get_dispute(env: Env, tournament_id: BytesN<32>, match_id: BytesN<32>) -> Dispute
```

## Data Structures

### TournamentConfig
Configuration parameters for tournament creation:
- `tournament_type`: Type of tournament (0-3)
- `max_players`: Maximum number of players
- `min_players`: Minimum number of players
- `entry_fee`: Entry fee amount
- `prize_pool`: Total prize pool
- `registration_start`: Registration start timestamp
- `registration_end`: Registration end timestamp
- `start_time`: Tournament start timestamp
- `description`: Tournament description

### Tournament
Tournament state and metadata:
- `tournament_id`: Unique tournament identifier
- `organizer`: Tournament organizer address
- `config`: Tournament configuration
- `state`: Current tournament state
- `current_phase`: Current tournament phase
- `current_round`: Current round number
- `total_players`: Total registered players
- `created_at`: Creation timestamp
- `updated_at`: Last update timestamp

### Match
Individual match data:
- `match_id`: Unique match identifier
- `player_a`: First player address
- `player_b`: Second player address
- `round`: Round number
- `status`: Match status
- `winner`: Winner address (if completed)
- `score_a`: Player A score
- `score_b`: Player B score
- `started_at`: Match start timestamp
- `completed_at`: Match completion timestamp

### PrizeEscrow
Prize pool management:
- `total_pool`: Total prize pool amount
- `distributed`: Amount already distributed
- `allocations`: Prize allocation structure

### TournamentAnalytics
Tournament statistics:
- `total_matches`: Total number of matches
- `completed_matches`: Number of completed matches
- `disputed_matches`: Number of disputed matches
- `average_match_duration`: Average match duration
- `total_prize_distributed`: Total prizes distributed

## Events

The contract emits the following events:

- `TournamentCreated`: When a tournament is created
- `PlayerRegistered`: When a player registers
- `BracketGenerated`: When bracket is generated
- `MatchResultUpdated`: When a match result is updated
- `TournamentAdvanced`: When tournament advances
- `PrizesDistributed`: When prizes are distributed
- `TournamentCancelled`: When tournament is cancelled
- `TournamentPaused`: When tournament is paused
- `TournamentResumed`: When tournament is resumed
- `DisputeRaised`: When a dispute is raised
- `DisputeResolved`: When a dispute is resolved

## Security Features

- **Access Control**: Admin-only functions for critical operations
- **State Validation**: Strict state transition validation
- **Parameter Validation**: Comprehensive input validation
- **Immutable Results**: Match results cannot be modified once completed
- **Prize Escrow**: Secure prize pool management
- **Audit Trail**: All operations emit events for transparency

## Testing

The contract includes comprehensive unit tests covering:

- Initialization
- Tournament creation with validation
- Player registration with capacity limits
- Bracket generation for all tournament types
- Match result updates with validation
- Tournament progression
- Prize distribution
- Governance controls (pause/resume)
- Emergency controls (cancellation)
- Dispute resolution
- Analytics tracking

Run tests with:
```bash
cargo test --package tournament-manager
```

## Integration

The tournament manager contract integrates with:
- **ArenaX Events**: Emits standardized events
- **Tournament Finalizer**: For finalizing tournament results
- **Match Contract**: For individual match management

## Build

```bash
cargo build --package tournament-manager --target wasm32-unknown-unknown --release
```

Note: Building requires Rust with the `wasm32-unknown-unknown` target and Soroban SDK.

## License

MIT
