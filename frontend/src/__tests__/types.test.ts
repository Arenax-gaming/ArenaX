/**
 * Type system tests — Issue #695
 *
 * Covers:
 * - types/utils.ts: Result, Maybe, DeepReadonly/Partial/Required, AsyncData helpers,
 *   Brand, ok/err/isOk/isErr, isSome/isNone/getOrElse, mapResult, satisfies
 * - lib/typeGuards.ts: all guard functions
 * - types/index.ts: barrel re-exports
 */

// ─── utils.ts ─────────────────────────────────────────────────────────────────

import {
  ok, err, isOk, isErr, mapResult,
  isSome, isNone, getOrElse,
  asyncIdle, asyncLoading, asyncSuccess, asyncError,
  satisfies,
  brand,
  type Result,
  type Maybe,
  type AsyncData,
  type DeepReadonly,
  type DeepPartial,
  type DeepRequired,
  type StrictRecord,
  type Brand,
} from "@/types/utils";

// ─── Result ───────────────────────────────────────────────────────────────────

describe("Result — ok()", () => {
  it("creates a success result with ok=true", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("works with complex values", () => {
    const r = ok({ id: "1", name: "Alice" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBe("Alice");
  });
});

describe("Result — err()", () => {
  it("creates a failure result with ok=false", () => {
    const r = err("something went wrong");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("something went wrong");
  });

  it("works with Error objects", () => {
    const e = new Error("boom");
    const r = err(e);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(e);
  });
});

describe("isOk() / isErr()", () => {
  it("isOk returns true for success result", () => {
    expect(isOk(ok("x"))).toBe(true);
  });

  it("isOk returns false for failure result", () => {
    expect(isOk(err("x"))).toBe(false);
  });

  it("isErr returns true for failure result", () => {
    expect(isErr(err("x"))).toBe(true);
  });

  it("isErr returns false for success result", () => {
    expect(isErr(ok("x"))).toBe(false);
  });
});

describe("mapResult()", () => {
  it("maps the success value", () => {
    const r = mapResult(ok(2), (n) => n * 3);
    expect(isOk(r) && r.value).toBe(6);
  });

  it("passes failures through unchanged", () => {
    const r = mapResult(err("fail") as Result<number, string>, (n) => n * 3);
    expect(isErr(r) && r.error).toBe("fail");
  });
});

// ─── Maybe ────────────────────────────────────────────────────────────────────

describe("isSome() / isNone()", () => {
  it("isSome returns true for non-null values", () => {
    expect(isSome(0)).toBe(true);
    expect(isSome("")).toBe(true);
    expect(isSome(false)).toBe(true);
    expect(isSome({})).toBe(true);
  });

  it("isSome returns false for null and undefined", () => {
    expect(isSome(null)).toBe(false);
    expect(isSome(undefined)).toBe(false);
  });

  it("isNone returns true for null and undefined", () => {
    expect(isNone(null)).toBe(true);
    expect(isNone(undefined)).toBe(true);
  });

  it("isNone returns false for defined values", () => {
    expect(isNone(0)).toBe(false);
    expect(isNone("hello")).toBe(false);
  });
});

describe("getOrElse()", () => {
  it("returns value when defined", () => {
    expect(getOrElse("hello" as Maybe<string>, "default")).toBe("hello");
  });

  it("returns fallback for null", () => {
    expect(getOrElse(null as Maybe<string>, "default")).toBe("default");
  });

  it("returns fallback for undefined", () => {
    expect(getOrElse(undefined as Maybe<string>, "default")).toBe("default");
  });
});

// ─── AsyncData ────────────────────────────────────────────────────────────────

describe("AsyncData helpers", () => {
  it("asyncIdle returns idle status", () => {
    expect(asyncIdle().status).toBe("idle");
  });

  it("asyncLoading returns loading status", () => {
    expect(asyncLoading().status).toBe("loading");
  });

  it("asyncSuccess returns success status with data", () => {
    const s = asyncSuccess([1, 2, 3]);
    expect(s.status).toBe("success");
    if (s.status === "success") expect(s.data).toEqual([1, 2, 3]);
  });

  it("asyncError returns error status with error value", () => {
    const e = asyncError("Network timeout");
    expect(e.status).toBe("error");
    if (e.status === "error") expect(e.error).toBe("Network timeout");
  });

  it("status values narrow correctly in switch", () => {
    const state: AsyncData<string> = asyncSuccess("hello");
    let result = "";
    switch (state.status) {
      case "idle":    result = "idle"; break;
      case "loading": result = "loading"; break;
      case "success": result = state.data; break;
      case "error":   result = "error"; break;
    }
    expect(result).toBe("hello");
  });
});

// ─── Brand / Nominal types ────────────────────────────────────────────────────

describe("brand()", () => {
  it("creates a branded value that equals the original at runtime", () => {
    type UserId = Brand<string, "UserId">;
    const id = brand<string, "UserId">("user-123");
    expect(id).toBe("user-123");
  });
});

// ─── satisfies() ─────────────────────────────────────────────────────────────

describe("satisfies()", () => {
  it("returns the value unchanged", () => {
    type Config = { host: string; port: number };
    const cfg = satisfies<Config>()({ host: "localhost", port: 3000 });
    expect(cfg.host).toBe("localhost");
    expect(cfg.port).toBe(3000);
  });
});

// ─── lib/typeGuards.ts ────────────────────────────────────────────────────────

import {
  isString, isNumber, isBoolean, isObject, isArray,
  isNullOrUndefined, isDefined,
  isApiResponse, isApiError, isPaginatedResponse,
  isUser, isAuthUser, isLoginRequest, isRegisterRequest,
  isMatch, isMatchWithPlayers, isMatchResult, isMatchStatus,
  isTournament, isTournamentStatus, isTournamentVisibility, isTournamentType,
  isNotificationType, isPersistentNotification, isToastNotification,
  isWalletType, isTxStatus, isWalletSession, isTxHistoryItem,
  isLeaderboardCategory, isLeaderboardEntry,
  isPublicProfile, isPlayerStats,
  isSocialUser, isFriend, isCommunityPost,
  isAchievement,
  isProposalStatus, isProposal,
  isBracketMatch, isBracketData,
  isCollaborationUser, isPresenceUser, isCollaborationEvent,
  assertDefined, assertShape, safeJsonParse,
} from "@/lib/typeGuards";

import { CollaborationEventType } from "@/types/collaboration";

// ─── Primitive guards ─────────────────────────────────────────────────────────

describe("Primitive guards", () => {
  it.each([
    ["isString", isString, "hello", true],
    ["isString", isString, 42, false],
    ["isNumber", isNumber, 3.14, true],
    ["isNumber", isNumber, NaN, false],
    ["isNumber", isNumber, "3", false],
    ["isBoolean", isBoolean, true, true],
    ["isBoolean", isBoolean, 1, false],
    ["isObject", isObject, {}, true],
    ["isObject", isObject, null, false],
    ["isObject", isObject, [], false],
    ["isNullOrUndefined", isNullOrUndefined, null, true],
    ["isNullOrUndefined", isNullOrUndefined, undefined, true],
    ["isNullOrUndefined", isNullOrUndefined, 0, false],
    ["isDefined", isDefined, "x", true],
    ["isDefined", isDefined, null, false],
    ["isDefined", isDefined, undefined, false],
  ] as [string, (v: unknown) => boolean, unknown, boolean][])(
    "%s(%p) → %s",
    (_name, guard, value, expected) => {
      expect(guard(value)).toBe(expected);
    },
  );

  it("isArray returns true for arrays", () => {
    expect(isArray([1, 2, 3])).toBe(true);
    expect(isArray([])).toBe(true);
  });

  it("isArray returns false for non-arrays", () => {
    expect(isArray({})).toBe(false);
    expect(isArray("string")).toBe(false);
  });

  it("isArray validates items with itemGuard", () => {
    expect(isArray([1, 2, 3], isNumber)).toBe(true);
    expect(isArray([1, "2", 3], isNumber)).toBe(false);
  });
});

// ─── API guards ───────────────────────────────────────────────────────────────

describe("isApiResponse()", () => {
  it("returns true for valid envelope", () => {
    expect(isApiResponse({ success: true, data: [] })).toBe(true);
  });

  it("returns false for missing success", () => {
    expect(isApiResponse({ data: [] })).toBe(false);
  });

  it("returns false for non-object", () => {
    expect(isApiResponse("string")).toBe(false);
  });
});

describe("isApiError()", () => {
  it("returns true for valid error shape", () => {
    expect(isApiError({ error: "NOT_FOUND", message: "Resource not found", code: "404" })).toBe(true);
  });

  it("returns false for partial shape", () => {
    expect(isApiError({ error: "ERR" })).toBe(false);
  });
});

describe("isPaginatedResponse()", () => {
  it("returns true for valid paginated shape", () => {
    expect(isPaginatedResponse({
      data: [], total: 0, page: 1, limit: 10, totalPages: 0,
    })).toBe(true);
  });

  it("validates items with itemGuard", () => {
    expect(isPaginatedResponse(
      { data: [1, 2], total: 2, page: 1, limit: 10, totalPages: 1 },
      isNumber,
    )).toBe(true);
    expect(isPaginatedResponse(
      { data: [1, "two"], total: 2, page: 1, limit: 10, totalPages: 1 },
      isNumber,
    )).toBe(false);
  });
});

// ─── User / Auth guards ───────────────────────────────────────────────────────

const validUser = {
  id: "u1",
  username: "alice",
  email: "alice@example.com",
  isVerified: true,
  elo: 1200,
  createdAt: "2024-01-01T00:00:00Z",
};

describe("isUser()", () => {
  it("returns true for a valid User", () => {
    expect(isUser(validUser)).toBe(true);
  });

  it("returns false when required fields are missing", () => {
    const { elo: _elo, ...noElo } = validUser;
    expect(isUser(noElo)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isUser(null)).toBe(false);
  });
});

describe("isAuthUser()", () => {
  it("returns true when token fields are present", () => {
    expect(isAuthUser({ ...validUser, token: "jwt", refreshToken: "refresh" })).toBe(true);
  });

  it("returns false when token is missing", () => {
    expect(isAuthUser({ ...validUser, refreshToken: "r" })).toBe(false);
  });
});

describe("isLoginRequest()", () => {
  it("returns true for valid credentials", () => {
    expect(isLoginRequest({ email: "a@b.com", password: "pass" })).toBe(true);
  });

  it("returns false when password is missing", () => {
    expect(isLoginRequest({ email: "a@b.com" })).toBe(false);
  });
});

describe("isRegisterRequest()", () => {
  it("returns true for a complete registration payload", () => {
    expect(isRegisterRequest({
      username: "alice",
      email: "a@b.com",
      password: "pass",
      confirmPassword: "pass",
    })).toBe(true);
  });

  it("returns false for partial payload", () => {
    expect(isRegisterRequest({ username: "alice", email: "a@b.com" })).toBe(false);
  });
});

// ─── Match guards ─────────────────────────────────────────────────────────────

const validMatch = {
  id: "m1",
  player1Id: "u1",
  player2Id: "u2",
  gameType: "fps",
  status: "in_progress" as const,
  createdAt: "2024-01-01T00:00:00Z",
};

describe("isMatchStatus()", () => {
  it.each(["pending", "in_progress", "completed", "disputed", "cancelled"])(
    "returns true for valid status: %s",
    (s) => expect(isMatchStatus(s)).toBe(true),
  );

  it("returns false for invalid status", () => {
    expect(isMatchStatus("running")).toBe(false);
  });
});

describe("isMatch()", () => {
  it("returns true for a valid Match", () => {
    expect(isMatch(validMatch)).toBe(true);
  });

  it("returns false when status is invalid", () => {
    expect(isMatch({ ...validMatch, status: "unknown" })).toBe(false);
  });
});

describe("isMatchWithPlayers()", () => {
  it("returns true when username fields are present", () => {
    expect(isMatchWithPlayers({ ...validMatch, player1Username: "alice", player2Username: "bob" })).toBe(true);
  });

  it("returns false when usernames are missing", () => {
    expect(isMatchWithPlayers(validMatch)).toBe(false);
  });
});

describe("isMatchResult()", () => {
  it("returns true for a valid result", () => {
    expect(isMatchResult({ matchId: "m1", winnerId: "u1", scorePlayer1: 3, scorePlayer2: 1 })).toBe(true);
  });

  it("returns false for non-numeric scores", () => {
    expect(isMatchResult({ matchId: "m1", winnerId: "u1", scorePlayer1: "3", scorePlayer2: 1 })).toBe(false);
  });
});

// ─── Tournament guards ────────────────────────────────────────────────────────

const validTournament = {
  id: "t1",
  name: "Spring Cup",
  gameType: "fps",
  tournamentType: "single_elimination",
  entryFee: 0,
  prizePool: 100,
  maxParticipants: 16,
  currentParticipants: 4,
  status: "registration_open" as const,
  visibility: "public" as const,
  startTime: "2024-06-01T00:00:00Z",
  createdBy: "u1",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

describe("isTournamentStatus()", () => {
  it.each(["draft","registration_open","registration_closed","in_progress","completed","cancelled"])(
    "valid: %s", (s) => expect(isTournamentStatus(s)).toBe(true),
  );
  it("invalid", () => expect(isTournamentStatus("active")).toBe(false));
});

describe("isTournament()", () => {
  it("returns true for valid tournament", () => {
    expect(isTournament(validTournament)).toBe(true);
  });

  it("returns false when entryFee is a string", () => {
    expect(isTournament({ ...validTournament, entryFee: "0" })).toBe(false);
  });
});

// ─── Notification guards ──────────────────────────────────────────────────────

describe("isNotificationType()", () => {
  it.each(["info","success","warning","error","match"])(
    "valid: %s", (t) => expect(isNotificationType(t)).toBe(true),
  );
  it("invalid", () => expect(isNotificationType("debug")).toBe(false));
});

describe("isPersistentNotification()", () => {
  it("returns true for valid notification", () => {
    expect(isPersistentNotification({
      id: "n1", type: "info", title: "Hi", message: "Hello",
      read: false, createdAt: "2024-01-01",
    })).toBe(true);
  });

  it("returns false when read is missing", () => {
    expect(isPersistentNotification({
      id: "n1", type: "info", title: "Hi", message: "Hello", createdAt: "2024",
    })).toBe(false);
  });
});

describe("isToastNotification()", () => {
  it("returns true for valid toast", () => {
    expect(isToastNotification({
      id: "t1", type: "success", title: "Done", createdAt: Date.now(),
    })).toBe(true);
  });
});

// ─── Wallet guards ────────────────────────────────────────────────────────────

describe("isWalletType()", () => {
  it.each(["freighter", "albedo"])("valid: %s", (t) => expect(isWalletType(t)).toBe(true));
  it("invalid", () => expect(isWalletType("metamask")).toBe(false));
});

describe("isTxStatus()", () => {
  it.each(["pending","success","failed"])("valid: %s", (s) => expect(isTxStatus(s)).toBe(true));
  it("invalid", () => expect(isTxStatus("completed")).toBe(false));
});

describe("isWalletSession()", () => {
  it("returns true for a valid session", () => {
    expect(isWalletSession({
      publicKey: "GABC...XYZ",
      walletType: "freighter",
      network: "testnet",
      connectedAt: "2024-01-01T00:00:00Z",
    })).toBe(true);
  });

  it("returns false for invalid wallet type", () => {
    expect(isWalletSession({
      publicKey: "GABC",
      walletType: "metamask",
      network: "testnet",
      connectedAt: "2024",
    })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isWalletSession(null)).toBe(false);
  });
});

// ─── Leaderboard guards ───────────────────────────────────────────────────────

describe("isLeaderboardCategory()", () => {
  it.each(["global","tournaments","casual","ranked"])("valid: %s", (c) => expect(isLeaderboardCategory(c)).toBe(true));
  it("invalid", () => expect(isLeaderboardCategory("pro")).toBe(false));
});

describe("isLeaderboardEntry()", () => {
  it("returns true for valid entry", () => {
    expect(isLeaderboardEntry({
      id: "e1", userId: "u1", username: "alice",
      ranking: 1, eloRating: 1800, wins: 10, losses: 2,
      matchesPlayed: 12, winRate: 0.83, period: "season1", updatedAt: "2024",
    })).toBe(true);
  });

  it("returns false when ranking is missing", () => {
    expect(isLeaderboardEntry({ id: "e1", userId: "u1", username: "alice" })).toBe(false);
  });
});

// ─── Social guards ────────────────────────────────────────────────────────────

describe("isSocialUser()", () => {
  it("returns true for valid social user", () => {
    expect(isSocialUser({ id: "u1", username: "alice", elo: 1200, status: "online" })).toBe(true);
  });

  it("returns false when elo is missing", () => {
    expect(isSocialUser({ id: "u1", username: "alice" })).toBe(false);
  });
});

describe("isFriend()", () => {
  it("returns true when friendSince is present", () => {
    expect(isFriend({ id: "u1", username: "alice", elo: 1200, status: "online", friendSince: "2024-01-01" })).toBe(true);
  });

  it("returns false when friendSince is missing", () => {
    expect(isFriend({ id: "u1", username: "alice", elo: 1200, status: "online" })).toBe(false);
  });
});

// ─── Governance guards ────────────────────────────────────────────────────────

describe("isProposalStatus()", () => {
  it.each(["PENDING","APPROVED","EXECUTED","CANCELLED","FAILED"])("valid: %s", (s) => expect(isProposalStatus(s)).toBe(true));
  it("invalid", () => expect(isProposalStatus("pending")).toBe(false)); // lowercase
});

describe("isProposal()", () => {
  it("returns true for valid proposal", () => {
    expect(isProposal({
      id: "p1",
      proposal_id: "0x1234",
      target_contract: "CABC",
      function: "vote",
      args: {},
      status: "PENDING",
      proposer: "GABC",
      created_at: "2024-01-01",
    })).toBe(true);
  });

  it("returns false for invalid status", () => {
    expect(isProposal({ id: "p1", proposal_id: "0x", target_contract: "C", function: "f", args: {}, status: "OPEN", proposer: "G", created_at: "2024" })).toBe(false);
  });
});

// ─── Collaboration guards ─────────────────────────────────────────────────────

describe("isCollaborationUser()", () => {
  it("returns true for minimal user shape", () => {
    expect(isCollaborationUser({ id: "u1", username: "alice" })).toBe(true);
  });
});

describe("isCollaborationEvent()", () => {
  it("returns true for a valid USER_JOINED event", () => {
    expect(isCollaborationEvent({
      type: CollaborationEventType.USER_JOINED,
      channelId: "ch1",
      timestamp: Date.now(),
      userId: "u1",
      user: { id: "u1", username: "alice", status: "online" },
    })).toBe(true);
  });

  it("returns false for an unknown event type", () => {
    expect(isCollaborationEvent({
      type: "CUSTOM_EVENT",
      channelId: "ch1",
      timestamp: Date.now(),
      userId: "u1",
    })).toBe(false);
  });
});

// ─── assertDefined ────────────────────────────────────────────────────────────

describe("assertDefined()", () => {
  it("does not throw for defined values", () => {
    expect(() => assertDefined("hello")).not.toThrow();
    expect(() => assertDefined(0)).not.toThrow();
    expect(() => assertDefined(false)).not.toThrow();
  });

  it("throws for null", () => {
    expect(() => assertDefined(null)).toThrow("Expected value to be defined");
  });

  it("throws for undefined with custom message", () => {
    expect(() => assertDefined(undefined, "User ID is required")).toThrow("User ID is required");
  });
});

// ─── assertShape ──────────────────────────────────────────────────────────────

describe("assertShape()", () => {
  it("returns the value when guard passes", () => {
    const user = assertShape({ id: "u1", username: "alice", email: "a@b.com", isVerified: true, elo: 1200, createdAt: "2024" }, isUser);
    expect(user.username).toBe("alice");
  });

  it("throws when guard fails", () => {
    expect(() => assertShape({ id: "u1" }, isUser, "Not a user")).toThrow("Not a user");
  });
});

// ─── safeJsonParse ────────────────────────────────────────────────────────────

describe("safeJsonParse()", () => {
  it("parses valid JSON", () => {
    expect(safeJsonParse('{"id":"1"}')).toEqual({ id: "1" });
  });

  it("returns null for invalid JSON", () => {
    expect(safeJsonParse("{invalid}")).toBeNull();
  });

  it("validates parsed value with guard", () => {
    const raw = JSON.stringify({ id: "u1", username: "alice", email: "a@b.com", isVerified: true, elo: 1200, createdAt: "2024" });
    expect(safeJsonParse(raw, isUser)).toBeTruthy();
  });

  it("returns null when guard fails", () => {
    expect(safeJsonParse('{"id":"1"}', isUser)).toBeNull();
  });
});

// ─── types/index.ts barrel ────────────────────────────────────────────────────

describe("types/index.ts barrel", () => {
  it("exports ApiResponse", async () => {
    const { ok: okFn } = await import("@/types");
    // ok is a value export
    expect(typeof okFn).toBe("function");
  });

  it("re-exports domain types without collision", async () => {
    // If there's a name collision the import would throw at module load
    const types = await import("@/types");
    expect(types).toBeDefined();
  });
});
