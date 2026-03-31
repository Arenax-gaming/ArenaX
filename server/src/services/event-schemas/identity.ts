import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { EventSchema } from '../event-parser.service.js';

function parseStruct(data: xdr.ScVal): Record<string, unknown> {
    return scValToNative(data) as Record<string, unknown>;
}

export const idRoleSetV0: EventSchema = { namespace: 'ArenaXId', version: 'v0', eventType: 'ROLE_SET', parse: parseStruct };
export const idRoleSetV1: EventSchema = { namespace: 'ArenaXId', version: 'v1', eventType: 'ROLE_SET', parse: parseStruct };
