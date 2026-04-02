import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { EventSchema } from '../event-parser.service.js';

function parseStruct(data: xdr.ScVal): Record<string, unknown> {
    return scValToNative(data) as Record<string, unknown>;
}

export const authInitV0: EventSchema = { namespace: 'ArenaXAuth', version: 'v0', eventType: 'INIT', parse: parseStruct };
export const authInitV1: EventSchema = { namespace: 'ArenaXAuth', version: 'v1', eventType: 'INIT', parse: parseStruct };
export const authRoleSetV0: EventSchema = { namespace: 'ArenaXAuth', version: 'v0', eventType: 'ROLE_SET', parse: parseStruct };
export const authRoleSetV1: EventSchema = { namespace: 'ArenaXAuth', version: 'v1', eventType: 'ROLE_SET', parse: parseStruct };
export const authRoleRevV0: EventSchema = { namespace: 'ArenaXAuth', version: 'v0', eventType: 'ROLE_REV', parse: parseStruct };
export const authRoleRevV1: EventSchema = { namespace: 'ArenaXAuth', version: 'v1', eventType: 'ROLE_REV', parse: parseStruct };
export const authWlAddV0: EventSchema = { namespace: 'ArenaXAuth', version: 'v0', eventType: 'WL_ADD', parse: parseStruct };
export const authWlAddV1: EventSchema = { namespace: 'ArenaXAuth', version: 'v1', eventType: 'WL_ADD', parse: parseStruct };
export const authWlRemV0: EventSchema = { namespace: 'ArenaXAuth', version: 'v0', eventType: 'WL_REM', parse: parseStruct };
export const authWlRemV1: EventSchema = { namespace: 'ArenaXAuth', version: 'v1', eventType: 'WL_REM', parse: parseStruct };
export const authPausedV0: EventSchema = { namespace: 'ArenaXAuth', version: 'v0', eventType: 'PAUSED', parse: parseStruct };
export const authPausedV1: EventSchema = { namespace: 'ArenaXAuth', version: 'v1', eventType: 'PAUSED', parse: parseStruct };
