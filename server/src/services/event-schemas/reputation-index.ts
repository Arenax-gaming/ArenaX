import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { EventSchema } from '../event-parser.service.js';

function parseStruct(data: xdr.ScVal): Record<string, unknown> {
    return scValToNative(data) as Record<string, unknown>;
}

export const reputationChangedV0: EventSchema = { namespace: 'ArenaXRepIdx', version: 'v0', eventType: 'REPUTATION_CHANGED', parse: parseStruct };
export const reputationChangedV1: EventSchema = { namespace: 'ArenaXRepIdx', version: 'v1', eventType: 'REPUTATION_CHANGED', parse: parseStruct };
export const reputationDecayedV0: EventSchema = { namespace: 'ArenaXRepIdx', version: 'v0', eventType: 'REPUTATION_DECAYED', parse: parseStruct };
export const reputationDecayedV1: EventSchema = { namespace: 'ArenaXRepIdx', version: 'v1', eventType: 'REPUTATION_DECAYED', parse: parseStruct };
