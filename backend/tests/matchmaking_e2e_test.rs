//! End-to-end matchmaking pipeline test (#1421):
//! queue -> match -> result -> ELO update -> leaderboard update.
//!
//! Runs entirely against in-memory stores (the queue store mirrors the Redis
//! key layout used by the matchmaker), so it needs no Postgres or Redis.

use arenax_backend::service::matchmaker::queue_entry_key;
use arenax_backend::service::matchmaking_pipeline::{
    InMemoryMatchmakingPipeline, LeaderboardStore, MatchStore, PipelineError,
    PipelineMatchStatus, QueueStore,
};
use uuid::Uuid;

const GAME: &str = "arena";
const MODE: &str = "ranked_1v1";

#[test]
fn test_full_matchmaking_pipeline_updates_elo_and_leaderboard() {
    let pipeline = InMemoryMatchmakingPipeline::in_memory();

    let alice = Uuid::new_v4();
    let bob = Uuid::new_v4();
    let carol = Uuid::new_v4(); // on the leaderboard, never queued
    let dave = Uuid::new_v4(); // queued, but far outside the ELO window

    pipeline.register_player(alice, GAME, 1500);
    pipeline.register_player(bob, GAME, 1550);
    pipeline.register_player(carol, GAME, 1510);
    pipeline.register_player(dave, GAME, 2200);

    // Before: dave 2200, bob 1550, carol 1510, alice 1500.
    assert_eq!(pipeline.rank(&dave, GAME), Some(1));
    assert_eq!(pipeline.rank(&bob, GAME), Some(2));
    assert_eq!(pipeline.rank(&carol, GAME), Some(3));
    assert_eq!(pipeline.rank(&alice, GAME), Some(4));

    // 1. Queue
    let entry = pipeline.enqueue(alice, GAME, MODE).unwrap();
    assert_eq!(entry.current_elo, 1500);
    pipeline.enqueue(bob, GAME, MODE).unwrap();
    pipeline.enqueue(dave, GAME, MODE).unwrap();
    assert_eq!(pipeline.queue().entries(GAME, MODE).len(), 3);
    assert_eq!(
        pipeline.enqueue(alice, GAME, MODE).unwrap_err(),
        PipelineError::AlreadyQueued
    );

    // 2. Match: the two similarly rated players are paired.
    let matches = pipeline.run_matchmaking(GAME, MODE);
    assert_eq!(matches.len(), 1);
    let game_match = &matches[0];
    let mut players = [game_match.player1_id, game_match.player2_id];
    players.sort();
    let mut expected = [alice, bob];
    expected.sort();
    assert_eq!(players, expected);
    assert_eq!(game_match.status, PipelineMatchStatus::Pending);
    assert!(pipeline.matches().get(&game_match.id).is_some());

    // Matched players leave the queue; the outlier keeps waiting.
    let remaining = pipeline.queue().entries(GAME, MODE);
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].user_id, dave);
    assert!(pipeline.queue().get(&alice, GAME, MODE).is_none());
    assert!(pipeline.queue().get(&bob, GAME, MODE).is_none());

    // 3. Result: alice (lower rated) beats bob.
    let completed = pipeline.report_result(game_match.id, Some(alice)).unwrap();
    assert_eq!(completed.status, PipelineMatchStatus::Completed);
    assert_eq!(completed.winner_id, Some(alice));

    // 4. ELO: K=32, 1500 vs 1550 -> winner +18, loser -18.
    assert_eq!(pipeline.rating(&alice, GAME), 1518);
    assert_eq!(pipeline.rating(&bob, GAME), 1532);
    assert_eq!(pipeline.rating(&carol, GAME), 1510);
    let (alice_after, bob_after) = if completed.player1_id == alice {
        (completed.player1_elo_after, completed.player2_elo_after)
    } else {
        (completed.player2_elo_after, completed.player1_elo_after)
    };
    assert_eq!(alice_after, Some(1518));
    assert_eq!(bob_after, Some(1532));

    // 5. Leaderboard reflects the result immediately.
    assert_eq!(pipeline.rank(&dave, GAME), Some(1));
    assert_eq!(pipeline.rank(&bob, GAME), Some(2));
    assert_eq!(pipeline.rank(&alice, GAME), Some(3));
    assert_eq!(pipeline.rank(&carol, GAME), Some(4));
    let standings = pipeline.leaderboard().standings(GAME);
    assert_eq!(
        standings,
        vec![(dave, 2200), (bob, 1532), (alice, 1518), (carol, 1510)]
    );
}

#[test]
fn test_draw_moves_ratings_toward_each_other() {
    let pipeline = InMemoryMatchmakingPipeline::in_memory();
    let low = Uuid::new_v4();
    let high = Uuid::new_v4();
    pipeline.register_player(low, GAME, 1400);
    pipeline.register_player(high, GAME, 1480);

    pipeline.enqueue(low, GAME, MODE).unwrap();
    pipeline.enqueue(high, GAME, MODE).unwrap();
    let matches = pipeline.run_matchmaking(GAME, MODE);
    assert_eq!(matches.len(), 1);

    pipeline.report_result(matches[0].id, None).unwrap();

    assert!(pipeline.rating(&low, GAME) > 1400);
    assert!(pipeline.rating(&high, GAME) < 1480);
}

#[test]
fn test_result_cannot_be_reported_twice_or_for_outsiders() {
    let pipeline = InMemoryMatchmakingPipeline::in_memory();
    let p1 = Uuid::new_v4();
    let p2 = Uuid::new_v4();
    pipeline.register_player(p1, GAME, 1300);
    pipeline.register_player(p2, GAME, 1320);
    pipeline.enqueue(p1, GAME, MODE).unwrap();
    pipeline.enqueue(p2, GAME, MODE).unwrap();
    let match_id = pipeline.run_matchmaking(GAME, MODE)[0].id;

    assert_eq!(
        pipeline.report_result(match_id, Some(Uuid::new_v4())),
        Err(PipelineError::InvalidWinner)
    );
    assert_eq!(
        pipeline.report_result(Uuid::new_v4(), Some(p1)),
        Err(PipelineError::MatchNotFound)
    );

    pipeline.report_result(match_id, Some(p1)).unwrap();
    let rating_after = pipeline.rating(&p1, GAME);
    assert_eq!(
        pipeline.report_result(match_id, Some(p1)),
        Err(PipelineError::MatchAlreadyCompleted)
    );
    assert_eq!(pipeline.rating(&p1, GAME), rating_after);
}

#[test]
fn test_single_player_is_not_matched() {
    let pipeline = InMemoryMatchmakingPipeline::in_memory();
    let solo = Uuid::new_v4();
    pipeline.enqueue(solo, GAME, MODE).unwrap();

    assert!(pipeline.run_matchmaking(GAME, MODE).is_empty());
    assert!(pipeline.queue().get(&solo, GAME, MODE).is_some());
}

#[test]
fn test_queue_store_uses_matchmaker_redis_keys() {
    let pipeline = InMemoryMatchmakingPipeline::in_memory();
    let user = Uuid::new_v4();
    pipeline.enqueue(user, GAME, MODE).unwrap();

    assert_eq!(
        queue_entry_key(GAME, MODE, &user),
        format!("queue_entry:{}:{}:{}", GAME, MODE, user)
    );
    // Different modes are isolated queues.
    assert!(pipeline.queue().entries(GAME, "casual").is_empty());
    assert!(pipeline.leaderboard().rank(GAME, &user).is_none());
}
