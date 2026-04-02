import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { EventSchema } from '../event-parser.service.js';

function parseStruct(data: xdr.ScVal): Record<string, unknown> {
    return scValToNative(data) as Record<string, unknown>;
}

export const slashInitV0: EventSchema = { namespace: 'ArenaXSlash', version: 'v0', eventType: 'INIT', parse: parseStruct };
export const slashInitV1: EventSchema = { namespace: 'ArenaXSlash', version: 'v1', eventType: 'INIT', parse: parseStruct };
export const slashIdSetV0: EventSchema = { namespace: 'ArenaXSlash', version: 'v0', eventType: 'ID_SET', parse: parseStruct };
export const slashIdSetV1: EventSchema = { namespace: 'ArenaXSlash', version: 'v1', eventType: 'ID_SET', parse: parseStruct };
export const slashEscSetV0: EventSchema = { namespace: 'ArenaXSlash', version: 'v0', eventType: 'ESC_SET', parse: parseStruct };
export const slashEscSetV1: EventSchema = { namespace: 'ArenaXSlash', version: 'v1', eventType: 'ESC_SET', parse: parseStruct };
export const slashCaseOpenV0: EventSchema = { namespace: 'ArenaXSlash', version: 'v0', eventType: 'CASE_OPEN', parse: parseStruct };
export const slashCaseOpenV1: EventSchema = { namespace: 'ArenaXSlash', version: 'v1', eventType: 'CASE_OPEN', parse: parseStruct };
export const slashApprovedV0: EventSchema = { namespace: 'ArenaXSlash', version: 'v0', eventType: 'APPROVED', parse: parseStruct };
export const slashApprovedV1: EventSchema = { namespace: 'ArenaXSlash', version: 'v1', eventType: 'APPROVED', parse: parseStruct };
export const slashExecutedV0: EventSchema = { namespace: 'ArenaXSlash', version: 'v0', eventType: 'EXECUTED', parse: parseStruct };
export const slashExecutedV1: EventSchema = { namespace: 'ArenaXSlash', version: 'v1', eventType: 'EXECUTED', parse: parseStruct };
export const slashCanceledV0: EventSchema = { namespace: 'ArenaXSlash', version: 'v0', eventType: 'CANCELED', parse: parseStruct };
export const slashCanceledV1: EventSchema = { namespace: 'ArenaXSlash', version: 'v1', eventType: 'CANCELED', parse: parseStruct };
export const slashSlashedV0: EventSchema = { namespace: 'ArenaXSlash', version: 'v0', eventType: 'SLASHED', parse: parseStruct };
export const slashSlashedV1: EventSchema = { namespace: 'ArenaXSlash', version: 'v1', eventType: 'SLASHED', parse: parseStruct };
export const slashConfisctV0: EventSchema = { namespace: 'ArenaXSlash', version: 'v0', eventType: 'CONFISCT', parse: parseStruct };
export const slashConfisctV1: EventSchema = { namespace: 'ArenaXSlash', version: 'v1', eventType: 'CONFISCT', parse: parseStruct };
export const slashSuspendV0: EventSchema = { namespace: 'ArenaXSlash', version: 'v0', eventType: 'SUSPEND', parse: parseStruct };
export const slashSuspendV1: EventSchema = { namespace: 'ArenaXSlash', version: 'v1', eventType: 'SUSPEND', parse: parseStruct };
export const slashPermaBnV0: EventSchema = { namespace: 'ArenaXSlash', version: 'v0', eventType: 'PERMA_BN', parse: parseStruct };
export const slashPermaBnV1: EventSchema = { namespace: 'ArenaXSlash', version: 'v1', eventType: 'PERMA_BN', parse: parseStruct };
