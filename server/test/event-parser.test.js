const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventParserService, UnknownEventError } = require('../dist/services/event-parser.service');
const { buildV0Topics, buildV1Topics, buildEventData } = require('./helpers/event-fixtures');
const { scValToNative, nativeToScVal } = require('@stellar/stellar-sdk');

function parseStruct(data) {
    return scValToNative(data);
}

describe('EventParserService', () => {
    let parser;

    beforeEach(() => {
        parser = new EventParserService();
    });

    it('parses a v0 legacy event (2 topics, no version suffix)', () => {
        parser.register({
            namespace: 'ArenaXReputation',
            version: 'v0',
            eventType: 'REPUTATION_UPDATED',
            parse: (data) => ({ ...parseStruct(data), source: null }),
        });

        const topics = buildV0Topics('ArenaXReputation', 'REPUTATION_UPDATED');
        const data = buildEventData({ player: 'GABC', previous_score: 1000, new_score: 1025, match_id: 42, timestamp: 1700000000 });

        const result = parser.parseEvent(topics, data);
        assert.equal(result.namespace, 'ArenaXReputation');
        assert.equal(result.version, 'v0');
        assert.equal(result.eventType, 'REPUTATION_UPDATED');
        assert.equal(result.data.source, null);
    });

    it('parses a v1 versioned event (composite topic with _v1)', () => {
        parser.register({
            namespace: 'ArenaXReputation',
            version: 'v1',
            eventType: 'REPUTATION_UPDATED',
            parse: parseStruct,
        });

        const topics = buildV1Topics('ArenaXReputation', 'REPUTATION_UPDATED');
        const data = buildEventData({ player: 'GABC', previous_score: 1000, new_score: 1025, match_id: 42, timestamp: 1700000000, source: 0 });

        const result = parser.parseEvent(topics, data);
        assert.equal(result.namespace, 'ArenaXReputation');
        assert.equal(result.version, 'v1');
        assert.equal(result.eventType, 'REPUTATION_UPDATED');
        assert.equal(Number(result.data.source), 0);
    });

    it('parses mixed v0 and v1 events correctly', () => {
        parser.register({
            namespace: 'ArenaXReputation',
            version: 'v0',
            eventType: 'REPUTATION_UPDATED',
            parse: (data) => ({ ...parseStruct(data), source: null }),
        });
        parser.register({
            namespace: 'ArenaXReputation',
            version: 'v1',
            eventType: 'REPUTATION_UPDATED',
            parse: parseStruct,
        });

        const v0Result = parser.parseEvent(
            buildV0Topics('ArenaXReputation', 'REPUTATION_UPDATED'),
            buildEventData({ player: 'GABC', match_id: 42 }),
        );
        const v1Result = parser.parseEvent(
            buildV1Topics('ArenaXReputation', 'REPUTATION_UPDATED'),
            buildEventData({ player: 'GDEF', match_id: 43, source: 1 }),
        );

        assert.equal(v0Result.version, 'v0');
        assert.equal(v0Result.data.source, null);
        assert.equal(v1Result.version, 'v1');
        assert.equal(Number(v1Result.data.source), 1);
    });

    it('throws UnknownEventError for unregistered version', () => {
        const topics = buildV1Topics('ArenaXReputation', 'REPUTATION_UPDATED');

        assert.throws(
            () => parser.parseEvent(topics, buildEventData({})),
            (err) => err instanceof UnknownEventError,
        );
    });

    it('throws UnknownEventError for unregistered event type', () => {
        parser.register({
            namespace: 'ArenaXReputation',
            version: 'v1',
            eventType: 'REPUTATION_UPDATED',
            parse: parseStruct,
        });

        const topics = buildV1Topics('ArenaXReputation', 'NONEXISTENT');
        assert.throws(
            () => parser.parseEvent(topics, buildEventData({})),
            (err) => err instanceof UnknownEventError,
        );
    });

    it('throws UnknownEventError for too few topics', () => {
        assert.throws(
            () => parser.parseEvent([], buildEventData({})),
            (err) => err instanceof UnknownEventError,
        );

        assert.throws(
            () => parser.parseEvent(
                [nativeToScVal('single', { type: 'symbol' })],
                buildEventData({}),
            ),
            (err) => err instanceof UnknownEventError,
        );
    });

    it('correctly splits namespace_version in composite topics', () => {
        parser.register({
            namespace: 'ArenaXSlash',
            version: 'v1',
            eventType: 'CASE_OPEN',
            parse: parseStruct,
        });

        const topics = buildV1Topics('ArenaXSlash', 'CASE_OPEN');
        const result = parser.parseEvent(topics, buildEventData({ case_id: 'abc' }));
        assert.equal(result.namespace, 'ArenaXSlash');
        assert.equal(result.version, 'v1');
        assert.equal(result.eventType, 'CASE_OPEN');
    });
});
