import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { EventSchema } from '../event-parser.service.js';

function parseStruct(data: xdr.ScVal): Record<string, unknown> {
    return scValToNative(data) as Record<string, unknown>;
}

export const acFlagV0: EventSchema = { namespace: 'ArenaXAC', version: 'v0', eventType: 'FLAG', parse: parseStruct };
export const acFlagV1: EventSchema = { namespace: 'ArenaXAC', version: 'v1', eventType: 'FLAG', parse: parseStruct };
