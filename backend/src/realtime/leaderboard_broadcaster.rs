//! Real-time leaderboard delta broadcasting (Issue #900).
//!
//! Leaderboards only moved on refresh before this: a client had to re-request
//! the whole board to notice that anything had changed. Pushing the full board
//! on every rank change is not an option either — a 10,000-entry board is
//! roughly a megabyte of JSON, and a single match completion can shift the rank
//! of every player below the winner.
//!
//! So this module broadcasts *deltas*. It keeps the last published rank for
//! each player in memory, diffs a fresh board against it, and emits only the
//! entries that actually moved. The client holds its own copy of the board and
//! applies the patch (see [`LeaderboardDelta`] for the merge contract).
//!
//! # Memory
//!
//! The snapshot is the reason this stays cheap at 10K+ users. Each tracked
//! player costs a `Uuid` key plus a [`RankSnapshot`] of two `i32`s — 24 bytes
//! of payload — so a 10,000-player board is a few hundred KB including
//! `HashMap` overhead, not the megabytes a cached board of full
//! `LeaderboardEntry` rows (username, avatar URL, timestamps) would cost.
//! Nothing here holds a `String`.
//!
//! # Throttling
//!
//! Deltas are coalesced per player at one update per second. A tournament
//! finishing can produce a burst of rank churn in a few hundred milliseconds;
//! without coalescing each client would receive a dozen messages describing
//! intermediate states it never needed to render. Pending changes accumulate
//! and the newest rank for a player wins, so a throttled client sees fewer
//! messages but never a stale final position.

use crate::realtime::event_bus::EventBus;
use crate::realtime::events::{channels, RankChange, RealtimeEvent};
use chrono::Utc;
use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};
use tracing::debug;
use uuid::Uuid;

/// Minimum interval between two deltas mentioning the same player.
pub const PER_USER_THROTTLE: Duration = Duration::from_secs(1);

/// Compact per-player state. Deliberately free of owned strings — see the
/// module docs on memory.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RankSnapshot {
    pub ranking: i32,
    pub elo_rating: i32,
}

/// A player's rank as it currently stands, used as diff input.
#[derive(Debug, Clone, Copy)]
pub struct RankObservation {
    pub user_id: Uuid,
    pub ranking: i32,
    pub elo_rating: i32,
}

/// Per-category snapshot of the last ranks published to clients.
#[derive(Default)]
struct CategoryState {
    ranks: HashMap<Uuid, RankSnapshot>,
    /// Last time a delta mentioning this player was emitted.
    last_sent: HashMap<Uuid, Instant>,
    /// Changes held back by the throttle, newest value per player.
    pending: HashMap<Uuid, RankChange>,
    /// Incremented on every emitted delta so clients can detect a gap and
    /// re-sync rather than applying a patch to a board they have drifted from.
    version: u64,
}

/// Tracks published ranks and produces deltas against them.
pub struct LeaderboardTracker {
    categories: RwLock<HashMap<String, CategoryState>>,
}

impl Default for LeaderboardTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl LeaderboardTracker {
    pub fn new() -> Self {
        Self {
            categories: RwLock::new(HashMap::new()),
        }
    }

    /// Diffs `observations` against the last published state for `category`
    /// and returns the changes that are due to be sent now.
    ///
    /// Players absent from `observations` are left alone rather than treated as
    /// removed: callers normally pass a page of the board, not the whole thing,
    /// and inferring a removal from a partial view would emit a bogus delta.
    /// Use [`Self::forget`] for an actual removal.
    pub fn diff(&self, category: &str, observations: &[RankObservation]) -> Vec<RankChange> {
        let now = Instant::now();
        let mut categories = self.categories.write().unwrap();
        let state = categories.entry(category.to_string()).or_default();

        for obs in observations {
            let snapshot = RankSnapshot {
                ranking: obs.ranking,
                elo_rating: obs.elo_rating,
            };

            let previous = state.ranks.get(&obs.user_id).copied();
            if previous == Some(snapshot) {
                continue; // Unmoved — nothing to say about this player.
            }

            state.ranks.insert(obs.user_id, snapshot);

            // Newest observation replaces any pending one, but the *original*
            // previous rank is preserved so the client sees one coherent
            // "moved from X to Y" rather than a chain of hops.
            let previous_ranking = state
                .pending
                .get(&obs.user_id)
                .and_then(|p| p.previous_ranking)
                .or_else(|| previous.map(|p| p.ranking));

            state.pending.insert(
                obs.user_id,
                RankChange {
                    user_id: obs.user_id,
                    ranking: obs.ranking,
                    previous_ranking,
                    elo_rating: obs.elo_rating,
                },
            );
        }

        Self::drain_due(state, now)
    }

