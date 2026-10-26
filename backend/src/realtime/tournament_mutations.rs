//! Keep the authoritative tournament snapshot and prize pool in one transaction.
use sqlx::PgPool;
use uuid::Uuid;

pub async fn add_to_prize_pool(
    pool: &PgPool,
    tournament_id: Uuid,
    entry_fee: i64,
) -> Result<(String, String), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let (amount, currency) = sqlx::query_as::<_, (String, String)>(
        "UPDATE prize_pools SET total_amount = total_amount + $1::bigint, updated_at = NOW()
         WHERE tournament_id = $2 RETURNING total_amount::text, currency",
    )
    .bind(entry_fee)
    .bind(tournament_id)
    .fetch_one(&mut *transaction)
    .await?;
    let updated = sqlx::query(
        "UPDATE tournaments SET prize_pool = $1::text::numeric,
         prize_pool_currency = $2, updated_at = NOW() WHERE id = $3",
    )
    .bind(&amount)
    .bind(&currency)
    .bind(tournament_id)
    .execute(&mut *transaction)
    .await?;
    if updated.rows_affected() != 1 {
        return Err(sqlx::Error::RowNotFound);
    }
    transaction.commit().await?;
    Ok((amount, currency))
}
