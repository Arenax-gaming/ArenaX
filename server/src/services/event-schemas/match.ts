import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { EventSchema } from '../event-parser.service.js';

function parseStruct(data: xdr.ScVal): Record<string, unknown> {
    return scValToNative(data) as Record<string, unknown>;
}

// ArenaXMatch events
export const matchCreatedV0: EventSchema = { namespace: 'ArenaXMatch', version: 'v0', eventType: 'CREATED', parse: parseStruct };
export const matchCreatedV1: EventSchema = { namespace: 'ArenaXMatch', version: 'v1', eventType: 'CREATED', parse: parseStruct };
export const matchStartedV0: EventSchema = { namespace: 'ArenaXMatch', version: 'v0', eventType: 'STARTED', parse: parseStruct };
export const matchStartedV1: EventSchema = { namespace: 'ArenaXMatch', version: 'v1', eventType: 'STARTED', parse: parseStruct };
export const matchCompletedV0: EventSchema = { namespace: 'ArenaXMatch', version: 'v0', eventType: 'COMPLETED', parse: parseStruct };
export const matchCompletedV1: EventSchema = { namespace: 'ArenaXMatch', version: 'v1', eventType: 'COMPLETED', parse: parseStruct };
export const matchDisputedV0: EventSchema = { namespace: 'ArenaXMatch', version: 'v0', eventType: 'DISPUTED', parse: parseStruct };
export const matchDisputedV1: EventSchema = { namespace: 'ArenaXMatch', version: 'v1', eventType: 'DISPUTED', parse: parseStruct };
export const matchCancelledV0: EventSchema = { namespace: 'ArenaXMatch', version: 'v0', eventType: 'CANCELLED', parse: parseStruct };
export const matchCancelledV1: EventSchema = { namespace: 'ArenaXMatch', version: 'v1', eventType: 'CANCELLED', parse: parseStruct };
export const matchResolvedV0: EventSchema = { namespace: 'ArenaXMatch', version: 'v0', eventType: 'RESOLVED', parse: parseStruct };
export const matchResolvedV1: EventSchema = { namespace: 'ArenaXMatch', version: 'v1', eventType: 'RESOLVED', parse: parseStruct };

// ArenaXMLf (match-lifecycle) events
export const mlfCreatedV0: EventSchema = { namespace: 'ArenaXMLf', version: 'v0', eventType: 'CREATED', parse: parseStruct };
export const mlfCreatedV1: EventSchema = { namespace: 'ArenaXMLf', version: 'v1', eventType: 'CREATED', parse: parseStruct };
export const mlfResultV0: EventSchema = { namespace: 'ArenaXMLf', version: 'v0', eventType: 'RESULT', parse: parseStruct };
export const mlfResultV1: EventSchema = { namespace: 'ArenaXMLf', version: 'v1', eventType: 'RESULT', parse: parseStruct };
export const mlfFinalizedV0: EventSchema = { namespace: 'ArenaXMLf', version: 'v0', eventType: 'FINALIZED', parse: parseStruct };
export const mlfFinalizedV1: EventSchema = { namespace: 'ArenaXMLf', version: 'v1', eventType: 'FINALIZED', parse: parseStruct };
