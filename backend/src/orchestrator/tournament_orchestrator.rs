use crate::db::DbPool;
use crate::orchestrator::{
    PayoutSettler, RoundAdvancementWorker, SeedingEngine, TournamentCleanup,
};
use sqlx::Row;
use std::time::Duration;
use tokio::time;

pub struct TournamentOrchestrator {
    pub seeding: SeedingEngine,
    pub advancement: RoundAdvancementWorker,
    pub payout: PayoutSettler,
    pub cleanup: TournamentCleanup,
}

impl TournamentOrchestrator {
    pub fn new(db_pool: DbPool) -> Self {
        Self {
            seeding: SeedingEngine::new(db_pool.clone()),
            advancement: RoundAdvancementWorker::new(db_pool.clone()),
            payout: PayoutSettler::new(db_pool.clone()),
            cleanup: TournamentCleanup::new(db_pool),
        }
    }

    pub fn spawn_polling_worker(db_pool: DbPool, interval_secs: u64) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let advancement = RoundAdvancementWorker::new(db_pool.clone());
            let payout = PayoutSettler::new(db_pool.clone());
            let cleanup = TournamentCleanup::new(db_pool.clone());

            let mut interval = time::interval(Duration::from_secs(interval_secs));

            loop {
                interval.tick().await;

                // Try to acquire advisory lock — skip this tick if another instance holds it
                let lock_acquired: bool = sqlx::query("SELECT pg_try_advisory_lock(hashtext('tournament_orchestrator_poll')) as locked")
                    .fetch_one(&db_pool)
                    .await
                    .map(|row: sqlx::postgres::PgRow| {
                        row.get::<bool, _>("locked")
                    })
                    .unwrap_or(false);

                if !lock_acquired {
                    tracing::debug!("Another instance holds the polling lock, skipping tick");
                    continue;
                }

                tracing::debug!("Tournament polling worker running...");

                if let Err(e) = advancement.poll_for_stale_rounds().await {
                    tracing::error!("Polling: round advancement error: {}", e);
                }

                if let Err(e) = payout.poll_for_unfinalized().await {
                    tracing::error!("Polling: payout finalization error: {}", e);
                }

                if let Err(e) = cleanup.poll_for_cleanup().await {
                    tracing::error!("Polling: cleanup error: {}", e);
                }

                let _ = sqlx::query("SELECT pg_advisory_unlock(hashtext('tournament_orchestrator_poll'))")
                    .execute(&db_pool)
                    .await;
            }
        })
    }
}
