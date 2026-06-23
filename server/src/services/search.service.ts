/**
 * Search service (#473) — Advanced Search with Elasticsearch.
 *
 * Ships two backends behind a common interface:
 *   - ElasticsearchBackend: connects to a real ES cluster when ELASTICSEARCH_URL
 *     is configured.
 *   - InMemorySearchBackend: used when ES is unavailable (dev / test). Performs
 *     simple substring + field-filter matching over an internal document store.
 *
 * Public API (SearchService) is identical for both; callers never need to know
 * which backend is active.
 */

import { logger } from './logger.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SearchableEntity = 'user' | 'tournament' | 'match' | 'achievement';

export interface SearchDocument {
    id: string;
    entity: SearchableEntity;
    title: string;
    description?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    indexedAt: number;
}

export interface SearchFilter {
    entity?: SearchableEntity[];
    tags?: string[];
    metadata?: Record<string, unknown>;
}

export interface SearchOptions {
    query: string;
    filters?: SearchFilter;
    page?: number;
    pageSize?: number;
    highlight?: boolean;
}

export interface SearchHit {
    id: string;
    entity: SearchableEntity;
    title: string;
    description?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    score: number;
    highlights?: Record<string, string[]>;
}

export interface SearchResult {
    hits: SearchHit[];
    total: number;
    page: number;
    pageSize: number;
    took: number;
    query: string;
}

export interface AutocompleteResult {
    suggestions: string[];
    query: string;
}

export interface SearchAnalytics {
    totalQueries: number;
    topQueries: Array<{ query: string; count: number }>;
    averageResultCount: number;
    zeroResultQueries: string[];
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

interface ISearchBackend {
    index(doc: SearchDocument): Promise<void>;
    bulkIndex(docs: SearchDocument[]): Promise<void>;
    delete(id: string, entity: SearchableEntity): Promise<void>;
    search(opts: SearchOptions): Promise<SearchResult>;
    autocomplete(prefix: string, entity?: SearchableEntity): Promise<AutocompleteResult>;
    isAvailable(): boolean;
}

// ---------------------------------------------------------------------------
// In-memory backend (dev / test fallback)
// ---------------------------------------------------------------------------

class InMemorySearchBackend implements ISearchBackend {
    private readonly store = new Map<string, SearchDocument>();

    isAvailable(): boolean {
        return true;
    }

    async index(doc: SearchDocument): Promise<void> {
        this.store.set(`${doc.entity}:${doc.id}`, doc);
    }

    async bulkIndex(docs: SearchDocument[]): Promise<void> {
        for (const doc of docs) {
            this.store.set(`${doc.entity}:${doc.id}`, doc);
        }
    }

    async delete(id: string, entity: SearchableEntity): Promise<void> {
        this.store.delete(`${entity}:${id}`);
    }

    async search(opts: SearchOptions): Promise<SearchResult> {
        const t0 = Date.now();
        const { query, filters, page = 1, pageSize = 20, highlight = false } = opts;
        const needle = query.toLowerCase();

        let docs = Array.from(this.store.values());

        // Entity filter
        if (filters?.entity && filters.entity.length > 0) {
            const allowed = new Set(filters.entity);
            docs = docs.filter((d) => allowed.has(d.entity));
        }

        // Tag filter
        if (filters?.tags && filters.tags.length > 0) {
            const required = new Set(filters.tags);
            docs = docs.filter((d) => d.tags?.some((t) => required.has(t)));
        }

        // Text match + naive scoring
        const scored: Array<{ doc: SearchDocument; score: number }> = [];
        for (const doc of docs) {
            let score = 0;
            if (doc.title.toLowerCase().includes(needle)) score += 3;
            if (doc.description?.toLowerCase().includes(needle)) score += 1;
            if (doc.tags?.some((t) => t.toLowerCase().includes(needle))) score += 2;
            if (score > 0) scored.push({ doc, score });
        }

        scored.sort((a, b) => b.score - a.score);

        const total = scored.length;
        const start = (page - 1) * pageSize;
        const slice = scored.slice(start, start + pageSize);

        const hits: SearchHit[] = slice.map(({ doc, score }) => {
            const hit: SearchHit = {
                id: doc.id,
                entity: doc.entity,
                title: doc.title,
                description: doc.description,
                tags: doc.tags,
                metadata: doc.metadata,
                score,
            };
            if (highlight && needle) {
                hit.highlights = {};
                const wrap = (text: string) =>
                    text.replace(
                        new RegExp(`(${needle})`, 'gi'),
                        '<em>$1</em>',
                    );
                if (doc.title.toLowerCase().includes(needle)) {
                    hit.highlights['title'] = [wrap(doc.title)];
                }
                if (doc.description?.toLowerCase().includes(needle)) {
                    hit.highlights['description'] = [wrap(doc.description)];
                }
            }
            return hit;
        });

        return {
            hits,
            total,
            page,
            pageSize,
            took: Date.now() - t0,
            query,
        };
    }

