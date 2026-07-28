# Redis Cluster

Closes #655.

`CacheService` (`src/services/cache.service.ts`) can now run against a
**Redis Cluster** instead of a single Redis instance, giving the cache
horizontal scalability (data sharded across masters) and automatic
failover (a replica is promoted when its master goes down) — while
keeping the existing single-instance and in-memory-fallback behavior
unchanged for anyone who doesn't opt in.

## How backend selection works

`CacheService` picks a backend in this order, unchanged in spirit from
before:

1. **`REDIS_CLUSTER_NODES`** set → `RedisClusterBackend` (ioredis `Cluster`)
2. else **`REDIS_URL`** set → `RedisBackend` (single ioredis instance, as before)
3. else → in-memory `Map`-based backend

Whichever Redis backend is selected, a connection error still falls back to
the in-memory backend automatically (`cacheService.get/set` never throw on
a Redis outage — see the existing `isAvailable()`/backend-selection logic).

## Configuration

```bash
# .env
REDIS_CLUSTER_NODES="localhost:7000,localhost:7001,localhost:7002,localhost:7003,localhost:7004,localhost:7005"
```

When `REDIS_CLUSTER_NODES` is set, `REDIS_URL` is ignored for the cache
(other services that use Redis directly, e.g. rate limiting, are
unaffected by this change and keep using `REDIS_URL`).

## Sharding

ioredis's `Cluster` client shards keys across masters using Redis's CRC16
hash-slot algorithm and transparently follows `MOVED`/`ASK` redirects — no
sharding logic lives in application code.

## Automatic failover

`clusterRetryStrategy` retries a command against the refreshed cluster
topology (up to 3 times, backing off up to 2s) so a mid-flight request
survives a master failing over to its replica. The underlying Redis
Cluster itself performs the failover (a replica is promoted once it
detects its master is unreachable); the app-level retry just rides out the
brief window while that happens.

## Monitoring

- `redis_cluster_nodes_total` (gauge) — nodes configured (from
  `REDIS_CLUSTER_NODES`).
- `redis_cluster_nodes_ready` (gauge) — nodes currently reporting `ready`,
  refreshed every 15s. `nodes_ready < nodes_total` for more than a
  monitoring cycle means a node is down and should be investigated.

Both are exposed at the existing `/metrics` Prometheus endpoint — see
[`server/METRICS_DASHBOARD.md`](../METRICS_DASHBOARD.md) for how to wire
alerts on custom gauges.

The existing `/health` dependency probe (`buildRedisProbe` in
`dependency-health.service.ts`) already calls `cacheService.isRedisConnected`
under the hood, so cluster mode is covered by the existing health endpoint
with no changes needed there.

## Local development

```bash
docker compose -f server/infra/redis-cluster/docker-compose.yml up -d
```

This starts a 6-node cluster (3 masters + 3 replicas) on `localhost:7000-7005`
using `grokzen/redis-cluster`, pre-bootstrapped — no manual
`redis-cli --cluster create` step required. Set `REDIS_CLUSTER_NODES` as
shown above and start the server normally.

To exercise failover locally:

```bash
docker compose -f server/infra/redis-cluster/docker-compose.yml exec redis-cluster \
  redis-cli -p 7000 shutdown nosave
```

Watch `redis_cluster_nodes_ready` drop and recover as the cluster promotes
a replica.

## Production

The bundled compose file is for local development only. In production, run
a real multi-host cluster — e.g. the Bitnami `redis-cluster` Helm chart on
Kubernetes, or a managed cluster-mode service (AWS ElastiCache/MemoryDB,
Azure Cache for Redis in cluster mode) — and point `REDIS_CLUSTER_NODES` at
the real node endpoints. TLS and AUTH should be layered on via
`redisOptions` in `RedisClusterBackend` when the target cluster requires
them (not needed for the local dev cluster, which has neither enabled).
