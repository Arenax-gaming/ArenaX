# Caching, suspensions, email, and real-time leaderboards

Covers issues #910, #906, #905 and #900.

## Smart caching (#910)

`backend/src/middleware/cache.rs`.

Redis-backed response cache with per-endpoint TTLs, tag-based invalidation, and
stale-while-revalidate.

### Policies

| Endpoint | Fresh | Stale window | Why |
|---|---|---|---|
| Leaderboard page | 15s | 45s | Heavy query, high traffic; WebSocket deltas carry the urgent updates anyway |
| Player stats | 30s | 60s | Read on every profile view |
| Tournament list | 60s | 120s | Changes only when an organiser edits |
| Achievement catalog | 600s | 600s | Effectively static |

Wallet balances are deliberately **not** cached — a stale balance is a support
ticket.

### Stale-while-revalidate

An entry has two ages. Inside `fresh_for` it is served outright. Between
`fresh_for` and `fresh_for + stale_for` it is still served, and a single
background refresh is kicked off. Past both, the Redis key is gone.

This exists because a plain TTL cache fails exactly when it matters: the moment
a popular key expires, every concurrent request misses and they all hit the
database together. The background refresh takes a short Redis lock (`SET NX
EX`), so one worker refreshes and everyone else serves stale.

A failed background refresh keeps the stale entry rather than evicting it —
losing a refresh beats dropping a usable value because the origin hiccuped.

### Invalidation

Entries are tagged. `leaderboard:<category>` covers every cached page of one
board, so a single rank change drops them all at once rather than leaving page
3 stale while page 1 refreshes. `player:<uuid>` covers everything derived from
one player.

Key and tag construction lives in `cache::keys` so a read path and a write path
cannot drift into disagreeing about what a key looks like — that bug presents
as a cache that never invalidates, which is close to invisible in testing.

### Metrics

`GET /api/cache/stats` (admin only) returns hits, stale hits, misses, errors,
and hit rate. Stale hits count as hits: they still spared the database a query.
Counters are per-process.

### Failure behaviour

Every Redis error degrades to "no cache", never to a failed request. Errors are
counted so an outage is visible rather than silent.

## Player suspensions (#906)

`backend/src/service/suspension_service.rs`, `backend/src/http/suspension_handler.rs`,
migration `20260924000001`.

### Why rows rather than a flag on `users`

A boolean answers "is this player suspended right now" and nothing else.
Enforcement needs the rest: what they did, who decided, when it lifts, whether
they appealed, what happened last time. One row per action means a repeat
offender's history is queryable, an expired suspension stays on the record, and
reversing a bad call is an update rather than a guess.

### Kinds and scopes

- **Temporary** — has `expires_at`, lifts by itself.
- **Permanent** — no expiry; only a lift or an accepted appeal ends it.

Scopes are graded because the punishments are not interchangeable: someone
abusing chat should lose chat, not their tournament entry fee.

- `all_access` — cannot sign in
- `competition` — can watch, cannot enter matches or tournaments
- `social` — can play, cannot post
- `financial` — can play, cannot withdraw or stake

An `all_access` suspension restricts every scope.

### Expiry

Computed from `expires_at` at read time, not swept by a job. A cron that falls
behind would hold players past their sentence, which is the failure everyone
notices. The schema enforces the pairing: a permanent ban cannot carry an
expiry, a temporary one must.

### Appeals

A player submits one appeal per suspension. The update is scoped by `user_id`
in the predicate, so one player cannot appeal another's suspension even with a
valid id. Accepting an appeal ends the suspension in the same statement —
`is_active` treats an accepted appeal as lifted, so there is no window where a
cleared player stays locked out waiting for a separate call.

### Endpoints

| Method | Path | Who |
|---|---|---|
| POST | `/api/suspensions` | moderator |
| POST | `/api/suspensions/{id}/lift` | moderator |
| GET | `/api/suspensions/me` | player |
| GET | `/api/suspensions/check?scope=` | player |
| GET | `/api/suspensions/user/{id}` | moderator |
| POST | `/api/suspensions/{id}/appeal` | player |
| GET | `/api/suspensions/appeals` | moderator |
| POST | `/api/suspensions/{id}/appeal/review` | moderator |

