import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { EventSchema } from '../event-parser.service.js';

function parseStruct(data: xdr.ScVal): Record<string, unknown> {
    return scValToNative(data) as Record<string, unknown>;
}

export const dispOpenedV0: EventSchema = { namespace: 'ArenaXDisp', version: 'v0', eventType: 'OPENED', parse: parseStruct };
export const dispOpenedV1: EventSchema = { namespace: 'ArenaXDisp', version: 'v1', eventType: 'OPENED', parse: parseStruct };
export const dispResolvedV0: EventSchema = { namespace: 'ArenaXDisp', version: 'v0', eventType: 'RESOLVED', parse: parseStruct };
export const dispResolvedV1: EventSchema = { namespace: 'ArenaXDisp', version: 'v1', eventType: 'RESOLVED', parse: parseStruct };
