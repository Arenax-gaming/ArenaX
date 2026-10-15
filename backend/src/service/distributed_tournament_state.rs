//! Distributed tournament state (Issue #1253).
//!
//! Several backend instances can move a tournament forward. A Redis lock
//! (`SET key token NX PX`) makes sure only one of them writes at a time, and
//! the lock's TTL lets another instance take over if the holder dies. The
//! write itself is a compare-and-swap on a monotonic version, so a stale
//! update is rejected. Replicas apply a snapshot only when its version is
//! newer, which is what makes the copies converge.

use redis::aio::ConnectionManager;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TournamentSnapshot {
    pub tournament_id: Uuid,
    pub status: String,
    pub version: u64,
    pub writer: String,
    pub fencing_token: u64,
}

#[derive(Debug, Clone)]
pub struct StateLock {
    pub tournament_id: Uuid,
    pub owner: String,
    pub fencing_token: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StateError {
    Held { owner: String },
    StaleVersion { current: u64, attempted: u64 },
    StaleFence { current: u64, attempted: u64 },
    NotHeld,
    Redis(String),
}

impl std::fmt::Display for StateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StateError::Held { owner } => write!(f, "tournament lock is held by {owner}"),
            StateError::StaleVersion { current, attempted } => {
                write!(f, "stale version {attempted}, current is {current}")
            }
            StateError::StaleFence { current, attempted } => {
                write!(f, "stale fencing token {attempted}, current is {current}")
            }
            StateError::NotHeld => write!(f, "tournament lock is not held"),
            StateError::Redis(msg) => write!(f, "redis error: {msg}"),
        }
    }
}

struct LockRecord {
    owner: String,
    token: u64,
    expires_at: Instant,
}

struct MemoryStore {
    locks: HashMap<Uuid, LockRecord>,
    states: HashMap<Uuid, TournamentSnapshot>,
    fence: u64,
}

impl MemoryStore {
    fn acquire_at(
        &mut self,
        owner: &str,
        tournament_id: Uuid,
        ttl: Duration,
        now: Instant,
    ) -> Result<StateLock, StateError> {
        if let Some(existing) = self.locks.get(&tournament_id) {
            if existing.expires_at > now {
                return Err(StateError::Held {
                    owner: existing.owner.clone(),
                });
            }
        }
        self.fence += 1;
        let token = self.fence;
        self.locks.insert(
            tournament_id,
            LockRecord {
                owner: owner.to_string(),
                token,
                expires_at: now + ttl,
            },
        );
        Ok(StateLock {
            tournament_id,
            owner: owner.to_string(),
            fencing_token: token,
        })
    }

    fn release_at(&mut self, lock: &StateLock, now: Instant) -> bool {
        match self.locks.get(&lock.tournament_id) {
            Some(current) if current.token == lock.fencing_token && current.expires_at > now => {
                self.locks.remove(&lock.tournament_id);
                true
            }
            _ => false,
        }
    }

    fn commit_at(
        &mut self,
        lock: &StateLock,
        expected_version: u64,
        status: &str,
        now: Instant,
    ) -> Result<TournamentSnapshot, StateError> {
        let Some(current_lock) = self.locks.get(&lock.tournament_id) else {
            return Err(StateError::NotHeld);
        };
        if current_lock.expires_at <= now {
            return Err(StateError::NotHeld);
        }
        if current_lock.token != lock.fencing_token {
            return Err(StateError::StaleFence {
                current: current_lock.token,
                attempted: lock.fencing_token,
            });
        }
        let current_version = self
            .states
            .get(&lock.tournament_id)
            .map(|s| s.version)
            .unwrap_or(0);
        if current_version != expected_version {
            return Err(StateError::StaleVersion {
                current: current_version,
                attempted: expected_version,
            });
        }
        let snapshot = TournamentSnapshot {
            tournament_id: lock.tournament_id,
            status: status.to_string(),
            version: current_version + 1,
            writer: lock.owner.clone(),
            fencing_token: lock.fencing_token,
        };
        self.states.insert(lock.tournament_id, snapshot.clone());
        Ok(snapshot)
    }
}

/// Local copy of tournament state. A snapshot is applied only when it is newer.
#[derive(Default)]
pub struct Replica {
    states: HashMap<Uuid, TournamentSnapshot>,
}