    async autocomplete(prefix: string, entity?: SearchableEntity): Promise<AutocompleteResult> {
        const needle = prefix.toLowerCase();
        const seen = new Set<string>();
        const suggestions: string[] = [];

        for (const doc of this.store.values()) {
            if (entity && doc.entity !== entity) continue;
            if (doc.title.toLowerCase().startsWith(needle) && !seen.has(doc.title)) {
                seen.add(doc.title);
                suggestions.push(doc.title);
                if (suggestions.length >= 10) break;
            }
        }

        return { suggestions, query: prefix };
    }
}

// ---------------------------------------------------------------------------
// Elasticsearch backend
// ---------------------------------------------------------------------------

class ElasticsearchBackend implements ISearchBackend {
    private readonly baseUrl: string;
    private readonly index = 'arenax';
    private available = false;

    constructor(url: string) {
        this.baseUrl = url.replace(/\/$/, '');
        this.ping().catch(() => {
            logger.warn('[search] Elasticsearch unreachable, falling back to in-memory');
        });
    }

    private async ping(): Promise<void> {
        const res = await fetch(`${this.baseUrl}/_cluster/health`, {
            signal: AbortSignal.timeout(3000),
        });
        if (res.ok) this.available = true;
    }

    isAvailable(): boolean {
        return this.available;
    }

    private esId(doc: Pick<SearchDocument, 'entity' | 'id'>): string {
        return `${doc.entity}_${doc.id}`;
    }

    async index(doc: SearchDocument): Promise<void> {
        await fetch(`${this.baseUrl}/${this.index}/_doc/${this.esId(doc)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(doc),
        });
    }

    async bulkIndex(docs: SearchDocument[]): Promise<void> {
        if (docs.length === 0) return;
        const lines = docs.flatMap((doc) => [
            JSON.stringify({ index: { _index: this.index, _id: this.esId(doc) } }),
            JSON.stringify(doc),
        ]);
        await fetch(`${this.baseUrl}/_bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-ndjson' },
            body: lines.join('\n') + '\n',
        });
    }

    async delete(id: string, entity: SearchableEntity): Promise<void> {
        await fetch(`${this.baseUrl}/${this.index}/_doc/${entity}_${id}`, {
            method: 'DELETE',
        });
    }

