# ArenaX Frontend — Type System Architecture

---

## Table of Contents

1. [Overview](#overview)
2. [types/utils.ts — Utility Types](#typesutilsts--utility-types)
3. [lib/typeGuards.ts — Runtime Guards](#libtypeguardsts--runtime-guards)
4. [types/index.ts — Barrel](#typesindexts--barrel)
5. [Domain Type Files](#domain-type-files)
6. [Strict Typing Patterns](#strict-typing-patterns)
7. [Type Governance](#type-governance)
8. [Testing](#testing)
9. [Decision Log](#decision-log)

---

## Overview

The type system enhancement adds three layers on top of the existing domain types:

```
types/utils.ts       — Generic utility / helper types (no runtime cost)
lib/typeGuards.ts    — Runtime structural validation (type → boolean predicates)
types/index.ts       — Fixed barrel: added missing exports, removed duplicate, added utils re-exports
```

**tsconfig.json** runs with `"strict": true` — all strict sub-flags are enabled.

---

## types/utils.ts — Utility Types

### Branded / Nominal types

Prevents mixing up plain string IDs at compile time.

```ts
import type { UserId, TournamentId, MatchId } from "@/types";

function getUser(id: UserId) { … }
getUser("raw-string");                    // ✗ Type error
getUser("raw-string" as UserId);          // ✓ Explicit cast
```

Pre-defined branded ID types:

| Type | Brand |
|------|-------|
| `UserId` | `Brand<string, "UserId">` |
| `TournamentId` | `Brand<string, "TournamentId">` |
| `MatchId` | `Brand<string, "MatchId">` |
| `AchievementId` | `Brand<string, "AchievementId">` |
| `ProposalId` | `Brand<string, "ProposalId">` |
| `MessageId` | `Brand<string, "MessageId">` |
| `NotificationId` | `Brand<string, "NotificationId">` |

```ts
// Semantic string aliases (not checked at compile time, communicates intent)
type ISODateString   = Brand<string, "ISODateString">;
type UrlString       = Brand<string, "UrlString">;
type EmailString     = Brand<string, "EmailString">;
type NonEmptyString  = Brand<string, "NonEmptyString">;
```

### Result type

A discriminated union for operations that can succeed or fail without throwing.

```ts
import { ok, err, isOk, isErr, mapResult } from "@/types";

function divide(a: number, b: number): Result<number, string> {
  if (b === 0) return err("Division by zero");
  return ok(a / b);
}

const result = divide(10, 2);
if (isOk(result)) console.log(result.value);  // 5
else              console.error(result.error);
```

### Maybe type

```ts
import { isSome, isNone, getOrElse } from "@/types";

const name: Maybe<string> = user?.displayName;
const displayName = getOrElse(name, "Anonymous");
```

### AsyncData

A proper discriminated-union replacement for the old `AsyncState<T>`.

```ts
import { asyncLoading, asyncSuccess, asyncError, type AsyncData } from "@/types";

const state: AsyncData<User[]> = asyncLoading();

switch (state.status) {
  case "idle":    return <EmptyState />;
  case "loading": return <Spinner />;
  case "success": return <List items={state.data} />;   // data is narrowed
  case "error":   return <Error msg={state.error} />;   // error is narrowed
}
```

### Deep utilities

```ts
import type { DeepReadonly, DeepPartial, DeepRequired, DeepMutable } from "@/types";

type Config   = DeepReadonly<AppConfig>;   // All fields recursively readonly
type Partial  = DeepPartial<AppConfig>;    // All fields recursively optional
type Required = DeepRequired<AppConfig>;   // All fields recursively required
type Mutable  = DeepMutable<Config>;       // Strips all readonly
```

### Other utilities

```ts
// Strict record — all keys must be present
type Labels = StrictRecord<"open" | "closed", string>;

// RequireKeys / OptionalKeys
type WithRequired = RequireKeys<Props, "id" | "name">;
type WithOptional = OptionalKeys<Props, "className">;

// PickByValue / OmitByValue
type StringFields = PickByValue<User, string>;

// satisfies() — infer specific type while checking against interface
const config = satisfies<Config>()({ host: "localhost", port: 3000 });
// config is { host: string; port: number } not Config
```

---

## lib/typeGuards.ts — Runtime Guards

All guards follow the pattern:

```ts
function isX(value: unknown): value is X
```

### Usage patterns

**At API response boundaries:**

```ts
import { isUser, assertShape, safeJsonParse } from "@/lib/typeGuards";

// Throws if shape is wrong
const user = assertShape(apiResponse, isUser, "API returned unexpected user shape");

// Parse + validate in one step
const stored = safeJsonParse(localStorage.getItem("user") ?? "", isUser);
```

**Narrowing in conditionals:**

```ts
import { isMatch, isMatchWithPlayers } from "@/lib/typeGuards";

const data: unknown = await api.getMatch(id);
if (isMatchWithPlayers(data)) {
  // data is MatchWithPlayers — username fields are available
  console.log(data.player1Username);
}
```

**Validating arrays:**

```ts
import { isArray, isLeaderboardEntry } from "@/lib/typeGuards";

const entries: unknown = await api.getLeaderboard();
if (isArray(entries, isLeaderboardEntry)) {
  // entries is LeaderboardEntry[]
}
```

**Asserting non-null at trust boundaries:**

```ts
import { assertDefined } from "@/lib/typeGuards";

const token = localStorage.getItem("auth_token");
assertDefined(token, "Auth token must be present");
// token is string from here
```

### Available guards

| Function | Guards |
|----------|--------|
| `isString / isNumber / isBoolean / isObject / isArray / isDefined` | Primitives |
| `isApiResponse / isApiError / isPaginatedResponse` | API envelopes |
| `isUser / isAuthUser / isLoginRequest / isRegisterRequest` | Auth / User |
| `isMatch / isMatchWithPlayers / isMatchResult / isMatchStatus` | Match |
| `isTournament / isTournamentStatus / isTournamentVisibility / isTournamentType` | Tournament |
| `isNotificationType / isPersistentNotification / isToastNotification` | Notifications |
| `isWalletSession / isWalletType / isTxStatus / isTxHistoryItem` | Wallet |
| `isLeaderboardCategory / isLeaderboardEntry` | Leaderboard |
| `isPublicProfile / isPlayerStats` | Profile |
| `isSocialUser / isFriend / isCommunityPost` | Social |
| `isAchievement` | Achievement |
| `isProposalStatus / isProposal` | Governance |
| `isBracketMatch / isBracketData` | Bracket |
| `isCollaborationUser / isPresenceUser / isCollaborationEvent` | Collaboration |
| `assertDefined / assertShape / safeJsonParse` | Assertion / parse helpers |

---

## types/index.ts — Barrel

### Changes from the original

| Change | Detail |
|--------|--------|
| Added `analytics.ts` export | Was missing from the barrel |
| Added `governance.ts` export | Was missing from the barrel |
| Added `settings.ts` export | Was missing from the barrel |
| Removed duplicate `collaboration` export | Was listed twice |
| Added `utils.ts` selective re-exports | Key utility types and functions now importable from `"@/types"` |
| Preserved all original domain exports | No breaking changes |

### Import guidance

```ts
// Domain types — from barrel (convenience)
import type { User, Match, Tournament } from "@/types";

// Utility types — from barrel or direct
import type { Result, Maybe, AsyncData, DeepReadonly } from "@/types";
import { ok, err, asyncSuccess } from "@/types";

// Type guards — always direct (functions, not types)
import { isUser, isMatch, assertDefined } from "@/lib/typeGuards";

// Settings, governance, analytics — now also from barrel
import type { UserSettings, ThemeSettings } from "@/types";
import type { Proposal, ProposalStatus } from "@/types";
import type { AnalyticsPayload } from "@/types";
```

---

## Domain Type Files

| File | Key types | Notes |
|------|-----------|-------|
| `user.ts` | `User`, `AuthUser`, `LoginRequest`, `RegisterRequest`, `AuthResponse` | |
| `match.ts` | `Match`, `MatchWithPlayers`, `MatchDetail`, `MatchStatus`, `MatchFilters` | |
| `tournament.ts` | `Tournament`, `TournamentStatus`, `TournamentType`, `TournamentFilters` | Contains `isTournamentPageStatus()` guard |
| `bracket.ts` | `BracketMatch`, `BracketData`, `BracketSection` | Contains `calculatePrizeDistribution()` |
| `governance.ts` | `Proposal`, `ProposalStatus`, `CreateProposalDto` | Contains `isVotable()`, `statusToTab()` |
| `notification.ts` | `PersistentNotification`, `ToastNotification`, `NotificationType` | |
| `leaderboard.ts` | `LeaderboardEntry`, `LeaderboardResponse`, `RankHistory` | |
| `achievement.ts` | `Achievement`, `PlayerAchievement`, `AchievementProgress` | |
| `collaboration.ts` | `CollaborationEvent` (discriminated union), `CollaborationUser`, `PresenceUser` | |
| `analytics.ts` | `AnalyticsPayload` (discriminated union), `AnalyticsAdapter`, `ABExperiment` | |
| `settings.ts` | `UserSettings`, `ThemeSettings`, `AccessibilityOptions`, `GamePreferences` | |
| `social.ts` | `Friend`, `Message`, `Party`, `CommunityPost` | |
| `profile.ts` | `PublicProfile`, `PlayerStats`, `FriendEntry`, `ActivityEvent` | Note: some types overlap with match.ts |
| `admin.ts` | `KycReview`, `Dispute`, `ResolveDisputePayload` | |
| `player.ts` | `Player`, `PartyPlayer` | Minimal — base identity |
| `table.ts` | Generic `Column<T>`, `DataTableProps<T>` | |
| `transaction.ts` | Re-exports from `lib/wallet/types` | Proxy file |
| `utils.ts` | All utility / helper types | **New** |

### Known duplications (tracked, not fixed to avoid breaking changes)

| Duplicated type | Files |
|----------------|-------|
| `Achievement` | `types/achievement.ts` (different shape) vs `types/profile.ts` |
| `PlayerStats` | `types/match.ts` vs `types/profile.ts` |
| `MatchWithPlayers` | `types/match.ts` vs `types/profile.ts` |
| `UserProfileUpdate` | `types/user.ts` vs `types/profile.ts` |
| `EloPoint` | `types/user.ts` vs `types/profile.ts` |

Resolving these requires coordinating with consumers — tracked for a future cleanup PR.

---

## Strict Typing Patterns

### Replace `any` with specific types

```ts
// Before
async getTournaments(params?: Record<string, any>) { … }

// After
async getTournaments(params?: Record<string, string | number | boolean>) { … }
```

### Use `unknown` at trust boundaries

```ts
// Before
const data = await fetch(url).then(r => r.json());

// After
const raw: unknown = await fetch(url).then(r => r.json());
const data = assertShape(raw, isTournament, "Invalid tournament response");
```

### Discriminated union exhaustiveness

```ts
function renderState(state: AsyncData<User>) {
  switch (state.status) {
    case "idle":    return null;
    case "loading": return <Spinner />;
    case "success": return <Profile user={state.data} />;
    case "error":   return <Error msg={state.error} />;
    // TypeScript errors if a case is missing
  }
}
```

---

## Type Governance

### Rules

1. **No `any` in new type definitions.** Use `unknown` at trust boundaries and narrow with type guards.
2. **All API response types must go through a type guard** before being used in components.
3. **New domain types must be added to `types/index.ts`** and exported from the barrel.
4. **ID fields should use branded string types** (`UserId`, `TournamentId`, etc.) in new code.
5. **Async data shape must use `AsyncData<T>`** not the old `AsyncState<T>`.
6. **Duplicate types must not be created.** Reuse from the canonical file or extend.

### Adding a new domain type

1. Create/extend the relevant file in `src/types/`
2. Add to `src/types/index.ts` (or confirm it is re-exported)
3. Add a type guard in `src/lib/typeGuards.ts`
4. Add tests in `src/__tests__/types.test.ts`

---

## Testing

### Test file

`src/__tests__/types.test.ts` — 80+ cases:

| Area | Cases |
|------|-------|
| `Result` (ok/err/isOk/isErr/mapResult) | 10 |
| `Maybe` (isSome/isNone/getOrElse) | 8 |
| `AsyncData` helpers | 5 |
| `Brand` / `satisfies` | 2 |
| Primitive guards | 14 |
| API envelope guards | 6 |
| User / Auth guards | 8 |
| Match guards | 8 |
| Tournament guards | 5 |
| Notification guards | 5 |
| Wallet guards | 7 |
| Leaderboard guards | 4 |
| Social guards | 4 |
| Governance guards | 4 |
| Collaboration guards | 3 |
| `assertDefined` / `assertShape` / `safeJsonParse` | 8 |
| Barrel smoke tests | 2 |

```bash
npm test -- --testPathPattern="types"
```

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| `types/utils.ts` separate from domain types | Utility types are reusable across domains; keeping them separate avoids circular imports |
| `lib/typeGuards.ts` not in `types/` | Guards are runtime functions (not pure types); placing in `lib/` aligns with the existing convention for runtime logic |
| Structural (duck-type) guards, not class checks | Guards validate plain JSON from APIs; class instance checks would fail for deserialized data |
| `assertShape` throws rather than returns null | At trust boundaries an invalid shape is a programming error, not an expected case |
| `safeJsonParse` returns null on failure | localStorage data may be stale/corrupted; null is the safe default |
| Did not consolidate duplicate types in this PR | Fixing duplications (`Achievement`, `PlayerStats`, etc.) is a breaking change requiring coordinated consumer updates; tracked separately |
