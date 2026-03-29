import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { EventSchema } from '../event-parser.service.js';

function parseStruct(data: xdr.ScVal): Record<string, unknown> {
    return scValToNative(data) as Record<string, unknown>;
}

export const tokenMintV0: EventSchema = { namespace: 'ArenaXToken', version: 'v0', eventType: 'MINT', parse: parseStruct };
export const tokenMintV1: EventSchema = { namespace: 'ArenaXToken', version: 'v1', eventType: 'MINT', parse: parseStruct };
export const tokenBurnV0: EventSchema = { namespace: 'ArenaXToken', version: 'v0', eventType: 'BURN', parse: parseStruct };
export const tokenBurnV1: EventSchema = { namespace: 'ArenaXToken', version: 'v1', eventType: 'BURN', parse: parseStruct };
export const tokenTransferV0: EventSchema = { namespace: 'ArenaXToken', version: 'v0', eventType: 'TRANSFER', parse: parseStruct };
export const tokenTransferV1: EventSchema = { namespace: 'ArenaXToken', version: 'v1', eventType: 'TRANSFER', parse: parseStruct };
