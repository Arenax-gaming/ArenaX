/**
 * Issue #1386 — GraphQL depth + complexity limiting tests
 *
 * Submits maliciously deep / complex queries and asserts they are
 * rejected by the validation rules before any resolver runs.
 */

import { validate, buildSchema, parse } from 'graphql';
import { depthLimitRule, complexityLimitRule } from '../src/graphql/server';

// ── Test schema ───────────────────────────────────────────────────────────────
// Enough nesting to exercise both rules.
const testSchema = buildSchema(`
    type Query {
        a: A
    }
    type A { b: B value: String }
    type B { c: C value: String }
    type C { d: D value: String }
    type D { e: E value: String }
    type E { f: F value: String }
    type F { g: G value: String }
    type G { h: H value: String }
    type H { value: String }
`);

// ── Depth tests ───────────────────────────────────────────────────────────────

describe('#1386 depthLimitRule', () => {
    const MAX = 7;

    it('accepts a query within the depth limit', () => {
        // a→b→c→d→e→f→g = 7 levels
        const doc = parse(`{ a { b { c { d { e { f { g { value } } } } } } } }`);
        const errors = validate(testSchema, doc, [depthLimitRule(MAX)]);
        expect(errors).toHaveLength(0);
    });

    it('rejects a query that exceeds the depth limit', () => {
        // a→b→c→d→e→f→g→h = 8 levels
        const doc = parse(`{ a { b { c { d { e { f { g { h { value } } } } } } } } }`);
        const errors = validate(testSchema, doc, [depthLimitRule(MAX)]);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].message).toMatch(/depth/i);
        expect(errors[0].message).toMatch(/8/);
    });

    it('respects a custom max depth', () => {
        const doc = parse(`{ a { b { value } } }`);
        // depth = 3; max = 2 → should fail
        const errors = validate(testSchema, doc, [depthLimitRule(2)]);
        expect(errors.length).toBeGreaterThan(0);
    });
});

// ── Complexity tests ──────────────────────────────────────────────────────────

describe('#1386 complexityLimitRule', () => {
    it('accepts a simple query within the budget', () => {
        const doc = parse(`{ a { value } }`);
        // 2 fields × weight 1 = complexity 2; budget 100 → pass
        const errors = validate(testSchema, doc, [complexityLimitRule(100)]);
        expect(errors).toHaveLength(0);
    });

    it('rejects a deeply nested query that blows the budget', () => {
        // a+b+c+d+e+f+g+h + value = many fields; budget 5 → fail
        const doc = parse(`{ a { b { c { d { e { f { g { h { value } } } } } } } } }`);
        const errors = validate(testSchema, doc, [complexityLimitRule(5)]);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].message).toMatch(/complexity/i);
    });

    it('applies custom field weights', () => {
        // "a" costs 100 → instantly over budget of 50
        const doc = parse(`{ a { value } }`);
        const errors = validate(testSchema, doc, [complexityLimitRule(50, { a: 100 })]);
        expect(errors.length).toBeGreaterThan(0);
    });

    it('combines depth + complexity rules — both enforced independently', () => {
        const deep = parse(`{ a { b { c { d { e { f { g { h { value } } } } } } } } }`);
        const depthErrors = validate(testSchema, deep, [depthLimitRule(7)]);
        const complexityErrors = validate(testSchema, deep, [complexityLimitRule(5)]);
        // Both rules independently flag this query.
        expect(depthErrors.length).toBeGreaterThan(0);
        expect(complexityErrors.length).toBeGreaterThan(0);
    });
});
