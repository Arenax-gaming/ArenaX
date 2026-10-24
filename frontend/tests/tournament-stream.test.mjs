import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const compiled = ts.transpileModule(
  readFileSync(new URL("../src/lib/tournament-stream.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } },
).outputText;
const { startTournamentStream, parseTournamentUpdate, matchResultText } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);

const id = "fbb5ce63-5eaf-4217-bbc1-e627cdd34ee0";
function details(pool = "100") {
  return {
    id, name: "Test tournament", description: "Live state fixture", status: "registration_open",
    prize_pool: pool, entry_fee: "10", max_participants: 16, current_participants: 8,
    start_time: "2026-10-24T12:00:00Z", rules: ["1v1"],
  };
}
const response = (data) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await sleep(5);
  }
  throw new Error("condition not reached");
}
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
class FakeSource {
  listeners = new Map();
  closed = false;
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  close() { this.closed = true; }
  emit(name, data) {
    this.listeners.get(name)?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }
}
function setup(t, fetchImpl) {
  const sources = [], snapshots = [], errors = [], connections = [], results = [];
  const control = startTournamentStream({
    tournamentId: id, apiBase: "http://backend.test/api/", fetchImpl,
    makeSource(url) {
      const source = new FakeSource();
      source.url = url;
      sources.push(source);
      return source;
    },
    onSnapshot: value => snapshots.push(value),
    onError: value => errors.push(value),
    onConnection: value => connections.push(value),
    onMatchResult: value => results.push(value),
    coalesceMs: 0, retryBaseMs: 10,
  });
  t.after(() => control.stop());
  return { control, sources, snapshots, errors, connections, results };
}

test("initial read uses the route id and opens exactly its tournament feed", async t => {
  const requests = [];
  const state = setup(t, async (url, options) => {
    requests.push({ url, options });
    return response(details());
  });
  await until(() => state.sources.length === 1);
  assert.equal(requests[0].url, "http://backend.test/api/tournaments/" + id);
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(state.sources[0].url, requests[0].url + "/events");
  state.sources[0].onopen();
  await until(() => state.snapshots.length === 2);
  assert.equal(state.connections.at(-1), "live");
});

test("a burst coalesces reads and wrong-id, malformed and unknown events are ignored", async t => {
  let reads = 0;
  const state = setup(t, async () => { reads++; return response(details(String(reads))); });
  await until(() => state.sources.length === 1);
  const source = state.sources[0];
  source.emit("tournament_update", "invalid json");
  source.emit("tournament_update", { tournament_id: "unrelated", kind: "status_changed", data: {} });
  source.emit("tournament_update", { tournament_id: id, kind: "unknown", data: {} });
  await sleep(15);
  assert.equal(reads, 1);
  for (let i = 0; i < 20; i++) {
    source.emit("tournament_update", { tournament_id: id, kind: "prize_pool_changed", data: {} });
  }
  await until(() => reads === 2);
  await sleep(15);
  assert.equal(reads, 2);
  assert.equal(state.snapshots.at(-1).prize_pool, "2");
});

test("an initial resync and a Redis gap each refresh the authoritative snapshot", async t => {
  let reads = 0;
  const state = setup(t, async () => { reads++; return response(details(String(reads))); });
  await until(() => state.sources.length === 1);
  state.sources[0].emit("resync", {});
  await until(() => state.snapshots.length === 2);
  state.sources[0].emit("resync", {});
  await until(() => state.snapshots.length === 3);
  assert.equal(state.snapshots.at(-1).prize_pool, "3");
});

test("a late aborted read cannot overwrite a newer tournament snapshot", async t => {
  const pending = [], requests = [];
  const state = setup(t, async (_url, options) => {
    const request = deferred();
    pending.push(request);
    requests.push(options);
    return request.promise;
  });
  pending[0].resolve(response(details("100")));
  await until(() => state.sources.length === 1);
  const older = state.control.refresh();
  const newer = state.control.refresh();
  assert.equal(requests[1].signal.aborted, true);
  pending[2].resolve(response(details("300")));
  await newer;
  pending[1].resolve(response(details("200")));
  await older;
  assert.deepEqual(state.snapshots.map(value => value.prize_pool), ["100", "300"]);
});