impl Replica {
    pub fn observe(&mut self, snapshot: &TournamentSnapshot) -> bool {
        match self.states.get(&snapshot.tournament_id) {
            Some(current) if current.version >= snapshot.version => false,
            _ => {
                self.states
                    .insert(snapshot.tournament_id, snapshot.clone());
                true
            }
        }
    }

    pub fn status(&self, tournament_id: Uuid) -> Option<&str> {
        self.states.get(&tournament_id).map(|s| s.status.as_str())
    }

    pub fn consistent_with(&self, other: &Replica) -> bool {
        self.states.len() == other.states.len()
            && self.states.iter().all(|(id, snapshot)| {
                other
                    .states
                    .get(id)
                    .is_some_and(|o| o.version == snapshot.version && o.status == snapshot.status)
            })
    }
}

const LOCK_TTL: Duration = Duration::from_secs(15);

const ACQUIRE_SCRIPT: &str = r#"
local token = redis.call('INCR', KEYS[1])
if redis.call('SET', KEYS[2], token, 'NX', 'PX', ARGV[1]) then
  redis.call('SET', KEYS[3], ARGV[2], 'PX', ARGV[1])
  return token
end
return 0
"#;

const COMMIT_SCRIPT: &str = r#"
local holder = redis.call('GET', KEYS[1])
if holder ~= ARGV[1] then
  return {'stale_fence', holder or ''}
end
local version = tonumber(redis.call('GET', KEYS[2]) or '0')
local expected = tonumber(ARGV[2])
if version ~= expected then
  return {'stale_version', tostring(version)}
end
local next = version + 1
redis.call('SET', KEYS[2], next)
redis.call('SET', KEYS[3], ARGV[3])
redis.call('SET', KEYS[4], ARGV[4])
return {'ok', tostring(next)}
"#;

const RELEASE_SCRIPT: &str = r#"
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1], KEYS[2])
  return 1
end
return 0
"#;

#[derive(Clone)]
enum Backend {
    Memory(Arc<Mutex<MemoryStore>>),
    Redis(ConnectionManager),
}

#[derive(Clone)]
pub struct TournamentStateBackend {
    inner: Backend,
}

impl TournamentStateBackend {
    pub fn memory() -> Self {
        Self {
            inner: Backend::Memory(Arc::new(Mutex::new(MemoryStore {
                locks: HashMap::new(),
                states: HashMap::new(),
                fence: 0,
            }))),
        }
    }

    pub fn redis(conn: ConnectionManager) -> Self {
        Self {
            inner: Backend::Redis(conn),
        }
    }

    pub async fn acquire(&self, owner: &str, tournament_id: Uuid) -> Result<StateLock, StateError> {
        self.acquire_for(owner, tournament_id, LOCK_TTL, Instant::now())
            .await
    }

    pub async fn acquire_for(
        &self,
        owner: &str,
        tournament_id: Uuid,
        ttl: Duration,
        now: Instant,
    ) -> Result<StateLock, StateError> {
        match &self.inner {
            Backend::Memory(store) => store
                .lock()
                .expect("tournament state")
                .acquire_at(owner, tournament_id, ttl, now),
            Backend::Redis(conn) => {
                let mut conn = conn.clone();
                let token: i64 = redis::cmd("EVAL")
                    .arg(ACQUIRE_SCRIPT)
                    .arg(3)
                    .arg(fence_key(tournament_id))
                    .arg(lock_key(tournament_id))
                    .arg(owner_key(tournament_id))
                    .arg(ttl.as_millis() as u64)
                    .arg(owner)
                    .query_async(&mut conn)
                    .await
                    .map_err(|e| StateError::Redis(e.to_string()))?;
                if token == 0 {
                    let holder: Option<String> = redis::cmd("GET")
                        .arg(owner_key(tournament_id))
                        .query_async(&mut conn)
                        .await
                        .unwrap_or(None);
                    return Err(StateError::Held {
                        owner: holder.unwrap_or_else(|| "unknown".into()),
                    });
                }
                Ok(StateLock {
                    tournament_id,
                    owner: owner.to_string(),
                    fencing_token: token as u64,
                })
            }
        }
    }

