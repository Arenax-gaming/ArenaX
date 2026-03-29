import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { EventSchema } from '../event-parser.service.js';

function parseStruct(data: xdr.ScVal): Record<string, unknown> {
    return scValToNative(data) as Record<string, unknown>;
}

export const govInitV0: EventSchema = { namespace: 'ArenaXGov', version: 'v0', eventType: 'INIT', parse: parseStruct };
export const govInitV1: EventSchema = { namespace: 'ArenaXGov', version: 'v1', eventType: 'INIT', parse: parseStruct };
export const govProposedV0: EventSchema = { namespace: 'ArenaXGov', version: 'v0', eventType: 'PROPOSED', parse: parseStruct };
export const govProposedV1: EventSchema = { namespace: 'ArenaXGov', version: 'v1', eventType: 'PROPOSED', parse: parseStruct };
export const govApprovedV0: EventSchema = { namespace: 'ArenaXGov', version: 'v0', eventType: 'APPROVED', parse: parseStruct };
export const govApprovedV1: EventSchema = { namespace: 'ArenaXGov', version: 'v1', eventType: 'APPROVED', parse: parseStruct };
export const govRevokedV0: EventSchema = { namespace: 'ArenaXGov', version: 'v0', eventType: 'REVOKED', parse: parseStruct };
export const govRevokedV1: EventSchema = { namespace: 'ArenaXGov', version: 'v1', eventType: 'REVOKED', parse: parseStruct };
export const govExecutedV0: EventSchema = { namespace: 'ArenaXGov', version: 'v0', eventType: 'EXECUTED', parse: parseStruct };
export const govExecutedV1: EventSchema = { namespace: 'ArenaXGov', version: 'v1', eventType: 'EXECUTED', parse: parseStruct };
export const govCancelledV0: EventSchema = { namespace: 'ArenaXGov', version: 'v0', eventType: 'CANCELLED', parse: parseStruct };
export const govCancelledV1: EventSchema = { namespace: 'ArenaXGov', version: 'v1', eventType: 'CANCELLED', parse: parseStruct };
export const govSignerAddV0: EventSchema = { namespace: 'ArenaXGov', version: 'v0', eventType: 'SIGNER_ADD', parse: parseStruct };
export const govSignerAddV1: EventSchema = { namespace: 'ArenaXGov', version: 'v1', eventType: 'SIGNER_ADD', parse: parseStruct };
export const govSignerRemV0: EventSchema = { namespace: 'ArenaXGov', version: 'v0', eventType: 'SIGNER_REM', parse: parseStruct };
export const govSignerRemV1: EventSchema = { namespace: 'ArenaXGov', version: 'v1', eventType: 'SIGNER_REM', parse: parseStruct };
export const govThreshUpdV0: EventSchema = { namespace: 'ArenaXGov', version: 'v0', eventType: 'THRESH_UPD', parse: parseStruct };
export const govThreshUpdV1: EventSchema = { namespace: 'ArenaXGov', version: 'v1', eventType: 'THRESH_UPD', parse: parseStruct };
