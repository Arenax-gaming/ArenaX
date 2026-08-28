//! Uniform state-change events and replay (Issue #878).
//!
//! Every domain module in this crate emits events shaped for its own domain,
//! which is right for consumers who know that domain. It leaves two gaps:
//!
//! 1. **No uniform record of a change.** An indexer that wants to answer "who
//!    changed what, from what, to what" has to understand every event type
//!    separately, and a domain that forgets to name the actor is indistinguishable
//!    from one where the actor did not matter.
//! 2. **No way to rebuild state.** Events are emitted but nothing consumes them
//!    back into the values they describe, so the log cannot be used to
//!    reconstruct or audit what the contract believes.
//!
//! [`StateChange`] is a domain-agnostic envelope carrying actor, resource,
//! field, and the old and new values. [`StateProjection`] folds a sequence of
//! them back into current values, which is what makes the log authoritative
//! rather than decorative — and gives a test a way to prove the two agree.
//!
//! Values are carried as `String` deliberately. A typed union would need
//! extending for every new field type and would break every consumer when it
//! changed; a string is what an indexer writes to its column anyway, and the
//! owning domain's typed event remains the precise record.

use soroban_sdk::{contractevent, contracttype, Address, Env, Map, String, Symbol, Vec};

pub const NAMESPACE: &str = "ArenaXStateChange";
pub const VERSION: &str = "v1";

/// A single audited state transition.
///
/// `sequence` is per-resource and monotonic: it is what lets a consumer detect
/// a gap (an event it never received) rather than silently projecting a state
/// that skipped a change.
#[contractevent(topics = ["ArenaXStCh_v1", "CHANGED"])]
pub struct StateChange {
    /// Who caused the change.
    pub actor: Address,
    /// The kind of thing changed, e.g. `match`, `tournament`, `stake`.
    pub resource: Symbol,
    /// Which instance of it.
    pub resource_id: String,
    /// Which field of that instance.
    pub field: Symbol,
    /// Value before the change. Empty when the field is being set for the
    /// first time — creation is a change from nothing.
    pub old_value: String,
    /// Value after the change.
    pub new_value: String,
    /// Per-resource monotonic sequence number.
    pub sequence: u64,
    /// Ledger timestamp.
    pub changed_at: u64,
}

/// The same record in a form a projection can hold and replay.
///
/// `#[contractevent]` types are write-only — they publish, they do not come
/// back — so replay needs a plain value type carrying identical fields.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StateChangeRecord {
    pub actor: Address,
    pub resource: Symbol,
    pub resource_id: String,
    pub field: Symbol,
    pub old_value: String,
    pub new_value: String,
    pub sequence: u64,
    pub changed_at: u64,
}

/// Emit a state change.
#[allow(clippy::too_many_arguments)]
pub fn emit_state_change(
    env: &Env,
    actor: &Address,
    resource: &Symbol,
    resource_id: &String,
    field: &Symbol,
    old_value: &String,
    new_value: &String,
    sequence: u64,
) {
    StateChange {
        actor: actor.clone(),
        resource: resource.clone(),
        resource_id: resource_id.clone(),
        field: field.clone(),
        old_value: old_value.clone(),
        new_value: new_value.clone(),
        sequence,
        changed_at: env.ledger().timestamp(),
    }
    .publish(env);
}

/// Emit a change and return the next sequence number, so a caller threading
/// changes through one resource cannot forget to advance it.
#[allow(clippy::too_many_arguments)]
pub fn emit_and_advance(
    env: &Env,
    actor: &Address,
    resource: &Symbol,
    resource_id: &String,
    field: &Symbol,
    old_value: &String,
    new_value: &String,
    sequence: u64,
) -> u64 {
    emit_state_change(
        env, actor, resource, resource_id, field, old_value, new_value, sequence,
    );
    sequence.saturating_add(1)
}

/// Result of replaying a change log.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectionResult {
    /// Field name → current value.
    pub fields: Map<Symbol, String>,
    /// Highest sequence number applied.
    pub last_sequence: u64,
    /// Changes actually applied.
    pub applied: u32,
    /// Changes skipped as out of order or already seen.
    pub skipped: u32,
    /// True when a sequence number was missing from the log, so the projection
    /// is built on an incomplete history and should not be trusted as current.
    pub has_gap: bool,
}