    pub async fn read(&self, tournament_id: Uuid) -> Result<Option<TournamentSnapshot>, StateError> {
        match &self.inner {
            Backend::Memory(store) => Ok(store
                .lock()
                .expect("tournament state")
                .states
                .get(&tournament_id)
                .cloned()),
            Backend::Redis(conn) => {
                let mut conn = conn.clone();
                let status: Option<String> = redis::cmd("GET")
                    .arg(status_key(tournament_id))
                    .query_async(&mut conn)
                    .await
                    .map_err(|e| StateError::Redis(e.to_string()))?;
                let Some(status) = status else {
                    return Ok(None);
                };
                let version: Option<i64> = redis::cmd("GET")
                    .arg(version_key(tournament_id))
                    .query_async(&mut conn)
                    .await
                    .map_err(|e| StateError::Redis(e.to_string()))?;
                let version = version.unwrap_or(0);
                let writer: String = redis::cmd("GET")
                    .arg(writer_key(tournament_id))
                    .query_async(&mut conn)
                    .await
                    .unwrap_or_else(|_| "unknown".into());
                Ok(Some(TournamentSnapshot {
                    tournament_id,
                    status,
                    version: version as u64,
                    writer,
                    fencing_token: 0,
                }))
            }
        }
    }

    pub async fn commit(
        &self,
        lock: &StateLock,
        expected_version: u64,
        status: &str,
    ) -> Result<TournamentSnapshot, StateError> {
        self.commit_at(lock, expected_version, status, Instant::now())
            .await
    }

    pub async fn commit_at(
        &self,
        lock: &StateLock,
        expected_version: u64,
        status: &str,
        now: Instant,
    ) -> Result<TournamentSnapshot, StateError> {
        match &self.inner {
            Backend::Memory(store) => store.lock().expect("tournament state").commit_at(
                lock,
                expected_version,
                status,
                now,
            ),
            Backend::Redis(conn) => {
                let mut conn = conn.clone();
                let reply: Vec<String> = redis::cmd("EVAL")
                    .arg(COMMIT_SCRIPT)
                    .arg(4)
                    .arg(lock_key(lock.tournament_id))
                    .arg(version_key(lock.tournament_id))
                    .arg(status_key(lock.tournament_id))
                    .arg(writer_key(lock.tournament_id))
                    .arg(lock.fencing_token.to_string())
                    .arg(expected_version.to_string())
                    .arg(status)
                    .arg(&lock.owner)
                    .query_async(&mut conn)
                    .await
                    .map_err(|e| StateError::Redis(e.to_string()))?;
                match reply.first().map(String::as_str) {
                    Some("ok") => {
                        let version = reply.get(1).and_then(|v| v.parse().ok()).unwrap_or(0);
                        Ok(TournamentSnapshot {
                            tournament_id: lock.tournament_id,
                            status: status.to_string(),
                            version,
                            writer: lock.owner.clone(),
                            fencing_token: lock.fencing_token,
                        })
                    }
                    Some("stale_fence") => Err(StateError::StaleFence {
                        current: reply.get(1).and_then(|v| v.parse().ok()).unwrap_or(0),
                        attempted: lock.fencing_token,
                    }),
                    Some("stale_version") => Err(StateError::StaleVersion {
                        current: reply.get(1).and_then(|v| v.parse().ok()).unwrap_or(0),
                        attempted: expected_version,
                    }),
                    _ => Err(StateError::Redis(format!("unexpected commit reply: {reply:?}"))),
                }
            }
        }
    }

    pub async fn release(&self, lock: &StateLock) -> Result<bool, StateError> {
        self.release_at(lock, Instant::now()).await
    }

    pub async fn release_at(&self, lock: &StateLock, now: Instant) -> Result<bool, StateError> {
        match &self.inner {
            Backend::Memory(store) => Ok(store.lock().expect("tournament state").release_at(lock, now)),
            Backend::Redis(conn) => {
                let mut conn = conn.clone();
                let n: i64 = redis::cmd("EVAL")
                    .arg(RELEASE_SCRIPT)
                    .arg(2)
                    .arg(lock_key(lock.tournament_id))
                    .arg(owner_key(lock.tournament_id))
                    .arg(lock.fencing_token.to_string())
                    .query_async(&mut conn)
                    .await
                    .map_err(|e| StateError::Redis(e.to_string()))?;
                Ok(n == 1)
            }
        }
    }
}