    /// Releases pending changes whose throttle window has elapsed.
    fn drain_due(state: &mut CategoryState, now: Instant) -> Vec<RankChange> {
        let due: Vec<Uuid> = state
            .pending
            .keys()
            .copied()
            .filter(|user_id| match state.last_sent.get(user_id) {
                Some(sent) => now.duration_since(*sent) >= PER_USER_THROTTLE,
                None => true,
            })
            .collect();

        let mut changes = Vec::with_capacity(due.len());
        for user_id in due {
            if let Some(change) = state.pending.remove(&user_id) {
                state.last_sent.insert(user_id, now);
                changes.push(change);
            }
        }

        // Rank order makes the payload easier to reason about on the client and
        // costs nothing next to the diff itself.
        changes.sort_by_key(|c| c.ranking);
        changes
    }

    /// Releases any changes whose throttle has since elapsed, without diffing.
    ///
    /// Call this on a timer so the last change in a burst is not left sitting
    /// in `pending` until the next unrelated update arrives.
    pub fn flush_pending(&self, category: &str) -> Vec<RankChange> {
        let now = Instant::now();
        let mut categories = self.categories.write().unwrap();
        match categories.get_mut(category) {
            Some(state) => Self::drain_due(state, now),
            None => Vec::new(),
        }
    }

    /// Categories currently holding state, for the periodic flush.
    pub fn categories(&self) -> Vec<String> {
        self.categories.read().unwrap().keys().cloned().collect()
    }

    /// Takes the next version number for `category`.
    fn next_version(&self, category: &str) -> u64 {
        let mut categories = self.categories.write().unwrap();
        let state = categories.entry(category.to_string()).or_default();
        state.version += 1;
        state.version
    }

    /// Drops a player from the snapshot — use when they leave the board
    /// entirely, so a later reappearance is reported as a fresh entry.
    pub fn forget(&self, category: &str, user_id: &Uuid) {
        let mut categories = self.categories.write().unwrap();
        if let Some(state) = categories.get_mut(category) {
            state.ranks.remove(user_id);
            state.last_sent.remove(user_id);
            state.pending.remove(user_id);
        }
    }

    /// Number of players tracked for a category. Exposed for metrics and to
    /// make the memory characteristics testable.
    pub fn tracked_players(&self, category: &str) -> usize {
        self.categories
            .read()
            .unwrap()
            .get(category)
            .map(|s| s.ranks.len())
            .unwrap_or(0)
    }
}

/// Publishes leaderboard deltas to subscribed WebSocket clients.
pub struct LeaderboardBroadcaster {
    tracker: LeaderboardTracker,
    event_bus: EventBus,
}

impl LeaderboardBroadcaster {
    pub fn new(event_bus: EventBus) -> Self {
        Self {
            tracker: LeaderboardTracker::new(),
            event_bus,
        }
    }

    pub fn tracker(&self) -> &LeaderboardTracker {
        &self.tracker
    }

    /// Diffs the observations and publishes a delta if anything moved.
    pub async fn publish_changes(&self, category: &str, observations: &[RankObservation]) {
        let changes = self.tracker.diff(category, observations);
        self.emit(category, changes).await;
    }

    /// Publishes anything the throttle was holding back. Drive this from a
    /// ~1s timer.
    pub async fn flush(&self, category: &str) {
        let changes = self.tracker.flush_pending(category);
        self.emit(category, changes).await;
    }

    /// Flushes every category that currently holds state.
    pub async fn flush_all(&self) {
        for category in self.tracker.categories() {
            self.flush(&category).await;
        }
    }

