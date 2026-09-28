# Batch Currency Operations — Gas Benchmarks

`batch_mint_currency`, `batch_transfer_currency`, and `batch_burn_currency`
(see `src/batch.rs` and the "Currency Management: Gas-Optimized Batch
Operations" section of `src/lib.rs`) replace N sequential calls to the
single-item entry points with one call that amortizes shared state access
across the whole batch.

## Where the savings come from

Each single-item call (`mint_currency`, `transfer_currency`,
`burn_currency`) independently reads and writes:

- `TotalCurrencySupply` (mint/burn)
- `EconomyAnalytics` (mint/burn)

Calling these N times therefore performs 2N redundant instance-storage
read/write round trips against state that only needs to reflect the batch's
*aggregate* effect once per transaction. The batch entry points instead:

1. Validate the entire batch up front (size limit, matching array lengths,
   positive amounts, sufficient balance) and reject atomically before any
   state is mutated.
2. Read `TotalCurrencySupply`/`EconomyAnalytics` once.
3. Accumulate the aggregate delta in memory while writing only the
   per-item storage keys that must individually change (recipient/owner
   balances — there's no way to avoid touching N distinct balance keys for
   N distinct addresses).
4. Write `TotalCurrencySupply`/`EconomyAnalytics` back once.

## Estimated savings

| Batch size | Per-item calls: storage ops | Batch call: storage ops | Reduction |
|-----------:|-----------------------------:|--------------------------:|----------:|
| 10         | 10 × (2 balance + 2 aggregate) = 40 | 10 balance + 2 aggregate = 12 | ~70% |
| 25         | 25 × 4 = 100                 | 25 + 2 = 27                | ~73% |
| 50 (max)   | 50 × 4 = 200                 | 50 + 2 = 52                | ~74% |

(`batch_transfer_currency` writes one aggregate `from` balance plus one `to`
balance per item instead of two balance writes per item across N calls, so
its reduction follows the same shape without a separate aggregate counter.)

Soroban's read/write instance-storage instructions dominate the resource
cost of these entry points (each is a fixed CPU + I/O charge independent of
the i128 payload size), so cutting redundant storage round trips is the
highest-leverage gas optimization available here — the savings converge
toward ~(N-1)/N of the aggregate-state overhead as batch size grows, i.e.
comfortably above the 30% target at any batch size above ~4 items.

## Gas limits enforced

`MAX_BATCH_SIZE = 50` (see `batch.rs`) caps every batch call so a single
invocation can't grow large enough to threaten the ledger's per-transaction
resource limits, and so the in-memory accumulation stays bounded. Callers
can read the configured ceiling on-chain via `get_max_batch_size`.
