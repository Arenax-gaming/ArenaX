import type { Express, RequestHandler } from 'express';
import { typeDefs } from './schema';
import { resolvers } from './resolvers';
import { buildGraphQLContext, type GraphQLContext } from './context';

export interface GraphQLRegistration {
    path: string
    handler: RequestHandler
}

export interface GraphQLExecutor {
    mount(app: Express): GraphQLRegistration
    stop(): Promise<void>
}

class YogaExecutor implements GraphQLExecutor {
    private yoga: any = null;

    mount(app: Express): GraphQLRegistration {
        const path = '/api/graphql';

        // Lazy async init — the first request triggers the dynamic import
        // so CommonJS environments can load this module without choking on
        // graphql-yoga's ESM-only distribution.
        const lazyHandler: RequestHandler = (req, res, next) => {
            if (this.yoga) {
                this.yoga(req, res, next);
                return;
            }
            // @ts-expect-error - graphql-yoga is ESM-only; dynamic import works at runtime
            import('graphql-yoga').then(({ createYoga }: any) => {
                this.yoga = createYoga({
                    schema: { typeDefs, resolvers },
                    context: async ({ request }: { request: any }) =>
                        buildGraphQLContext(request as unknown as import('express').Request),
                    graphiql: process.env.NODE_ENV !== 'production',
                    graphqlEndpoint: path,
                    cors: false,
                    logging: false,
                });
                this.yoga(req, res, next);
            }).catch(() => {
                res.status(503).json({
                    errors: [{ message: 'GraphQL executor not available', extensions: { code: 'GRAPHQL_UNAVAILABLE' } }],
                });
            });
        };

        app.use(path, lazyHandler);
        return { path, handler: lazyHandler };
    }

    async stop(): Promise<void> {
        // yoga doesn't require explicit cleanup for subscriptions in memory
    }
}

let activeExecutor: GraphQLExecutor = process.env.GRAPHQL_DISABLED === 'true'
    ? new (class UnconfiguredExecutor implements GraphQLExecutor {
        mount(app: Express): GraphQLRegistration {
            const path = '/api/graphql';
            const handler: RequestHandler = (req, res) => {
                const context = buildGraphQLContext(req);
                res.status(503).json({
                    errors: [{
                        message: 'GraphQL executor disabled by config',
                        extensions: { code: 'GRAPHQL_DISABLED', requestId: context.requestId },
                    }],
                });
            };
            app.post(path, handler);
            app.get(path, handler);
            return { path, handler };
        }
        async stop(): Promise<void> { /* no-op */ }
    })()
    : new YogaExecutor();

export function getGraphQLExecutor(): GraphQLExecutor {
    return activeExecutor;
}

export function setGraphQLExecutor(executor: GraphQLExecutor): void {
    activeExecutor = executor;
}

export function getGraphQLSchemaSDL(): string {
    return typeDefs;
}

export type { GraphQLContext };
