# GraphQL Federation

Closes #652.

The `arenax-server` GraphQL layer (`src/graphql/`) is now a real **Apollo
Federation v2 subgraph**, not just a standalone schema. This lets other
services own their own GraphQL types and *extend* entities this service
publishes (`User`, `Match`, `Tournament`) without a shared monolithic
schema or a hard runtime dependency between services.

## What changed

- `src/graphql/schema.ts` — the SDL now opens with:

  ```graphql
  extend schema
      @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable"])
  ```

  and marks `User`, `Match`, and `Tournament` as federated entities via
  `@key(fields: "id")`.

- `src/graphql/resolvers.ts` — each entity type gets a `__resolveReference`
  resolver. This is what the router/gateway calls when another subgraph
  says "give me the rest of the fields for `{ __typename: "User", id }`".

- `src/graphql/server.ts` — the schema handed to `graphql-yoga` is now built
  with `@apollo/subgraph`'s `buildSubgraphSchema(...)` instead of a plain
  `{ typeDefs, resolvers }` object. This automatically adds the federation
  machinery (`_service { sdl }`, `_entities(representations: [_Any!]!)`)
  that a gateway needs to compose this subgraph into a supergraph.

Nothing about the public `/api/graphql` endpoint changes for existing
clients — it's still a normal, directly-queryable GraphQL endpoint. The
federation directives are additive.

## Verifying subgraph compliance locally

```bash
npm run dev
# in another shell
curl -s -X POST http://localhost:<PORT>/api/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ _service { sdl } }"}' | jq
```

A non-empty `sdl` string confirms the endpoint is a valid Federation v2
subgraph.

## Composing a supergraph

This service does not run a gateway itself — federation is only useful once
a *second* subgraph exists to compose against. When that lands, compose
with the Apollo Rover CLI:

```bash
rover subgraph check my-supergraph@prod \
  --schema ./schema.graphql --name arenax-server

rover supergraph compose --config ./supergraph.yaml > supergraph.graphql
```

`supergraph.yaml` example:

```yaml
federation_version: 2
subgraphs:
  arenax-server:
    routing_url: https://api.arenax.internal/api/graphql
    schema:
      subgraph_url: https://api.arenax.internal/api/graphql
  # wallet-service, social-service, etc. added here as they adopt federation
```

The composed `supergraph.graphql` is then served by an `@apollo/gateway` or
Apollo Router instance, which fans queries out to each subgraph and stitches
the entity references together.

## Extending an entity from another subgraph

A future subgraph (e.g. a wallet service) can add fields to `User` without
touching this codebase:

```graphql
type User @key(fields: "id") {
  id: ID!
  walletBalance: Int!
}
```

When the gateway resolves a query that needs both `displayName` (owned
here) and `walletBalance` (owned by the wallet subgraph), it calls this
service's `_entities` resolver with `{ __typename: "User", id }` to fetch
the base fields, then merges in the wallet subgraph's response.

## Follow-up (tracked separately, out of scope for this change)

- Stand up an actual Apollo Router / gateway once a second subgraph exists.
- Add subgraph schema checks (`rover subgraph check`) to CI once there is a
  registered graph to check against.
- Field-level `@shareable`/`@override` usage once ownership of overlapping
  fields needs to move between services.
