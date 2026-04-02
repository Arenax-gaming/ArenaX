import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { EventSchema } from '../event-parser.service.js';

function parseStruct(data: xdr.ScVal): Record<string, unknown> {
    return scValToNative(data) as Record<string, unknown>;
}

// v0 parser for ReputationUpdated: legacy format without 'source' field
export const reputationUpdatedV0: EventSchema = {
    namespace: 'ArenaXReputation',
    version: 'v0',
    eventType: 'REPUTATION_UPDATED',
    parse: (data: xdr.ScVal) => {
        const parsed = parseStruct(data);
        return { ...parsed, source: null };
    },
};

// v1 parser for ReputationUpdated: includes 'source' field
export const reputationUpdatedV1: EventSchema = {
    namespace: 'ArenaXReputation',
    version: 'v1',
    eventType: 'REPUTATION_UPDATED',
    parse: parseStruct,
};

// Events with identical v0/v1 schemas share the same parser
export const reputationInitV0: EventSchema = { namespace: 'ArenaXReputation', version: 'v0', eventType: 'INIT', parse: parseStruct };
export const reputationInitV1: EventSchema = { namespace: 'ArenaXReputation', version: 'v1', eventType: 'INIT', parse: parseStruct };
export const authorizerAddedV0: EventSchema = { namespace: 'ArenaXReputation', version: 'v0', eventType: 'AUTHORIZER_ADDED', parse: parseStruct };
export const authorizerAddedV1: EventSchema = { namespace: 'ArenaXReputation', version: 'v1', eventType: 'AUTHORIZER_ADDED', parse: parseStruct };
export const authorizerRemovedV0: EventSchema = { namespace: 'ArenaXReputation', version: 'v0', eventType: 'AUTHORIZER_REMOVED', parse: parseStruct };
export const authorizerRemovedV1: EventSchema = { namespace: 'ArenaXReputation', version: 'v1', eventType: 'AUTHORIZER_REMOVED', parse: parseStruct };
export const matchRecordedV0: EventSchema = { namespace: 'ArenaXReputation', version: 'v0', eventType: 'MATCH_RECORDED', parse: parseStruct };
export const matchRecordedV1: EventSchema = { namespace: 'ArenaXReputation', version: 'v1', eventType: 'MATCH_RECORDED', parse: parseStruct };
