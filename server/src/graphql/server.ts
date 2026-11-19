import type { Express, RequestHandler } from 'express';
import { parse, ValidationContext, GraphQLError, DocumentNode } from 'graphql';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { typeDefs } from './schema';
import { resolvers } from './resolvers';
import { buildGraphQLContext, type GraphQLContext } from './context';

// Built once at module load: a real Apollo Federation v2 subgraph schema
// (adds `_service { sdl }` and `_entities(representations: [_Any!]!)` on
// top of the application schema). A future gateway/router composes this
// together with other subgraphs into a supergraph — see
// server/docs/GRAPHQL_FEDERATION.md.
const federatedSchema = buildSubgraphSchema({ typeDefs: parse(typeDefs), resolvers: resolvers as any });

// ── #1386: Query depth and complexity limits ──────────────────────────────────
// Both limits are configurable via environment variables.
// Rules fire as schema validation rules — before any resolver runs.

const MAX_DEPTH   = parseInt(process.env.GRAPHQL_MAX_DEPTH        ?? '7',   10);
const MAX_COMPLEXITY = parseInt(process.env.GRAPHQL_MAX_COMPLEXITY ?? '200', 10);

/**
 * Rejects queries deeper than maxDepth levels.
 */
function depthLimitRule(maxDepth: number) {
    return (context: ValidationContext) => {
        function measure(node: any, depth: number): number {
            if (!node?.selectionSet) return depth;
            return Math.max(
                ...node.selectionSet.selections.map((sel: any) => measure(sel, depth + 1)),
            );
        }
        return {
            Document(node: DocumentNode) {
                for (const def of node.definitions) {
                    const d = measure(def, 0);
                    if (d > maxDepth) {
                        context.reportError(
                            new GraphQLError(
                                `Query depth ${d} exceeds the maximum allowed depth of ${maxDepth}.`,
                                { extensions: { code: 'QUERY_LIMIT_EXCEEDED' } },
                            ),
                        );
                    }
                }
            },
        };
    };
}

/**
 * Rejects queries whose field-weight complexity exceeds maxComplexity.
 * fieldWeights: { [fieldName]: number } — default weight per field is 1.
 */
function complexityLimitRule(
    maxComplexity: number,
    fieldWeights: Record<string, number> = {},
) {
    return (context: ValidationContext) => {
        function measure(node: any): number {
            if (!node?.selectionSet) return 0;
            return node.selectionSet.selections.reduce((sum: number, sel: any) => {
                const w = fieldWeights[sel?.name?.value ?? ''] ?? 1;
                return sum + w + measure(sel);
            }, 0);
        }
        return {
            Document(node: DocumentNode) {
                for (const def of node.definitions) {
                    const c = measure(def);
                    if (c > maxComplexity) {
                        context.reportError(
                            new GraphQLError(
                                `Query complexity ${c} exceeds the maximum allowed complexity of ${maxComplexity}.`,
                                { extensions: { code: 'QUERY_LIMIT_EXCEEDED' } },
                            ),
                        );
                    }
                }
            },
        };
    };
}

export { depthLimitRule, complexityLimitRule };

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
            import('graphql-yoga').then(({ createYoga }: any) => {
                this.yoga = createYoga({
                    schema: federatedSchema,
                    context: async ({ request }: { request: any }) =>
                        buildGraphQLContext(request as unknown as import('express').Request),
                    graphiql: process.env.NODE_ENV !== 'production',
                    graphqlEndpoint: path,
                    cors: false,
                    logging: false,
                    // #1386 — depth + complexity validation rules applied before
                    // any resolver runs; not per-resolver checks.
                    validationRules: [
                        depthLimitRule(MAX_DEPTH),
                        complexityLimitRule(MAX_COMPLEXITY),
                    ],
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