/// Rebuild a resource's current field values from its change log.
///
/// Applies changes in sequence order, ignoring anything at or below the last
/// applied sequence — a replayed or duplicated event must not move state, which
/// is what makes reprocessing a log safe.
///
/// A missing sequence number sets `has_gap`. The projection is still returned,
/// because a partial answer plus a warning is more useful to an operator than
/// no answer, but the flag is what says whether to trust it.
pub fn project_resource(
    env: &Env,
    changes: &Vec<StateChangeRecord>,
    resource: &Symbol,
    resource_id: &String,
) -> ProjectionResult {
    let mut fields: Map<Symbol, String> = Map::new(env);
    let mut last_sequence: u64 = 0;
    let mut applied: u32 = 0;
    let mut skipped: u32 = 0;
    let mut has_gap = false;
    let mut started = false;

    // Sequence order, not arrival order: events can reach a consumer out of
    // order, and the log's own numbering is the authority.
    let ordered = sort_by_sequence(env, changes);

    for change in ordered.iter() {
        if change.resource != *resource || change.resource_id != *resource_id {
            continue;
        }

        if started && change.sequence <= last_sequence {
            // Duplicate or stale replay — already reflected in the projection.
            skipped = skipped.saturating_add(1);
            continue;
        }

        if started && change.sequence > last_sequence.saturating_add(1) {
            has_gap = true;
        }

        fields.set(change.field.clone(), change.new_value.clone());
        last_sequence = change.sequence;
        applied = applied.saturating_add(1);
        started = true;
    }

    ProjectionResult {
        fields,
        last_sequence,
        applied,
        skipped,
        has_gap,
    }
}

/// Insertion sort by sequence.
///
/// The log for a single resource is short and usually already ordered, which is
/// the case insertion sort is best at — and it avoids the allocation a merge
/// sort would need in a `no_std` contract.
fn sort_by_sequence(env: &Env, changes: &Vec<StateChangeRecord>) -> Vec<StateChangeRecord> {
    let mut sorted: Vec<StateChangeRecord> = Vec::new(env);

    for change in changes.iter() {
        let mut index = sorted.len();
        for i in 0..sorted.len() {
            if let Some(existing) = sorted.get(i) {
                if change.sequence < existing.sequence {
                    index = i;
                    break;
                }
            }
        }
        sorted.insert(index, change);
    }

    sorted
}

