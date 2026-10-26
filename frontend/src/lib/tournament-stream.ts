export interface TournamentSnapshot {
  id: string;
  name: string;
  description: string | null;
  game_type?: string;
  game?: string;
  status: string;
  prize_pool: string | number;
  entry_fee: string | number;
  prize_pool_currency?: string | null;
  entry_fee_currency?: string | null;
  max_participants: number;
  current_participants: number;
  start_time: string;
  rules: string[] | null;
  metadata?: { banner_url?: string } | null;
}

export interface TournamentUpdate {
  tournament_id: string;
  kind: string;
  data: Record<string, unknown>;
}

export type ConnectionState = "connecting" | "live" | "reconnecting";
type Source = Pick<EventSource, "close" | "addEventListener" | "onopen" | "onerror">;

interface Options {
  tournamentId: string;
  apiBase: string;
  onSnapshot: (snapshot: TournamentSnapshot) => void;
  onError: (message: string) => void;
  onConnection: (connection: ConnectionState) => void;
  onMatchResult?: (update: TournamentUpdate) => void;
  fetchImpl?: typeof fetch;
  makeSource?: (url: string) => Source;
  coalesceMs?: number;
  retryBaseMs?: number;
}

const kinds = new Set([
  "created", "status_changed", "match_result", "prize_pool_changed",
  "participants_changed", "bracket_changed",
]);

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshot(value: unknown, tournamentId: string): TournamentSnapshot {
  const data = object(value) && object(value.data) ? value.data : value;
  if (!object(data) || data.id !== tournamentId || typeof data.name !== "string" ||
      typeof data.status !== "string" || typeof data.start_time !== "string" ||
      (typeof data.prize_pool !== "string" && typeof data.prize_pool !== "number") ||
      (typeof data.entry_fee !== "string" && typeof data.entry_fee !== "number") ||
      typeof data.max_participants !== "number" || !Number.isInteger(data.max_participants) || data.max_participants < 0 ||
      typeof data.current_participants !== "number" || !Number.isInteger(data.current_participants) || data.current_participants < 0 ||
      !Number.isFinite(Date.parse(data.start_time))) {
    throw new Error("Unable to read tournament details.");
  }
  const metadata = object(data.metadata) && typeof data.metadata.banner_url === "string"
    ? { banner_url: data.metadata.banner_url } : null;
  return {
    id: tournamentId,
    name: data.name,
    status: data.status,
    start_time: data.start_time,
    prize_pool: data.prize_pool,
    entry_fee: data.entry_fee,
    max_participants: data.max_participants,
    current_participants: data.current_participants,
    game_type: typeof data.game_type === "string" ? data.game_type : undefined,
    game: typeof data.game === "string" ? data.game : undefined,
    prize_pool_currency: typeof data.prize_pool_currency === "string" ? data.prize_pool_currency : null,
    entry_fee_currency: typeof data.entry_fee_currency === "string" ? data.entry_fee_currency : null,
    description: typeof data.description === "string" ? data.description : null,
    rules: Array.isArray(data.rules) ? data.rules.filter((rule): rule is string => typeof rule === "string") : null,
    metadata,
  };
}

export function parseTournamentUpdate(value: unknown, tournamentId: string): TournamentUpdate | null {
  if (!object(value) || value.tournament_id !== tournamentId ||
      typeof value.kind !== "string" || !kinds.has(value.kind) || !object(value.data)) {
    return null;
  }
  return { tournament_id: tournamentId, kind: value.kind, data: value.data };
}

/** One stream per mounted detail page; events trigger coalesced snapshot reads.
 * Request generations also protect against late responses to aborted requests. */
