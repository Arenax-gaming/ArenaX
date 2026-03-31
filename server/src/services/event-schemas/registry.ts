import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { EventSchema } from '../event-parser.service.js';

function parseStruct(data: xdr.ScVal): Record<string, unknown> {
    return scValToNative(data) as Record<string, unknown>;
}

// ArenaXReg events
export const regInitV0: EventSchema = { namespace: 'ArenaXReg', version: 'v0', eventType: 'INIT', parse: parseStruct };
export const regInitV1: EventSchema = { namespace: 'ArenaXReg', version: 'v1', eventType: 'INIT', parse: parseStruct };
export const regRegisterV0: EventSchema = { namespace: 'ArenaXReg', version: 'v0', eventType: 'REGISTER', parse: parseStruct };
export const regRegisterV1: EventSchema = { namespace: 'ArenaXReg', version: 'v1', eventType: 'REGISTER', parse: parseStruct };
export const regUpdateV0: EventSchema = { namespace: 'ArenaXReg', version: 'v0', eventType: 'UPDATE', parse: parseStruct };
export const regUpdateV1: EventSchema = { namespace: 'ArenaXReg', version: 'v1', eventType: 'UPDATE', parse: parseStruct };

// ArenaXCReg (contract-registry) events
export const cregInitV0: EventSchema = { namespace: 'ArenaXCReg', version: 'v0', eventType: 'INIT', parse: parseStruct };
export const cregInitV1: EventSchema = { namespace: 'ArenaXCReg', version: 'v1', eventType: 'INIT', parse: parseStruct };
export const cregRegisteredV0: EventSchema = { namespace: 'ArenaXCReg', version: 'v0', eventType: 'REGISTERED', parse: parseStruct };
export const cregRegisteredV1: EventSchema = { namespace: 'ArenaXCReg', version: 'v1', eventType: 'REGISTERED', parse: parseStruct };
export const cregUpdatedV0: EventSchema = { namespace: 'ArenaXCReg', version: 'v0', eventType: 'UPDATED', parse: parseStruct };
export const cregUpdatedV1: EventSchema = { namespace: 'ArenaXCReg', version: 'v1', eventType: 'UPDATED', parse: parseStruct };
export const cregRemovedV0: EventSchema = { namespace: 'ArenaXCReg', version: 'v0', eventType: 'REMOVED', parse: parseStruct };
export const cregRemovedV1: EventSchema = { namespace: 'ArenaXCReg', version: 'v1', eventType: 'REMOVED', parse: parseStruct };
export const cregPausedV0: EventSchema = { namespace: 'ArenaXCReg', version: 'v0', eventType: 'PAUSED', parse: parseStruct };
export const cregPausedV1: EventSchema = { namespace: 'ArenaXCReg', version: 'v1', eventType: 'PAUSED', parse: parseStruct };