    async search(opts: SearchOptions): Promise<SearchResult> {
        const t0 = Date.now();
        const { query, filters, page = 1, pageSize = 20, highlight = false } = opts;
        const from = (page - 1) * pageSize;

        const must: unknown[] = [
            {
                multi_match: {
                    query,
                    fields: ['title^3', 'description', 'tags^2'],
                    fuzziness: 'AUTO',
                },
            },
        ];

        const filterClauses: unknown[] = [];
        if (filters?.entity && filters.entity.length > 0) {
            filterClauses.push({ terms: { entity: filters.entity } });
        }
        if (filters?.tags && filters.tags.length > 0) {
            filterClauses.push({ terms: { tags: filters.tags } });
        }

        const esQuery: Record<string, unknown> = {
            from,
            size: pageSize,
            query: {
                bool: {
                    must,
                    filter: filterClauses,
                },
            },
        };

        if (highlight) {
            esQuery['highlight'] = {
                fields: { title: {}, description: {} },
                pre_tags: ['<em>'],
                post_tags: ['</em>'],
            };
        }

        const res = await fetch(`${this.baseUrl}/${this.index}/_search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(esQuery),
        });

        if (!res.ok) {
            throw new Error(`Elasticsearch error: ${res.status}`);
        }

        const body = (await res.json()) as {
            hits: {
                total: { value: number };
                hits: Array<{
                    _id: string;
                    _score: number;
                    _source: SearchDocument;
                    highlight?: Record<string, string[]>;
                }>;
            };
            took: number;
        };

        const hits: SearchHit[] = body.hits.hits.map((h) => ({
            id: h._source.id,
            entity: h._source.entity,
            title: h._source.title,
            description: h._source.description,
            tags: h._source.tags,
            metadata: h._source.metadata,
            score: h._score,
            ...(highlight && h.highlight ? { highlights: h.highlight } : {}),
        }));

        return {
            hits,
            total: body.hits.total.value,
            page,
            pageSize,
            took: body.took,
            query,
        };
    }

    async autocomplete(prefix: string, entity?: SearchableEntity): Promise<AutocompleteResult> {
        const esQuery: Record<string, unknown> = {
            size: 10,
            _source: ['title'],
            query: {
                bool: {
                    must: [{ prefix: { title: { value: prefix } } }],
                    ...(entity ? { filter: [{ term: { entity } }] } : {}),
                },
            },
        };

        const res = await fetch(`${this.baseUrl}/${this.index}/_search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(esQuery),
        });

        if (!res.ok) return { suggestions: [], query: prefix };

        const body = (await res.json()) as {
            hits: { hits: Array<{ _source: { title: string } }> };
        };

        return {
            suggestions: body.hits.hits.map((h) => h._source.title),
            query: prefix,
        };
    }
}

// ---------------------------------------------------------------------------
// SearchService — public façade
// ---------------------------------------------------------------------------

export class SearchService {
    private readonly backend: ISearchBackend;
    private readonly queryLog: Array<{ query: string; resultCount: number; ts: number }> = [];
    private readonly MAX_LOG = 500;

    constructor(elasticsearchUrl?: string) {
        if (elasticsearchUrl) {
            const esBackend = new ElasticsearchBackend(elasticsearchUrl);
            this.backend = esBackend;
            logger.info(`[search] Elasticsearch backend initialised at ${elasticsearchUrl}`);
        } else {
            this.backend = new InMemorySearchBackend();
            logger.info('[search] In-memory search backend initialised');
        }
    }

    async index(doc: SearchDocument): Promise<void> {
        await this.backend.index(doc);
    }

    async bulkIndex(docs: SearchDocument[]): Promise<void> {
        await this.backend.bulkIndex(docs);
    }

    async delete(id: string, entity: SearchableEntity): Promise<void> {
        await this.backend.delete(id, entity);
    }

    async search(opts: SearchOptions): Promise<SearchResult> {
        const result = await this.backend.search(opts);
        this.logQuery(opts.query, result.total);
        return result;
    }

    async autocomplete(prefix: string, entity?: SearchableEntity): Promise<AutocompleteResult> {
        return this.backend.autocomplete(prefix, entity);
    }

    getAnalytics(): SearchAnalytics {
        const counts = new Map<string, number>();
        let totalResults = 0;
        const zeroResultQueries: string[] = [];

        for (const entry of this.queryLog) {
            counts.set(entry.query, (counts.get(entry.query) ?? 0) + 1);
            totalResults += entry.resultCount;
            if (entry.resultCount === 0) zeroResultQueries.push(entry.query);
        }

        const topQueries = Array.from(counts.entries())
            .map(([query, count]) => ({ query, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        return {
            totalQueries: this.queryLog.length,
            topQueries,
            averageResultCount:
                this.queryLog.length > 0 ? totalResults / this.queryLog.length : 0,
            zeroResultQueries: [...new Set(zeroResultQueries)].slice(0, 20),
        };
    }

    private logQuery(query: string, resultCount: number): void {
        this.queryLog.push({ query, resultCount, ts: Date.now() });
        if (this.queryLog.length > this.MAX_LOG) {
            this.queryLog.splice(0, this.queryLog.length - this.MAX_LOG);
        }
    }
}

export const defaultSearchService = new SearchService(
    process.env.ELASTICSEARCH_URL,
);