export function startTournamentStream(options: Options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const makeSource = options.makeSource ?? ((url: string) => new EventSource(url));
  const url = options.apiBase.replace(/\/$/, "") + "/tournaments/" + encodeURIComponent(options.tournamentId);
  let active = true;
  let generation = 0;
  let request: AbortController | undefined;
  let source: Source | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let snapshotRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshQueued = false;
  const retryBase = options.retryBaseMs ?? 500;
  let retryDelay = retryBase;
  let snapshotRetryDelay = retryBase;

  function scheduleRefresh() {
    if (!active || refreshTimer !== undefined) return;
    if (request) {
      refreshQueued = true;
      return;
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      if (request) refreshQueued = true;
      else void refresh();
    }, options.coalesceMs ?? 100);
  }

  function connect() {
    if (!active || source) return;
    let current: Source;
    try {
      current = makeSource(url + "/events");
      source = current;
    } catch {
      reconnect();
      return;
    }
    current.onopen = () => {
      if (!active || source !== current) return;
      retryDelay = retryBase;
      options.onConnection("live");
      scheduleRefresh();
    };
    current.addEventListener("resync", () => {
      if (active && source === current) scheduleRefresh();
    });
    current.addEventListener("tournament_update", (message) => {
      if (!active || source !== current) return;
      let update: TournamentUpdate | null;
      try {
        update = parseTournamentUpdate(JSON.parse((message as MessageEvent<string>).data), options.tournamentId);
      } catch {
        return;
      }
      if (!update) return;
      if (update.kind === "match_result") options.onMatchResult?.(update);
      scheduleRefresh();
    });
    current.onerror = () => {
      if (!active || source !== current) return;
      current.close();
      source = undefined;
      reconnect();
      scheduleRefresh();
    };
  }

  function reconnect() {
    if (!active || retryTimer !== undefined) return;
    options.onConnection("reconnecting");
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      connect();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15_000);
  }

  async function refresh() {
    if (!active) return;
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
    clearTimeout(snapshotRetryTimer);
    snapshotRetryTimer = undefined;
    refreshQueued = false;
    const revision = ++generation;
    request?.abort();
    const current = new AbortController();
    request = current;
    let retrySnapshot = true;
    try {
      const response = await fetchImpl(url, { signal: current.signal, cache: "no-store" });
      if (!active || revision !== generation) return;
      if (!response.ok) {
        retrySnapshot = response.status !== 404;
        throw new Error(response.status === 404 ? "Tournament not found." : "Unable to load tournament.");
      }
      const data = snapshot(await response.json(), options.tournamentId);
      if (!active || revision !== generation) return;
      snapshotRetryDelay = retryBase;
      options.onSnapshot(data);
      if (!source && retryTimer === undefined) connect();
    } catch (error) {
      if (!active || revision !== generation || current.signal.aborted) return;
      options.onError(error instanceof Error ? error.message : "Unable to load tournament.");
      if (retrySnapshot && snapshotRetryTimer === undefined) {
        snapshotRetryTimer = setTimeout(() => {
          snapshotRetryTimer = undefined;
          void refresh();
        }, snapshotRetryDelay);
        snapshotRetryDelay = Math.min(snapshotRetryDelay * 2, 15_000);
      }
    } finally {
      if (request === current) {
        request = undefined;
        if (active && refreshQueued) scheduleRefresh();
      }
    }
  }

  options.onConnection("connecting");
  void refresh();
  return {
    refresh,
    stop() {
      active = false;
      generation += 1;
      request?.abort();
      source?.close();
      source = undefined;
      clearTimeout(refreshTimer);
      clearTimeout(retryTimer);
      clearTimeout(snapshotRetryTimer);
    },
  };
}

export function matchResultText(update: TournamentUpdate): string | null {
  const event = update.data;
  if (typeof event.match_id !== "string" || !object(event.data)) return null;
  const result = event.data.Completed;
  if (object(result) && typeof result.player1_score === "number" && typeof result.player2_score === "number") {
    return "Match " + event.match_id.slice(0, 8) + ": " + result.player1_score + " – " + result.player2_score;
  }
  const report = event.data.ScoreReported;
  if (object(report) && typeof report.score === "number") {
    return "Match " + event.match_id.slice(0, 8) + ": new score reported (" + report.score + ")";
  }
  return null;
}
