//! Durable storage for Stellar/Soroban event ingestion.
use super::soroban_event_poller::{ContractEvent, EventStore};
use anyhow::{bail, ensure, Result};
use async_trait::async_trait;
use sqlx::PgPool;

/// Stream identity includes network and sorted contract filters, so a changed
/// network/filter cannot accidentally reuse another consumer's checkpoint.
#[derive(Clone)]
pub struct PostgresEventStore {
    pool: PgPool,
    stream: String,
}

impl PostgresEventStore {
    pub fn new(pool: PgPool, network: &str, contracts: &[String]) -> Self {
        let mut contracts = contracts.to_vec();
        contracts.sort();
        contracts.dedup();
        Self {
            pool,
            stream: serde_json::json!([network, contracts]).to_string(),
        }
    }
}

#[async_trait]
impl EventStore for PostgresEventStore {
    async fn checkpoint(&self, initial_ledger: u32) -> Result<u32> {
        sqlx::query("INSERT INTO soroban_event_checkpoints (stream, last_ledger) VALUES ($1, $2) ON CONFLICT (stream) DO NOTHING")
            .bind(&self.stream).bind(i64::from(initial_ledger)).execute(&self.pool).await?;
        let ledger: i64 = sqlx::query_scalar(
            "SELECT last_ledger FROM soroban_event_checkpoints WHERE stream = $1",
        )
        .bind(&self.stream)
        .fetch_one(&self.pool)
        .await?;
        Ok(u32::try_from(ledger)?)
    }

    async fn commit_ledger(&self, ledger: u32, events: &[ContractEvent]) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let last: i64 = sqlx::query_scalar(
            "SELECT last_ledger FROM soroban_event_checkpoints WHERE stream = $1 FOR UPDATE",
        )
        .bind(&self.stream)
        .fetch_one(&mut *tx)
        .await?;
        if last >= i64::from(ledger) {
            return Ok(());
        } // another replica already committed it
        ensure!(
            last + 1 == i64::from(ledger),
            "non-contiguous ledger commit"
        );
        for event in events {
            if event.ledger != ledger {
                bail!("event belongs to another ledger");
            }
            sqlx::query("INSERT INTO soroban_contract_events (stream, event_id, ledger, payload) VALUES ($1, $2, $3, $4) ON CONFLICT (stream, event_id) DO NOTHING")
                .bind(&self.stream).bind(&event.id).bind(i64::from(ledger))
                .bind(serde_json::to_value(event)?).execute(&mut *tx).await?;
        }
        sqlx::query("UPDATE soroban_event_checkpoints SET last_ledger = $2, updated_at = NOW() WHERE stream = $1")
            .bind(&self.stream).bind(i64::from(ledger)).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test(migrations = false)]
    async fn durable_checkpoint_atomic_inbox_and_reversible_migration(pool: PgPool) -> Result<()> {
        sqlx::raw_sql(include_str!(
            "../../migrations/20261125000001_soroban_event_checkpoints.up.sql"
        ))
        .execute(&pool)
        .await?;
        let contracts = vec!["contract".into()];
        let store = PostgresEventStore::new(pool.clone(), "testnet", &contracts);
        assert_eq!(store.checkpoint(10).await?, 10);
        let event = ContractEvent {
            id: "0000000000000000011-0000000000".into(),
            ledger: 11,
            payload: Default::default(),
        };
        store
            .commit_ledger(11, std::slice::from_ref(&event))
            .await?;
        let restarted = PostgresEventStore::new(pool.clone(), "testnet", &contracts);
        assert_eq!(restarted.checkpoint(99).await?, 11);
        restarted
            .commit_ledger(11, std::slice::from_ref(&event))
            .await?;
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM soroban_contract_events")
            .fetch_one(&pool)
            .await?;
        assert_eq!(count, 1);
        assert!(store.commit_ledger(13, &[]).await.is_err());

        // The first insert must roll back if any later event in the ledger fails.
        let valid = ContractEvent {
            id: "0000000000000000012-0000000000".into(),
            ledger: 12,
            payload: Default::default(),
        };
        assert!(store
            .commit_ledger(12, &[valid.clone(), event])
            .await
            .is_err());
        assert_eq!(store.checkpoint(0).await?, 11);
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM soroban_contract_events")
            .fetch_one(&pool)
            .await?;
        assert_eq!(count, 1);

        // Two replicas racing over the same ledger still insert it once.
        let (a, b) = tokio::join!(
            store.commit_ledger(12, std::slice::from_ref(&valid)),
            restarted.commit_ledger(12, std::slice::from_ref(&valid))
        );
        a?;
        b?;
        assert_eq!(restarted.checkpoint(0).await?, 12);
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM soroban_contract_events")
            .fetch_one(&pool)
            .await?;
        assert_eq!(count, 2);
        store.commit_ledger(13, &[]).await?;
        assert_eq!(store.checkpoint(0).await?, 13);
        let other = PostgresEventStore::new(pool.clone(), "mainnet", &contracts);
        assert_eq!(other.checkpoint(1).await?, 1);
        sqlx::raw_sql(include_str!(
            "../../migrations/20261125000001_soroban_event_checkpoints.down.sql"
        ))
        .execute(&pool)
        .await?;
        let exists: Option<String> =
            sqlx::query_scalar("SELECT to_regclass('soroban_event_checkpoints')::text")
                .fetch_one(&pool)
                .await?;
        assert!(exists.is_none());
        Ok(())
    }
}
