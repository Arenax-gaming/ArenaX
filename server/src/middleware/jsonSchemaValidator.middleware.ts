import { Request, Response, NextFunction } from 'express';

// Minimal JSON Schema subset supported:
// type, properties, required, additionalProperties, minLength, maxLength,
// minimum, maximum, pattern, enum, items (for arrays), nullable.

type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  enum?: unknown[];
  items?: JsonSchema;
  nullable?: boolean;
  description?: string;
}

interface ValidationError {
  path: string;
  message: string;
}

// ── Schema registry ───────────────────────────────────────────────────────────

const _schemaRegistry = new Map<string, JsonSchema>();

export function registerSchema(name: string, schema: JsonSchema): void {
  _schemaRegistry.set(name, schema);
}

export function getSchema(name: string): JsonSchema | undefined {
  return _schemaRegistry.get(name);
}

// ── Core validator ────────────────────────────────────────────────────────────

function validateValue(value: unknown, schema: JsonSchema, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  // Nullable shortcut
  if (value === null || value === undefined) {
    if (schema.nullable) return [];
    const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
    if (types.includes('null')) return [];
    errors.push({ path, message: `Value is required` });
    return errors;
  }

  // Type check
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length > 0) {
    const actualType = Array.isArray(value) ? 'array' : typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value;
    const matches = types.some((t) => {
      if (t === 'integer') return Number.isInteger(value);
      if (t === 'number') return typeof value === 'number';
      if (t === 'array') return Array.isArray(value);
      if (t === 'null') return value === null;
      return typeof value === t;
    });
    if (!matches) {
      errors.push({ path, message: `Expected type ${types.join('|')} but got ${actualType}` });
      return errors; // further checks are meaningless with wrong type
    }
  }

  // String constraints
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path, message: `Must be at least ${schema.minLength} characters` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path, message: `Must be at most ${schema.maxLength} characters` });
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path, message: `Must match pattern ${schema.pattern}` });
    }
  }

  // Numeric constraints
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, message: `Must be >= ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, message: `Must be <= ${schema.maximum}` });
    }
  }

  // Enum
  if (schema.enum !== undefined) {
    if (!schema.enum.includes(value)) {
      errors.push({ path, message: `Must be one of: ${schema.enum.map(String).join(', ')}` });
    }
  }

  // Object
  if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
    const obj = value as Record<string, unknown>;

    // Required properties
    for (const key of schema.required ?? []) {
      if (!(key in obj) || obj[key] === undefined || obj[key] === null) {
        errors.push({ path: path ? `${path}.${key}` : key, message: 'Required field is missing' });
      }
    }

    // Property schemas
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (key in obj) {
        errors.push(...validateValue(obj[key], propSchema, path ? `${path}.${key}` : key));
      }
    }

    // Additional properties
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(obj)) {
        if (!(key in schema.properties)) {
          errors.push({ path: path ? `${path}.${key}` : key, message: 'Additional property not allowed' });
        }
      }
    }
  }

  // Array
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      errors.push(...validateValue(value[i], schema.items, `${path}[${i}]`));
    }
  }

  return errors;
}

// ── Middleware factory ────────────────────────────────────────────────────────

/**
 * Returns an Express middleware that validates `req.body` against `schema`.
 * On failure, responds 400 with a structured error listing all violations.
 *
 * Usage:
 *   router.post('/match', validateBody(matchCreateSchema), matchController.create)
 */
export function validateBody(schema: JsonSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors = validateValue(req.body, schema, '');
    if (errors.length > 0) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'SCHEMA_VALIDATION_FAILED',
        details: errors,
      });
      return;
    }
    next();
  };
}

/**
 * Same as validateBody but for query string parameters.
 */
export function validateQuery(schema: JsonSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors = validateValue(req.query, schema, '');
    if (errors.length > 0) {
      res.status(400).json({
        error: 'Query validation failed',
        code: 'SCHEMA_VALIDATION_FAILED',
        details: errors,
      });
      return;
    }
    next();
  };
}

/**
 * Middleware that validates req.body against a named schema from the registry.
 * Throws at middleware setup time if the schema name is not registered.
 */
export function validateBodyByName(schemaName: string) {
  const schema = _schemaRegistry.get(schemaName);
  if (!schema) throw new Error(`Schema "${schemaName}" not found in registry`);
  return validateBody(schema);
}

// ── Pre-registered ArenaX schemas ────────────────────────────────────────────

registerSchema('CreateMatchRequest', {
  type: 'object',
  required: ['gameType', 'maxPlayers'],
  additionalProperties: false,
  properties: {
    gameType: { type: 'string', enum: ['ranked', 'casual', 'tournament'] },
    maxPlayers: { type: 'integer', minimum: 2, maximum: 100 },
    entryFeeUsdc: { type: 'number', minimum: 0, maximum: 10000, nullable: true },
    title: { type: 'string', maxLength: 100, nullable: true },
  },
});

registerSchema('JoinMatchRequest', {
  type: 'object',
  required: ['matchId'],
  additionalProperties: false,
  properties: {
    matchId: { type: 'string', minLength: 1, maxLength: 64 },
  },
});

registerSchema('SubmitScoreRequest', {
  type: 'object',
  required: ['matchId', 'score'],
  additionalProperties: false,
  properties: {
    matchId: { type: 'string', minLength: 1, maxLength: 64 },
    score: { type: 'integer', minimum: 0 },
    evidenceUri: { type: 'string', maxLength: 512, nullable: true },
  },
});
