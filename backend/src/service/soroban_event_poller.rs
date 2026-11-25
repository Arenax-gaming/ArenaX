//! Ordered, restart-safe ingestion of Soroban contract events.
//!
//! A checkpoint means every event in that ledger is durably ingested. RPC
//! requests happen outside DB transactions; event inserts and the checkpoint
//! advance commit together. Consumers can read the inbox in (ledger, event_id)
//! order without replaying network calls or depending on ephemeral Pub/Sub.
use anyhow::{ensure, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;

pub const PAGE_SIZE: usize = 1000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerWindow {
    pub oldest_ledger: u32,
    pub latest_ledger: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContractEvent {
    pub id: String,
    pub ledger: u32,
    #[serde(flatten)]
    pub payload: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventPage {
    pub events: Vec<ContractEvent>,
    pub cursor: String,
}

#[async_trait]
pub trait EventSource: Send + Sync {
    async fn ledger_window(&self) -> Result<LedgerWindow>;
    /// First page is bounded to one ledger. Cursor requests must omit both
    /// ledger bounds, per Stellar RPC; the poller stops at the target ledger.
    async fn event_page(
        &self,
        ledger: u32,
        cursor: Option<&str>,
        contracts: &[String],
    ) -> Result<EventPage>;
}

#[async_trait]
pub trait EventStore: Send + Sync {
    async fn checkpoint(&self, initial_ledger: u32) -> Result<u32>;
    async fn commit_ledger(&self, ledger: u32, events: &[ContractEvent]) -> Result<()>;
}

pub struct EventPoller<S, D> {
    source: Arc<S>,
    store: D,
    contracts: Vec<String>,
    start_ledger: Option<u32>,
}

impl<S: EventSource, D: EventStore> EventPoller<S, D> {
    pub fn new(
        source: Arc<S>,
        store: D,
        mut contracts: Vec<String>,
        start_ledger: Option<u32>,
    ) -> Result<Self> {
        contracts.sort();
        contracts.dedup();
        ensure!(
            !contracts.is_empty() && contracts.len() <= 5,
            "polling requires 1 to 5 contract IDs"
        );
        ensure!(start_ledger != Some(0), "start ledger must be positive");
        Ok(Self {
            source,
            store,
            contracts,
            start_ledger,
        })
    }

    /// Snapshot the head once. Catch-up completes before the next live snapshot.
    pub async fn poll_once(&self) -> Result<u32> {
        let window = self.source.ledger_window().await?;
        ensure!(
            window.oldest_ledger > 0 && window.oldest_ledger <= window.latest_ledger,
            "invalid RPC ledger window"
        );
        let initial = self.start_ledger.unwrap_or(window.latest_ledger) - 1;
        let last = self.store.checkpoint(initial).await?;
        ensure!(
            last <= window.latest_ledger,
            "checkpoint is ahead of RPC head; refusing to rewind"
        );
        let gap = window.latest_ledger - last;
        if gap > 100 {
            tracing::warn!(target: "soroban:gap_detected", event = "soroban:gap_detected", last_processed_ledger = last, current_ledger = window.latest_ledger, gap, "Soroban event ingestion is catching up");
        }
        if gap == 0 {
            return Ok(last);
        }
        ensure!(
            last + 1 >= window.oldest_ledger,
            "ledger gap is outside RPC retention; checkpoint preserved, archival RPC required"
        );
        for ledger in (last + 1)..=window.latest_ledger {
            let events = self.read_ledger(ledger).await?;
            self.store.commit_ledger(ledger, &events).await?;
        }
        Ok(window.latest_ledger)
    }

    async fn read_ledger(&self, ledger: u32) -> Result<Vec<ContractEvent>> {
        let mut cursor: Option<String> = None;
        let mut events = std::collections::BTreeMap::new();
        let mut cursors = std::collections::HashSet::new();
        loop {
            let page = self
                .source
                .event_page(ledger, cursor.as_deref(), &self.contracts)
                .await?;
            let count = page.events.len();
            let mut reached_next_ledger = false;
            for event in page.events {
                ensure!(
                    event.ledger >= ledger && !event.id.is_empty(),
                    "invalid event position"
                );
                if event.ledger > ledger {
                    reached_next_ledger = true;
                    continue;
                }
                // RPC IDs are zero-padded TOID + event index, hence lexical
                // order is transaction/operation/event order within a ledger.
                if let Some(previous) = events.insert(event.id.clone(), event.clone()) {
                    ensure!(previous == event, "conflicting duplicate RPC event");
                }
            }
            if reached_next_ledger || count < PAGE_SIZE {
                break;
            }
            ensure!(
                !page.cursor.is_empty() && cursors.insert(page.cursor.clone()),
                "RPC pagination did not advance"
            );
            cursor = Some(page.cursor);
        }
        Ok(events.into_values().collect())
    }

    pub async fn run(&self) {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if let Err(error) = self.poll_once().await {
                tracing::error!(%error, "Soroban event poll failed; retrying from durable checkpoint");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    struct Source {
        head: Mutex<LedgerWindow>,
        pages: Mutex<VecDeque<Result<EventPage>>>,
        requests: Mutex<Vec<(u32, Option<String>)>>,
    }
    #[async_trait]
    impl EventSource for Source {
        async fn ledger_window(&self) -> Result<LedgerWindow> {
            Ok(self.head.lock().unwrap().clone())
        }
        async fn event_page(
            &self,
            ledger: u32,
            cursor: Option<&str>,
            _: &[String],
        ) -> Result<EventPage> {
            self.requests
                .lock()
                .unwrap()
                .push((ledger, cursor.map(str::to_owned)));
            self.pages
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Ok(page(vec![], "end")))
        }
    }
    #[derive(Default)]
    struct State {
        last: Option<u32>,
        events: Vec<ContractEvent>,
        commits: Vec<u32>,
        fail: Option<u32>,
    }
    #[derive(Clone, Default)]
    struct Store(Arc<Mutex<State>>);
    #[async_trait]
    impl EventStore for Store {
        async fn checkpoint(&self, initial: u32) -> Result<u32> {
            Ok(*self.0.lock().unwrap().last.get_or_insert(initial))
        }
        async fn commit_ledger(&self, ledger: u32, events: &[ContractEvent]) -> Result<()> {
            let mut state = self.0.lock().unwrap();
            ensure!(state.fail != Some(ledger), "injected storage failure");
            assert_eq!(state.last.unwrap() + 1, ledger);
            state.events.extend_from_slice(events);
            state.last = Some(ledger);
            state.commits.push(ledger);
            Ok(())
        }
    }
    fn event(ledger: u32, index: usize) -> ContractEvent {
        ContractEvent {
            id: format!("{ledger:019}-{index:010}"),
            ledger,
            payload: Default::default(),
        }
    }
    fn page(events: Vec<ContractEvent>, cursor: &str) -> EventPage {
        EventPage {
            events,
            cursor: cursor.into(),
        }
    }
    fn source(oldest: u32, latest: u32, pages: Vec<Result<EventPage>>) -> Arc<Source> {
        Arc::new(Source {
            head: Mutex::new(LedgerWindow {
                oldest_ledger: oldest,
                latest_ledger: latest,
            }),
            pages: Mutex::new(pages.into()),
            requests: Mutex::new(vec![]),
        })
    }
    fn poller(source: Arc<Source>, store: Store, start: Option<u32>) -> EventPoller<Source, Store> {
        EventPoller::new(source, store, vec!["contract".into()], start).unwrap()
    }

    #[tokio::test]
    async fn backfills_in_order_then_polls_live_without_restart_duplicates() {
        let rpc = source(
            1,
            13,
            vec![
                Ok(page(vec![event(11, 2), event(11, 1)], "a")),
                Ok(page(vec![], "b")),
                Ok(page(vec![event(13, 1)], "c")),
            ],
        );
        let store = Store::default();
        store.0.lock().unwrap().last = Some(10);
        poller(rpc.clone(), store.clone(), None)
            .poll_once()
            .await
            .unwrap();
        assert_eq!(store.0.lock().unwrap().commits, vec![11, 12, 13]);
        assert_eq!(
            store.0.lock().unwrap().events,
            vec![event(11, 1), event(11, 2), event(13, 1)]
        );
        poller(rpc.clone(), store.clone(), Some(1))
            .poll_once()
            .await
            .unwrap();
        assert_eq!(rpc.requests.lock().unwrap().len(), 3);
        rpc.head.lock().unwrap().latest_ledger = 14;
        poller(rpc.clone(), store.clone(), None)
            .poll_once()
            .await
            .unwrap();
        assert_eq!(store.0.lock().unwrap().commits, vec![11, 12, 13, 14]);
    }

    #[tokio::test]
    async fn first_start_processes_current_ledger_or_explicit_start() {
        let store = Store::default();
        let rpc = source(1, 9, vec![]);
        poller(rpc.clone(), store.clone(), None)
            .poll_once()
            .await
            .unwrap();
        assert_eq!(store.0.lock().unwrap().commits, vec![9]);
        let store = Store::default();
        poller(rpc, store.clone(), Some(7))
            .poll_once()
            .await
            .unwrap();
        assert_eq!(store.0.lock().unwrap().commits, vec![7, 8, 9]);
    }

    #[tokio::test]
    async fn pagination_deduplicates_and_does_not_consume_future_ledgers() {
        let mut events: Vec<_> = (0..PAGE_SIZE).map(|i| event(8, i)).collect();
        events.reverse();
        let rpc = source(
            1,
            8,
            vec![
                Ok(page(events, "page1")),
                Ok(page(
                    vec![event(8, PAGE_SIZE - 1), event(8, PAGE_SIZE), event(9, 0)],
                    "page2",
                )),
            ],
        );
        let store = Store::default();
        poller(rpc.clone(), store.clone(), None)
            .poll_once()
            .await
            .unwrap();
        let state = store.0.lock().unwrap();
        assert_eq!(
            state.events,
            (0..=PAGE_SIZE).map(|i| event(8, i)).collect::<Vec<_>>()
        );
        assert_eq!(
            *rpc.requests.lock().unwrap(),
            vec![(8, None), (8, Some("page1".into()))]
        );
    }

    #[tokio::test]
    async fn rpc_failure_preserves_checkpoint_and_retries_whole_ledger() {
        let events: Vec<_> = (0..PAGE_SIZE).map(|i| event(8, i)).collect();
        let rpc = source(
            1,
            8,
            vec![
                Ok(page(events, "page1")),
                Err(anyhow::anyhow!("RPC offline")),
            ],
        );
        let store = Store::default();
        assert!(poller(rpc.clone(), store.clone(), None)
            .poll_once()
            .await
            .is_err());
        assert_eq!(store.0.lock().unwrap().last, Some(7));
        assert!(store.0.lock().unwrap().events.is_empty());
        rpc.pages
            .lock()
            .unwrap()
            .push_back(Ok(page(vec![event(8, 0)], "end")));
        poller(rpc, store.clone(), None).poll_once().await.unwrap();
        assert_eq!(store.0.lock().unwrap().events, vec![event(8, 0)]);
    }

    #[tokio::test]
    async fn storage_failure_does_not_advance_or_skip_later_ledgers() {
        let rpc = source(1, 9, vec![]);
        let store = Store::default();
        store.0.lock().unwrap().fail = Some(8);
        assert!(poller(rpc.clone(), store.clone(), Some(7))
            .poll_once()
            .await
            .is_err());
        assert_eq!(store.0.lock().unwrap().last, Some(7));
        store.0.lock().unwrap().fail = None;
        poller(rpc, store.clone(), None).poll_once().await.unwrap();
        assert_eq!(store.0.lock().unwrap().commits, vec![7, 8, 9]);
    }

    #[tokio::test]
    async fn expired_history_and_regressed_head_never_reset_checkpoint() {
        for (oldest, head, checkpoint) in [(20, 30, 10), (1, 9, 10)] {
            let rpc = source(oldest, head, vec![]);
            let store = Store::default();
            store.0.lock().unwrap().last = Some(checkpoint);
            assert!(poller(rpc.clone(), store.clone(), None)
                .poll_once()
                .await
                .is_err());
            assert_eq!(store.0.lock().unwrap().last, Some(checkpoint));
            assert!(rpc.requests.lock().unwrap().is_empty());
        }
    }

    #[tokio::test]
    async fn repeated_pagination_cursor_is_an_error() {
        let events: Vec<_> = (0..PAGE_SIZE).map(|i| event(8, i)).collect();
        let rpc = source(
            1,
            8,
            vec![Ok(page(events.clone(), "same")), Ok(page(events, "same"))],
        );
        let store = Store::default();
        assert!(poller(rpc, store.clone(), None).poll_once().await.is_err());
        assert_eq!(store.0.lock().unwrap().last, Some(7));
    }

    #[derive(Clone, Default)]
    struct Log(Arc<Mutex<Vec<u8>>>);
    impl std::io::Write for Log {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    #[tokio::test(flavor = "current_thread")]
    async fn emits_named_gap_alert_only_above_100_ledgers() {
        for (gap, alert) in [(100, false), (101, true)] {
            let log = Log::default();
            let writer = log.clone();
            let subscriber = tracing_subscriber::fmt()
                .without_time()
                .with_ansi(false)
                .with_max_level(tracing::Level::WARN)
                .with_writer(move || writer.clone())
                .finish();
            let _guard = tracing::subscriber::set_default(subscriber);
            let store = Store::default();
            store.0.lock().unwrap().last = Some(10);
            poller(source(1, 10 + gap, vec![]), store, None)
                .poll_once()
                .await
                .unwrap();
            let output = String::from_utf8(log.0.lock().unwrap().clone()).unwrap();
            assert_eq!(output.contains("soroban:gap_detected"), alert, "{output}");
        }
    }
}