## Email notifications (#905)

`backend/src/service/email_service.rs`, `backend/src/http/email_handler.rs`.

### Categories

`tournament_registration`, `match_result`, `achievement`, `weekly_digest`, and
`account_security`.

`account_security` ignores preferences entirely. A password change or a
suspension notice is not marketing, and a player who muted everything still
needs to be told their account was acted on. `set_preference` refuses to switch
it off rather than accepting the call and ignoring it.

### Preferences are opt-out

Absence of a row means subscribed, so adding a category does not need a
backfill across every user.

### Unsubscribe

Every optional email carries a link. The link carries a random 48-character
token, not a user id — mail gets forwarded constantly, and a guessable link
would be a way to unsubscribe arbitrary accounts.

Clicking a spent token still succeeds: a player clicking twice should see "you
are unsubscribed", not an error. `used_at` records the first click.

### De-duplication

`dedupe_key` identifies the *event*, not the attempt —
`match_result:<match_id>:<user_id>`. A retried job produces the same key and the
second send is skipped. A unique partial index closes the race where two
workers pass the check simultaneously.

### Transports

`EmailTransport` is a trait. `HttpTransport` posts JSON to any provider that
takes a bearer token (Postmark, Resend, SendGrid). `LoggingTransport` is the
fallback when `EMAIL_API_ENDPOINT` / `EMAIL_API_KEY` / `EMAIL_FROM_ADDRESS` are
unset — it logs the body instead of sending, so development does not need a
provider and a missing config does not take the service down at boot.

A send failure never fails the action that triggered it: a match result stands
whether or not the email landed.

### Configuration

```
EMAIL_API_ENDPOINT=https://api.postmarkapp.com/email
EMAIL_API_KEY=...
EMAIL_FROM_ADDRESS=noreply@arenax.gg
APP_BASE_URL=https://arenax.gg
```

## Real-time leaderboard (#900)

`backend/src/realtime/leaderboard_broadcaster.rs`.

Leaderboards only moved on refresh. Pushing the full board on every change is
not an option: a 10,000-entry board is roughly a megabyte of JSON, and one
match completion shifts the rank of every player below the winner.

### Deltas

The tracker keeps the last published rank per player and emits only what moved.

### Memory

Each tracked player costs a `Uuid` key plus a `RankSnapshot` of two `i32`s — 8
bytes of payload. A 10,000-player board is a few hundred KB including `HashMap`
overhead, not the megabytes a cached board of full `LeaderboardEntry` rows
(username, avatar URL, timestamps) would cost. Nothing in the snapshot holds a
`String`. A test asserts `size_of::<RankSnapshot>() == 8` so a future field
addition has to be a deliberate choice.

### Throttling

One update per second per player. A tournament finishing produces a burst of
churn in a few hundred milliseconds; without coalescing a client would receive
a dozen messages describing intermediate states it never needed to render.

Coalescing keeps the *newest* rank but the *original* previous rank, so a
client sees one coherent "moved from 5 to 2" rather than a chain of hops — which
is what makes a "moved up 3 places" animation correct.

A 1-second timer in `main.rs` flushes each category, so the tail of a burst is
delivered rather than waiting for an unrelated update to shake it loose.

### Client merge contract

Channel: `leaderboard:<category>`, subscribed to explicitly like match
channels — a client watching FIFA has no use for Call of Duty churn.

On `LeaderboardDelta`:

1. If `version` is not exactly one greater than the last version seen for this
   category, a delta was missed — **discard the local board and re-fetch**.
   Patching across a gap silently corrupts the board.
2. For each change, replace the entry for `user_id` with the new `ranking` and
   `elo_rating`, inserting it if `previous_ranking` is `null`.
3. Re-sort by `ranking` ascending.

### Failure behaviour

Broadcasting is infallible by design. A client that misses a push re-syncs from
the REST board, so a broadcast failure must never fail a rank update that has
already been committed.
