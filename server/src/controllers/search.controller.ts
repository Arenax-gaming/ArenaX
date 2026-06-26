/**
 * Search controller (#473) — validates HTTP input, calls SearchService.
 */

import { Request, Response, NextFunction } from 'express';
import { defaultSearchService, SearchableEntity } from '../services/search.service';

const VALID_ENTITIES = new Set<SearchableEntity>(['user', 'tournament', 'match', 'achievement']);

const parseEntities = (raw: unknown): SearchableEntity[] | undefined => {
    if (!raw) return undefined;
    const arr = Array.isArray(raw) ? raw : String(raw).split(',');
    const filtered = arr.filter((e) => VALID_ENTITIES.has(e as SearchableEntity)) as SearchableEntity[];
    return filtered.length > 0 ? filtered : undefined;
};

export class SearchController {
    constructor(private readonly svc = defaultSearchService) {}

    /**
     * GET /v1/search?q=&entity=&tags=&page=&pageSize=&highlight=
     */
    async search(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const query = String(req.query['q'] ?? '').trim();
            if (!query) {
                res.status(400).json({ error: 'q is required' });
                return;
            }

            const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1);
            const pageSize = Math.min(
                100,
                Math.max(1, parseInt(String(req.query['pageSize'] ?? '20'), 10) || 20),
            );
            const highlight = req.query['highlight'] === 'true';
            const entities = parseEntities(req.query['entity']);
            const tags = req.query['tags']
                ? String(req.query['tags']).split(',').filter(Boolean)
                : undefined;

            const result = await this.svc.search({
                query,
                filters: { entity: entities, tags },
                page,
                pageSize,
                highlight,
            });

            res.status(200).json(result);
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /v1/search/autocomplete?q=&entity=
     */
    async autocomplete(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const prefix = String(req.query['q'] ?? '').trim();
            if (!prefix) {
                res.status(400).json({ error: 'q is required' });
                return;
            }
            const entity = parseEntities(req.query['entity'])?.[0];
            const result = await this.svc.autocomplete(prefix, entity);
            res.status(200).json(result);
        } catch (err) {
            next(err);
        }
    }

    /**
     * POST /v1/search/index — index or reindex a document.
     * Admin-only; guarded at route level.
     */
    async indexDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { id, entity, title, description, tags, metadata } = req.body ?? {};
            if (!id || !entity || !title) {
                res.status(400).json({ error: 'id, entity, and title are required' });
                return;
            }
            if (!VALID_ENTITIES.has(entity)) {
                res.status(400).json({ error: `entity must be one of: ${[...VALID_ENTITIES].join(', ')}` });
                return;
            }
            await this.svc.index({
                id: String(id),
                entity: entity as SearchableEntity,
                title: String(title),
                description: description ? String(description) : undefined,
                tags: Array.isArray(tags) ? tags.map(String) : undefined,
                metadata: typeof metadata === 'object' && metadata !== null ? metadata : undefined,
                indexedAt: Date.now(),
            });
            res.status(201).json({ ok: true });
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /v1/search/analytics — query analytics for admins.
     */
    async getAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            res.status(200).json(this.svc.getAnalytics());
        } catch (err) {
            next(err);
        }
    }
}

export default new SearchController();
