import { getDatabaseClient } from './database.service';
import { logger } from './logger.service';

export interface IndexSuggestion {
  table: string;
  columns: string[];
  type: 'btree' | 'gin' | 'gist' | 'hash';
  reason: string;
  estimatedImpact: 'high' | 'medium' | 'low';
}

export interface QueryPlan {
  query: string;
  plan: Record<string, unknown>;
  analysis: string[];
  suggestions: IndexSuggestion[];
  estimatedRows: number;
  actualRows: number;
  totalCost: number;
  executionTimeMs: number;
}

export async function analyzeQuery(query: string): Promise<QueryPlan> {
  const prisma = getDatabaseClient();
  const explainQuery = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`;
  const start = Date.now();

  try {
    const result = await prisma.$queryRaw<unknown[]>`${explainQuery}`;
    const executionTimeMs = Date.now() - start;
    const planRaw = result[0] as Record<string, unknown>;
    const plan = planRaw['QUERY PLAN'] as string;
    const parsedPlan = JSON.parse(plan)[0] as Record<string, unknown>;
    const planNode = parsedPlan['Plan'] as Record<string, unknown>;

    const analysis = analyzePlanNode(planNode);
    const suggestions = generateIndexSuggestions(planNode);
    const totalCost = planNode['Total Cost'] as number || 0;
    const actualRows = planNode['Actual Rows'] as number || 0;
    const estimatedRows = planNode['Plan Rows'] as number || 0;

    return {
      query,
      plan: parsedPlan,
      analysis,
      suggestions,
      estimatedRows,
      actualRows,
      totalCost,
      executionTimeMs,
    };
  } catch (err) {
    logger.error('Query plan analysis failed', { query, error: err });
    throw err;
  }
}

function analyzePlanNode(node: Record<string, unknown>): string[] {
  const findings: string[] = [];
  const nodeType = node['Node Type'] as string;

  if (nodeType === 'Seq Scan') {
    const relation = node['Relation Name'] as string || 'unknown';
    findings.push(`⚠️ Sequential scan on "${relation}": consider adding an index if this query runs frequently`);
  }

  if (nodeType === 'Nested Loop' && ((node['Join Filter'] as string) || (node['Index Cond'] as string))) {
    findings.push(`ℹ️ Nested Loop join detected — verify join columns are indexed`);
  }

  if (nodeType === 'Hash Join' && !node['Hash Cond']) {
    findings.push(`⚠️ Hash Join without hash condition — consider reviewing join predicates`);
  }

  if (node['Sort Key']) {
    findings.push(`ℹ️ Sort operation on ${(node['Sort Key'] as string[]).join(', ')} — check if index can cover the sort order`);
  }

  if ((node['Actual Rows'] as number || 0) > 10000) {
    findings.push(`⚠️ Large row estimate (${node['Actual Rows']} rows) — consider pagination or filtering`);
  }

  if ((node['Actual Loops'] as number || 1) > 100) {
    findings.push(`⚠️ Query loops ${node['Actual Loops']} times — restructure to reduce loop count`);
  }

  if (node['Plans'] && Array.isArray(node['Plans'])) {
    for (const child of node['Plans'] as Record<string, unknown>[]) {
      findings.push(...analyzePlanNode(child));
    }
  }

  return findings;
}

function generateIndexSuggestions(node: Record<string, unknown>): IndexSuggestion[] {
  const suggestions: IndexSuggestion[] = [];
  const nodeType = node['Node Type'] as string;

  if (nodeType === 'Seq Scan') {
    const relation = node['Relation Name'] as string;
    const filter = node['Filter'] as string;
    if (relation && filter) {
      const columns = extractColumnsFromFilter(filter);
      if (columns.length > 0) {
        suggestions.push({
          table: relation,
          columns,
          type: 'btree',
          reason: `Sequential scan on "${relation}" with filter: ${filter}`,
          estimatedImpact: 'high',
        });
      }
    }
  }

  if (node['Plans'] && Array.isArray(node['Plans'])) {
    for (const child of node['Plans'] as Record<string, unknown>[]) {
      suggestions.push(...generateIndexSuggestions(child));
    }
  }

  return suggestions;
}

function extractColumnsFromFilter(filter: string): string[] {
  const cols: string[] = [];
  const patterns = filter.match(/(\w+)\.(\w+)/g);
  if (patterns) {
    for (const p of patterns) {
      const col = p.split('.')[1];
      if (col && !cols.includes(col)) cols.push(col);
    }
  }
  return cols;
}

export async function getRecommendedIndexes(): Promise<IndexSuggestion[]> {
  const prisma = getDatabaseClient();
  try {
    const result = await prisma.$queryRaw<unknown[]>`
      SELECT
        schemaname,
        tablename,
        seq_scan,
        seq_tup_read,
        idx_scan,
        n_tup_ins,
        n_tup_upd,
        n_tup_del
      FROM pg_stat_user_tables
      WHERE seq_scan > 100 AND seq_tup_read > 10000
      ORDER BY seq_scan DESC
      LIMIT 20
    `;
    return (result as Record<string, unknown>[]).map((row) => ({
      table: `${row.schemaname}.${row.tablename}`,
      columns: [],
      type: 'btree' as const,
      reason: `Table "${row.tablename}" has high sequential scan count (${row.seq_scan}), ${row.seq_tup_read} tuples read`,
      estimatedImpact: 'medium' as const,
    }));
  } catch (err) {
    logger.warn('Failed to get index recommendations from pg_stat_user_tables', { error: err });
    return [];
  }
}
