import type { Express, RequestHandler } from 'express'
import { typeDefs } from './schema'
import { buildGraphQLContext, type GraphQLContext } from './context'

/**
 * Wiring point for the GraphQL executor. Kept as a registration helper
 * rather than an immediate `new ApolloServer(...)` so:
 *
 *   - The chosen executor (Apollo, Yoga, Mercurius, …) is pluggable.
 *   - Tests that exercise resolver logic don't need a running HTTP
 *     server.
 *   - The schema lands now and the runtime can land in a follow-up PR
 *     without breaking imports.
 *
 * Resolvers live in `resolvers.ts` (to be added in the follow-up); this
 * file is the integration seam.
 */

export interface GraphQLRegistration {
    path: string
    /**
     * Express handler for the GraphQL endpoint. The executor returns
     * this when `mount()` is called — production code mounts it under
     * `/api/graphql`; tests can call the handler directly.
     */
    handler: RequestHandler
}

export interface GraphQLExecutor {
    /** Mount the GraphQL endpoint on the supplied Express app. */
    mount(app: Express): GraphQLRegistration
    /** Drop any open subscription sockets and free in-memory state. */
    stop(): Promise<void>
}

/**
 * Bare-bones executor implementation that returns a 503 until a real
 * runtime is registered. It keeps the schema importable from anywhere
 * (e.g. type generation) and gives the rest of the server a stable
 * registration point.
 */
class UnconfiguredExecutor implements GraphQLExecutor {
    mount(app: Express): GraphQLRegistration {
        const path = '/api/graphql'
        const handler: RequestHandler = (req, res) => {
            const context = buildGraphQLContext(req)
            res.status(503).json({
                errors: [
                    {
                        message:
                            'GraphQL executor not yet registered. See server/src/graphql/server.ts.',
                        extensions: { code: 'GRAPHQL_UNCONFIGURED', requestId: context.requestId },
                    },
                ],
            })
        }
        app.post(path, handler)
        app.get(path, handler)
        return { path, handler }
    }

    async stop(): Promise<void> {
        // No-op until a real executor is registered.
    }
}

let activeExecutor: GraphQLExecutor = new UnconfiguredExecutor()

export function getGraphQLExecutor(): GraphQLExecutor {
    return activeExecutor
}

export function setGraphQLExecutor(executor: GraphQLExecutor): void {
    activeExecutor = executor
}

/**
 * Snapshot of the registered schema. Exposed for clients that want to
 * download the SDL (e.g. codegen) without depending on the executor.
 */
export function getGraphQLSchemaSDL(): string {
    return typeDefs
}

export type { GraphQLContext }