    async fn emit(&self, category: &str, changes: Vec<RankChange>) {
        if changes.is_empty() {
            return;
        }

        let count = changes.len();
        let event = RealtimeEvent::LeaderboardDelta {
            category: category.to_string(),
            version: self.tracker.next_version(category),
            changes,
            timestamp: Utc::now().to_rfc3339(),
        };

        self.event_bus
            .publish_to_channel(&channels::leaderboard_channel(category), &event)
            .await;

        debug!(
            category = %category,
            changes = count,
            "Published leaderboard delta"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obs(user_id: Uuid, ranking: i32, elo: i32) -> RankObservation {
        RankObservation {
            user_id,
            ranking,
            elo_rating: elo,
        }
    }

    #[test]
    fn first_observation_is_reported_with_no_previous_rank() {
        let tracker = LeaderboardTracker::new();
        let user = Uuid::new_v4();

        let changes = tracker.diff("fifa", &[obs(user, 1, 1500)]);

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].ranking, 1);
        assert_eq!(changes[0].previous_ranking, None);
    }

    #[test]
    fn unchanged_ranks_produce_no_delta() {
        let tracker = LeaderboardTracker::new();
        let user = Uuid::new_v4();

        tracker.diff("fifa", &[obs(user, 1, 1500)]);
        let changes = tracker.diff("fifa", &[obs(user, 1, 1500)]);

        assert!(changes.is_empty(), "a still board must not emit anything");
    }

    #[test]
    fn only_moved_players_appear_in_the_delta() {
        let tracker = LeaderboardTracker::new();
        let steady = Uuid::new_v4();
        let mover = Uuid::new_v4();

        tracker.diff("fifa", &[obs(steady, 1, 1500), obs(mover, 2, 1400)]);

        // Enough time must pass for the throttle to release the mover again.
        std::thread::sleep(PER_USER_THROTTLE);

        let changes = tracker.diff("fifa", &[obs(steady, 1, 1500), obs(mover, 2, 1450)]);

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].user_id, mover);
    }

    #[test]
    fn a_burst_is_coalesced_to_one_change_per_player() {
        let tracker = LeaderboardTracker::new();
        let user = Uuid::new_v4();

        let first = tracker.diff("fifa", &[obs(user, 5, 1300)]);
        assert_eq!(first.len(), 1, "the first change goes out immediately");

        // Three more moves inside the throttle window.
        assert!(tracker.diff("fifa", &[obs(user, 4, 1320)]).is_empty());
        assert!(tracker.diff("fifa", &[obs(user, 3, 1340)]).is_empty());
        assert!(tracker.diff("fifa", &[obs(user, 2, 1360)]).is_empty());

        std::thread::sleep(PER_USER_THROTTLE);
        let flushed = tracker.flush_pending("fifa");

        assert_eq!(flushed.len(), 1, "the burst collapses into one change");
        assert_eq!(flushed[0].ranking, 2, "and it carries the newest rank");
        assert_eq!(
            flushed[0].previous_ranking,
            Some(5),
            "with the rank the client last saw, not an intermediate hop"
        );
    }

    #[test]
    fn categories_are_tracked_independently() {
        let tracker = LeaderboardTracker::new();
        let user = Uuid::new_v4();

        tracker.diff("fifa", &[obs(user, 1, 1500)]);
        let changes = tracker.diff("cod", &[obs(user, 7, 1100)]);

        assert_eq!(changes.len(), 1, "the same player ranks separately per game");
        assert_eq!(tracker.tracked_players("fifa"), 1);
        assert_eq!(tracker.tracked_players("cod"), 1);
    }

    #[test]
    fn forget_drops_a_player_from_the_snapshot() {
        let tracker = LeaderboardTracker::new();
        let user = Uuid::new_v4();

        tracker.diff("fifa", &[obs(user, 1, 1500)]);
        tracker.forget("fifa", &user);

        assert_eq!(tracker.tracked_players("fifa"), 0);

        let changes = tracker.diff("fifa", &[obs(user, 1, 1500)]);
        assert_eq!(changes.len(), 1, "a reappearance is a fresh entry");
        assert_eq!(changes[0].previous_ranking, None);
    }

    #[test]
    fn snapshot_stays_small_for_a_large_board() {
        // Guards the memory claim in the module docs: the per-player cost must
        // stay a pair of i32s, not a full leaderboard row.
        assert_eq!(std::mem::size_of::<RankSnapshot>(), 8);

        let tracker = LeaderboardTracker::new();
        let observations: Vec<RankObservation> = (0..10_000)
            .map(|i| obs(Uuid::new_v4(), i + 1, 2000 - i))
            .collect();

        tracker.diff("fifa", &observations);
        assert_eq!(tracker.tracked_players("fifa"), 10_000);
    }
}