/// Current value of one field after replay, if the log ever set it.
pub fn field_value(projection: &ProjectionResult, field: &Symbol) -> Option<String> {
    projection.fields.get(field.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events as _};
    use soroban_sdk::{symbol_short, Env};

    fn record(
        env: &Env,
        actor: &Address,
        field: &str,
        old: &str,
        new: &str,
        sequence: u64,
    ) -> StateChangeRecord {
        StateChangeRecord {
            actor: actor.clone(),
            resource: symbol_short!("match"),
            resource_id: String::from_str(env, "m-1"),
            field: Symbol::new(env, field),
            old_value: String::from_str(env, old),
            new_value: String::from_str(env, new),
            sequence,
            changed_at: 1_700_000_000 + sequence,
        }
    }

    fn log(env: &Env, records: &[StateChangeRecord]) -> Vec<StateChangeRecord> {
        let mut v = Vec::new(env);
        for r in records {
            v.push_back(r.clone());
        }
        v
    }

    #[test]
    fn rebuilds_current_values_from_the_log() {
        let env = Env::default();
        let actor = Address::generate(&env);
        let changes = log(
            &env,
            &[
                record(&env, &actor, "status", "", "pending", 1),
                record(&env, &actor, "status", "pending", "active", 2),
                record(&env, &actor, "score", "", "10", 3),
            ],
        );

        let projected = project_resource(
            &env,
            &changes,
            &symbol_short!("match"),
            &String::from_str(&env, "m-1"),
        );

        assert_eq!(
            field_value(&projected, &Symbol::new(&env, "status")),
            Some(String::from_str(&env, "active"))
        );
        assert_eq!(
            field_value(&projected, &Symbol::new(&env, "score")),
            Some(String::from_str(&env, "10"))
        );
        assert_eq!(projected.applied, 3);
        assert_eq!(projected.last_sequence, 3);
        assert!(!projected.has_gap);
    }

    #[test]
    fn applies_changes_in_sequence_order_not_arrival_order() {
        let env = Env::default();
        let actor = Address::generate(&env);
        // Delivered backwards, as an indexer reading from two shards might.
        let changes = log(
            &env,
            &[
                record(&env, &actor, "status", "pending", "active", 2),
                record(&env, &actor, "status", "", "pending", 1),
            ],
        );

        let projected = project_resource(
            &env,
            &changes,
            &symbol_short!("match"),
            &String::from_str(&env, "m-1"),
        );

        assert_eq!(
            field_value(&projected, &Symbol::new(&env, "status")),
            Some(String::from_str(&env, "active"))
        );
    }

    #[test]
    fn replaying_the_same_event_does_not_move_state() {
        let env = Env::default();
        let actor = Address::generate(&env);
        let changes = log(
            &env,
            &[
                record(&env, &actor, "status", "", "pending", 1),
                record(&env, &actor, "status", "", "pending", 1),
            ],
        );

        let projected = project_resource(
            &env,
            &changes,
            &symbol_short!("match"),
            &String::from_str(&env, "m-1"),
        );

        assert_eq!(projected.applied, 1);
        assert_eq!(projected.skipped, 1);
    }

    #[test]
    fn flags_a_gap_rather_than_pretending_the_state_is_current() {
        let env = Env::default();
        let actor = Address::generate(&env);
        let changes = log(
            &env,
            &[
                record(&env, &actor, "status", "", "pending", 1),
                record(&env, &actor, "status", "active", "finished", 4),
            ],
        );

        let projected = project_resource(
            &env,
            &changes,
            &symbol_short!("match"),
            &String::from_str(&env, "m-1"),
        );

        assert!(projected.has_gap, "sequences 2 and 3 are missing");
        assert_eq!(projected.last_sequence, 4);
    }

    #[test]
    fn ignores_changes_belonging_to_another_resource() {
        let env = Env::default();
        let actor = Address::generate(&env);
        let mut other = record(&env, &actor, "status", "", "cancelled", 2);
        other.resource_id = String::from_str(&env, "m-2");

        let changes = log(&env, &[record(&env, &actor, "status", "", "pending", 1), other]);

        let projected = project_resource(
            &env,
            &changes,
            &symbol_short!("match"),
            &String::from_str(&env, "m-1"),
        );

        assert_eq!(projected.applied, 1);
        assert_eq!(
            field_value(&projected, &Symbol::new(&env, "status")),
            Some(String::from_str(&env, "pending"))
        );
    }

    #[test]
    fn ignores_a_different_resource_kind_with_the_same_id() {
        let env = Env::default();
        let actor = Address::generate(&env);
        let mut other = record(&env, &actor, "status", "", "open", 2);
        other.resource = symbol_short!("tourney");

        let changes = log(&env, &[record(&env, &actor, "status", "", "pending", 1), other]);

        let projected = project_resource(
            &env,
            &changes,
            &symbol_short!("match"),
            &String::from_str(&env, "m-1"),
        );

        assert_eq!(projected.applied, 1);
    }

    #[test]
    fn an_empty_log_projects_to_nothing() {
        let env = Env::default();
        let changes: Vec<StateChangeRecord> = Vec::new(&env);

        let projected = project_resource(
            &env,
            &changes,
            &symbol_short!("match"),
            &String::from_str(&env, "m-1"),
        );

        assert_eq!(projected.applied, 0);
        assert_eq!(projected.last_sequence, 0);
        assert!(!projected.has_gap);
        assert!(field_value(&projected, &Symbol::new(&env, "status")).is_none());
    }

    #[test]
    fn records_the_actor_and_both_values() {
        let env = Env::default();
        let actor = Address::generate(&env);
        let change = record(&env, &actor, "status", "pending", "active", 1);

        assert_eq!(change.actor, actor);
        assert_eq!(change.old_value, String::from_str(&env, "pending"));
        assert_eq!(change.new_value, String::from_str(&env, "active"));
    }

    #[test]
    fn emitting_publishes_one_event() {
        let env = Env::default();
        let contract = env.register(crate::state_change::tests::Dummy, ());
        let actor = Address::generate(&env);

        env.as_contract(&contract, || {
            emit_state_change(
                &env,
                &actor,
                &symbol_short!("match"),
                &String::from_str(&env, "m-1"),
                &Symbol::new(&env, "status"),
                &String::from_str(&env, ""),
                &String::from_str(&env, "pending"),
                1,
            );
        });

        assert_eq!(env.events().all().len(), 1);
    }

    #[test]
    fn emit_and_advance_returns_the_next_sequence() {
        let env = Env::default();
        let contract = env.register(crate::state_change::tests::Dummy, ());
        let actor = Address::generate(&env);

        let next = env.as_contract(&contract, || {
            emit_and_advance(
                &env,
                &actor,
                &symbol_short!("match"),
                &String::from_str(&env, "m-1"),
                &Symbol::new(&env, "status"),
                &String::from_str(&env, ""),
                &String::from_str(&env, "pending"),
                7,
            )
        });

        assert_eq!(next, 8);
    }

    #[soroban_sdk::contract]
    pub struct Dummy;
}