fn lock_key(id: Uuid) -> String {
    format!("tournament:{id}:lock")
}
fn fence_key(id: Uuid) -> String {
    format!("tournament:{id}:fence")
}
fn owner_key(id: Uuid) -> String {
    format!("tournament:{id}:lock-owner")
}
fn version_key(id: Uuid) -> String {
    format!("tournament:{id}:version")
}
fn status_key(id: Uuid) -> String {
    format!("tournament:{id}:status")
}
fn writer_key(id: Uuid) -> String {
    format!("tournament:{id}:writer")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(ms: u64) -> Instant {
        Instant::now() + Duration::from_millis(ms)
    }

    #[tokio::test]
    async fn a_second_writer_is_rejected_until_the_lock_expires() {
        let backend = TournamentStateBackend::memory();
        let id = Uuid::new_v4();
        let now = Instant::now();
        let first = backend
            .acquire_for("instance-a", id, Duration::from_millis(50), now)
            .await
            .unwrap();
        let blocked = backend
            .acquire_for("instance-b", id, Duration::from_millis(50), now)
            .await;
        assert!(matches!(blocked, Err(StateError::Held { owner }) if owner == "instance-a"));

        let second = backend
            .acquire_for(
                "instance-b",
                id,
                Duration::from_millis(50),
                now + Duration::from_millis(51),
            )
            .await
            .unwrap();
        assert_ne!(first.fencing_token, second.fencing_token);

        let stale = backend
            .commit_at(&first, 0, "in_progress", now + Duration::from_millis(51))
            .await;
        assert!(matches!(stale, Err(StateError::StaleFence { .. }) | Err(StateError::NotHeld)));

        let written = backend
            .commit_at(&second, 0, "in_progress", now + Duration::from_millis(51))
            .await
            .unwrap();
        assert_eq!(written.version, 1);
        assert_eq!(written.status, "in_progress");
    }

    #[tokio::test]
    async fn a_stale_version_does_not_overwrite_a_newer_status() {
        let backend = TournamentStateBackend::memory();
        let id = Uuid::new_v4();
        let now = Instant::now();
        let lock = backend
            .acquire_for("instance-a", id, Duration::from_secs(5), now)
            .await
            .unwrap();
        backend
            .commit_at(&lock, 0, "registration_open", now)
            .await
            .unwrap();
        let conflict = backend.commit_at(&lock, 0, "in_progress", now).await;
        assert!(matches!(
            conflict,
            Err(StateError::StaleVersion { current: 1, attempted: 0 })
        ));
        let current = backend.read(id).await.unwrap().unwrap();
        assert_eq!(current.status, "registration_open");
        assert_eq!(current.version, 1);
    }

    #[test]
    fn replicas_converge_when_updates_arrive_out_of_order() {
        let id = Uuid::new_v4();
        let v1 = TournamentSnapshot {
            tournament_id: id,
            status: "registration_open".into(),
            version: 1,
            writer: "a".into(),
            fencing_token: 1,
        };
        let v2 = TournamentSnapshot {
            tournament_id: id,
            status: "in_progress".into(),
            version: 2,
            writer: "b".into(),
            fencing_token: 2,
        };

        let mut first = Replica::default();
        let mut second = Replica::default();
        assert!(first.observe(&v2));
        assert!(!first.observe(&v1), "an older snapshot must not roll the replica back");
        assert!(second.observe(&v1));
        assert!(second.observe(&v2));
        assert!(first.consistent_with(&second));
        assert_eq!(first.status(id), Some("in_progress"));
    }

    #[test]
    fn redis_scripts_cover_the_lock_and_the_version_check() {
        assert!(ACQUIRE_SCRIPT.contains("NX"));
        assert!(ACQUIRE_SCRIPT.contains("PX"));
        assert!(COMMIT_SCRIPT.contains("stale_fence"));
        assert!(COMMIT_SCRIPT.contains("stale_version"));
        assert!(RELEASE_SCRIPT.contains("DEL"));
    }
}
