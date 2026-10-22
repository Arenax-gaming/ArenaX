import { Router, Request, Response, NextFunction } from 'express';
import { ApiGatewayService, apiGatewayService } from '../services/api-gateway.service';
import { TournamentService, MatchResult } from '../services/tournament.service';
import {
  createApiKeyAuth,
  apiKeyRateLimiter,
  requireApiScopes,
  trackApiUsage,
} from '../middleware/api-gateway.middleware';
import { HttpError } from '../utils/http-error';

/**
 * Third-party API authenticated with scoped API keys (#1420).
 *
 * Every route declares the scope it needs; keys without it get 403.
 */
export interface PublicApiDeps {
  gateway: ApiGatewayService;
  tournaments: {
    listTournaments(filters: { page?: number; limit?: number }): Promise<unknown>;
    getTournament(tournamentId: string): Promise<unknown | null>;
    handleMatchResult(tournamentId: string, matchId: string, result: MatchResult): Promise<unknown>;
  };
}

const RESULT_TYPES: ReadonlyArray<MatchResult['resultType']> = ['WIN', 'LOSS', 'DRAW', 'DISQUALIFIED'];

function parseMatchResult(matchId: string, body: unknown): MatchResult {
  const b = (body ?? {}) as Partial<MatchResult>;
  if (
    typeof b.playerAScore !== 'number' ||
    typeof b.playerBScore !== 'number' ||
    typeof b.winnerId !== 'string' ||
    !RESULT_TYPES.includes(b.resultType as MatchResult['resultType'])
  ) {
    throw new HttpError(400, 'playerAScore, playerBScore, winnerId and a valid resultType are required');
  }
  return {
    matchId,
    playerAScore: b.playerAScore,
    playerBScore: b.playerBScore,
    winnerId: b.winnerId,
    resultType: b.resultType as MatchResult['resultType'],
  };
}

export function createPublicApiRouter(deps: PublicApiDeps): Router {
  const router: Router = Router();

  router.use(createApiKeyAuth(deps.gateway), apiKeyRateLimiter, trackApiUsage);

  router.get(
    '/tournaments',
    requireApiScopes('read:tournaments'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const page = req.query.page ? Number(req.query.page) : undefined;
        const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : undefined;
        res.json(await deps.tournaments.listTournaments({ page, limit }));
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/tournaments/:id',
    requireApiScopes('read:tournaments'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tournament = await deps.tournaments.getTournament(req.params.id);
        if (!tournament) {
          throw new HttpError(404, 'Tournament not found');
        }
        res.json({ tournament });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/tournaments/:tournamentId/matches/:matchId/results',
    requireApiScopes('write:results'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { tournamentId, matchId } = req.params;
        const result = parseMatchResult(matchId, req.body);
        const outcome = await deps.tournaments.handleMatchResult(tournamentId, matchId, result);
        res.status(201).json({ result: outcome });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

export default createPublicApiRouter({
  gateway: apiGatewayService,
  tournaments: new TournamentService(),
});
