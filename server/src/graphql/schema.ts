/**
 * GraphQL schema foundation for #467, promoted to an Apollo Federation v2
 * subgraph for #652.
 *
 * Defined in raw SDL so the layer is independent of the executor
 * (Apollo, Yoga, …). The maintainer can pick the runtime later; this
 * file is the schema-as-source-of-truth for clients and for the
 * resolver registry in resolvers.ts.
 *
 * `User`, `Match` and `Tournament` are declared as federated entities
 * (`@key(fields: "id")`) so other subgraphs (e.g. a future wallet or
 * social service) can extend them with their own fields without this
 * service knowing about it. See server/docs/GRAPHQL_FEDERATION.md for
 * how to compose this subgraph into a supergraph.
 *
 * Only the entities that already exist on the REST surface are
 * included. Subscriptions and field-level authorisation are sketched
 * via directives so resolvers know what to enforce, but kept tiny to
 * avoid scope creep — the issue explicitly tracks them as separate
 * sub-items.
 */
export const typeDefs = /* GraphQL */ `
    extend schema
        @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable"])

    """
    Field-level authorisation directive. Resolvers gate on the role
    name supplied at the field; missing or insufficient roles map to
    a GraphQL error with status code 403.
    """
    directive @auth(role: String!) on FIELD_DEFINITION

    scalar DateTime

    type User @key(fields: "id") {
        id: ID!
        displayName: String!
        rating: Int!
        createdAt: DateTime!
        recentMatches(limit: Int = 10): [Match!]! @auth(role: "user")
    }

    enum MatchOutcome {
        WIN
        LOSS
        DRAW
        CANCELLED
    }

    type Match @key(fields: "id") {
        id: ID!
        gameMode: String!
        teamA: [User!]!
        teamB: [User!]!
        outcome: MatchOutcome
        startedAt: DateTime!
        finishedAt: DateTime
        ratingDelta: Int
    }

    type Tournament @key(fields: "id") {
        id: ID!
        name: String!
        startsAt: DateTime!
        endsAt: DateTime
        participantCount: Int!
    }

    type PageInfo {
        hasNextPage: Boolean!
        endCursor: String
    }

    type MatchConnection {
        edges: [Match!]!
        pageInfo: PageInfo!
    }

    type Query {
        viewer: User @auth(role: "user")
        user(id: ID!): User
        matches(limit: Int = 20, after: String): MatchConnection!
        tournament(id: ID!): Tournament
    }

    type Mutation {
        joinMatchmakingQueue(gameMode: String!): Boolean! @auth(role: "user")
        leaveMatchmakingQueue: Boolean! @auth(role: "user")
    }

    type Subscription {
        """
        Emits each ranked rating update for the viewer. Resolvers should
        narrow this stream to the authenticated viewer's own changes
        before publishing.
        """
        viewerRatingChanged: User @auth(role: "user")

        """
        Streams the lifecycle of a single match: started, scoring updates,
        finished. Subscribers SHOULD supply the matchId they actually
        care about; resolvers reject wildcards.
        """
        matchEvents(matchId: ID!): Match @auth(role: "user")
    }
`