test("transport errors reconnect and refresh after the replacement stream opens", async t => {
  const state = setup(t, async () => response(details()));
  await until(() => state.sources.length === 1);
  const first = state.sources[0];
  first.onerror();
  assert.equal(first.closed, true);
  assert.equal(state.connections.at(-1), "reconnecting");
  await until(() => state.sources.length === 2);
  state.sources[1].onopen();
  await until(() => state.connections.at(-1) === "live");
});

test("teardown aborts requests, closes the stream and cancels queued retries", async t => {
  let reads = 0;
  const state = setup(t, async () => { reads++; return response(details()); });
  await until(() => state.sources.length === 1);
  const source = state.sources[0];
  source.onerror();
  state.control.stop();
  source.emit("tournament_update", { tournament_id: id, kind: "status_changed", data: {} });
  await sleep(30);
  assert.equal(source.closed, true);
  assert.equal(state.sources.length, 1);
  assert.equal(reads, 1);
});

test("missing tournaments show an error and do not open a useless SSE stream", async t => {
  const state = setup(t, async () => ({ ok: false, status: 404 }));
  await until(() => state.errors.length === 1);
  assert.equal(state.errors[0], "Tournament not found.");
  assert.equal(state.sources.length, 0);
});

test("snapshot network failures retry without waiting for a new tournament event", async t => {
  let reads = 0;
  const state = setup(t, async () => {
    if (++reads === 1) throw new Error("Connection interrupted");
    return response(details("200"));
  });
  await until(() => state.snapshots.length === 1);
  assert.equal(reads, 2);
  assert.deepEqual(state.errors, ["Connection interrupted"]);
  assert.equal(state.snapshots[0].prize_pool, "200");
  assert.equal(state.sources.length, 1);
});

test("events during a slow snapshot queue one follow-up read without aborting it", async t => {
  const pending = deferred();
  let reads = 0;
  let slowSignal;
  const state = setup(t, async (_url, options) => {
    reads++;
    if (reads === 2) {
      slowSignal = options.signal;
      return pending.promise;
    }
    return response(details(reads === 1 ? "100" : "300"));
  });
  await until(() => state.sources.length === 1);
  state.sources[0].emit("resync", {});
  await until(() => reads === 2);
  for (let i = 0; i < 20; i++) state.sources[0].emit("resync", {});
  await sleep(15);
  assert.equal(reads, 2);
  assert.equal(slowSignal.aborted, false);
  pending.resolve(response(details("200")));
  await until(() => state.snapshots.length === 3);
  assert.equal(reads, 3);
  assert.equal(state.snapshots.at(-1).prize_pool, "300");
});

test("optional snapshot metadata is normalized before reaching the detail page", async t => {
  const state = setup(t, async () => response({
    ...details(), metadata: { banner_url: { invalid: true } },
    game_type: { invalid: true }, rules: ["1v1", 12, null],
  }));
  await until(() => state.snapshots.length === 1);
  assert.equal(state.snapshots[0].metadata, null);
  assert.equal(state.snapshots[0].game_type, undefined);
  assert.deepEqual(state.snapshots[0].rules, ["1v1"]);
});

test("verified match-result messages are delivered and formatted without other-tournament data", async t => {
  const state = setup(t, async () => response(details()));
  await until(() => state.sources.length === 1);
  const update = {
    tournament_id: id, kind: "match_result",
    data: { match_id: "9d2e0036-6fe0-4ed7-a112-293452a9cb46",
      data: { Completed: { player1_score: 3, player2_score: 1, winner_id: "player-1" } } },
  };
  assert.equal(parseTournamentUpdate({ ...update, tournament_id: "other" }, id), null);
  assert.ok(parseTournamentUpdate(update, id));
  state.sources[0].emit("tournament_update", update);
  assert.equal(state.results.length, 1);
  assert.equal(matchResultText(state.results[0]), "Match 9d2e0036: 3 – 1");
});
