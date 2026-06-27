import { Request, Response, NextFunction } from 'express';
import { z, ZodType, ZodError } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ValidationTarget = 'body' | 'query' | 'params' | 'headers';

export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
  headers?: ZodType;
}

export interface ValidationOptions {
  /** When true, strips unknown keys from input before passing to handler. */
  stripUnknown?: boolean;
  /** Custom error message prefix. */
  message?: string;
}

// ---------------------------------------------------------------------------
// Validation Result interface
// ---------------------------------------------------------------------------

export interface ValidationResult<T = unknown> {
  valid: boolean;
  parsed?: T;
  errors?: ValidationError[];
}

interface ValidationError {
  field: string;
  message: string;
  code: string;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Express middleware that validates request body, query, params, and/or headers
 * against Zod schemas.
 *
 * Usage:
 * ```ts
 * router.post('/users', validate({ body: createUserSchema }), handler);
 * router.get('/users/:id', validate({ params: idParamSchema }), handler);
 * ```
 */
export function validate(schemas: ValidationSchemas, options: ValidationOptions = {}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: { target: ValidationTarget; errors: ValidationError[] }[] = [];

    for (const [target, schema] of Object.entries(schemas) as [ValidationTarget, ZodType][]) {
      const input = req[target as keyof Request] as Record<string, unknown>;
      const result = schema.safeParse(input);

      if (!result.success) {
        const fieldErrors = formatZodErrors(result.error, target);
        errors.push({ target, errors: fieldErrors });
      } else if (options.stripUnknown) {
        // Replace request data with parsed data (strips unknown keys)
        (req[target as keyof Request] as Record<string, unknown>) = result.data;
      }
    }

    if (errors.length > 0) {
      const prefix = options.message ?? 'Validation failed';
      res.status(400).json({
        error: prefix,
        code: 'VALIDATION_ERROR',
        details: errors,
      });
      return;
    }

    // Update req.query to the parsed value if stripUnknown is active
    // Note: req.query is read-only in Express types, but we cast through any
    if (options.stripUnknown && schemas.query) {
      const parsed = schemas.query.parse(req.query);
      (req as any).query = parsed;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Validation helper (for non-middleware usage, e.g. service layer)
// ---------------------------------------------------------------------------

/**
 * Validate data directly against a Zod schema, returning a typed result.
 */
export function validateData<T>(schema: ZodType<T>, data: unknown): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return { valid: true, parsed: result.data };
  }

  return {
    valid: false,
    errors: formatZodErrors(result.error, 'data'),
  };
}

// ---------------------------------------------------------------------------
// Utility: parse Zod errors into field-level error array
// ---------------------------------------------------------------------------

function formatZodErrors(error: ZodError, _target: string): ValidationError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : _target,
    message: issue.message,
    code: issue.code,
  }));
}

// ---------------------------------------------------------------------------
// Common reusable schemas
// ---------------------------------------------------------------------------

export const commonSchemas = {
  /** UUID v4 validation */
  uuid: z.string().uuid('Invalid UUID format'),

  /** Pagination query params */
  pagination: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),

  /** Sort direction */
  sortOrder: z.enum(['asc', 'desc']).default('desc'),

  /** Date range filter */
  dateRange: z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  }),

  /** Wallet address (alphanumeric, 56 chars typical of Stellar) */
  walletAddress: z.string().regex(/^[A-Z0-9]{56}$/, 'Invalid wallet address format'),

  /** Match status */
  matchStatus: z.enum(['CREATED', 'STARTED', 'COMPLETED', 'DISPUTED', 'FINALIZED']).optional(),

  /** Tournament status */
  tournamentStatus: z.enum([
    'PENDING',
    'REGISTRATION_OPEN',
    'REGISTRATION_CLOSED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
  ]).optional(),

  /** Email */
  email: z.string().email('Invalid email format'),

  /** Username (3-30 chars, alphanumeric and underscores) */
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be at most 30 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
};

// ---------------------------------------------------------------------------
// Pre-built schemas for common endpoints
// ---------------------------------------------------------------------------

/** Create tournament schema */
export const createTournamentSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(2000).optional(),
  format: z.enum(['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN', 'SWISS']),
  gameId: z.string(),
  gameModeId: z.string(),
  maxPlayers: z.number().int().min(2).max(512),
  minPlayers: z.number().int().min(2).optional().default(2),
  entryFee: z.string().optional(),
  prizeDistribution: z.record(z.any()).optional(),
  registrationStart: z.string().datetime(),
  registrationEnd: z.string().datetime(),
  startDate: z.string().datetime(),
  settings: z.record(z.any()).optional(),
});

/** Update tournament schema */
export const updateTournamentSchema = z.object({
  name: z.string().min(3).max(100).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['PENDING', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  maxPlayers: z.number().int().min(2).max(512).optional(),
  prizePool: z.string().optional(),
  prizeDistribution: z.record(z.any()).optional(),
  settings: z.record(z.any()).optional(),
});

/** Create match schema */
export const createMatchSchema = z.object({
  playerAId: z.string(),
  playerBId: z.string(),
  metadata: z.record(z.any()).optional(),
});

/** Register user schema */
export const registerUserSchema = z.object({
  email: commonSchemas.email,
  username: commonSchemas.username,
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

/** Login schema */
export const loginSchema = z.object({
  email: z.string().email().optional(),
  username: z.string().optional(),
  password: z.string(),
}).refine((data) => data.email || data.username, {
  message: 'Email or username is required',
});

/** Create wallet transaction schema */
export const walletTransactionSchema = z.object({
  currency: z.enum(['XLM', 'USDC', 'AX']),
  amount: z.string().regex(/^\d+(\.\d{1,7})?$/, 'Invalid amount format'),
  type: z.enum(['CREDIT', 'DEBIT', 'ESCROW_LOCK', 'ESCROW_RELEASE', 'ESCROW_SLASH', 'PLATFORM_FEE', 'PRIZE_POOL_FUND']),
  matchId: z.string().optional(),
  note: z.string().max(500).optional(),
});