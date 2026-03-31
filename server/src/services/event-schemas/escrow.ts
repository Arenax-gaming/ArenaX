import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { EventSchema } from '../event-parser.service.js';

function parseStruct(data: xdr.ScVal): Record<string, unknown> {
    return scValToNative(data) as Record<string, unknown>;
}

export const escrowInitV0: EventSchema = { namespace: 'ArenaXEscrow', version: 'v0', eventType: 'INIT', parse: parseStruct };
export const escrowInitV1: EventSchema = { namespace: 'ArenaXEscrow', version: 'v1', eventType: 'INIT', parse: parseStruct };
export const escrowMatchSetV0: EventSchema = { namespace: 'ArenaXEscrow', version: 'v0', eventType: 'MATCH_SET', parse: parseStruct };
export const escrowMatchSetV1: EventSchema = { namespace: 'ArenaXEscrow', version: 'v1', eventType: 'MATCH_SET', parse: parseStruct };
export const escrowIdSetV0: EventSchema = { namespace: 'ArenaXEscrow', version: 'v0', eventType: 'ID_SET', parse: parseStruct };
export const escrowIdSetV1: EventSchema = { namespace: 'ArenaXEscrow', version: 'v1', eventType: 'ID_SET', parse: parseStruct };
export const escrowTreasuryV0: EventSchema = { namespace: 'ArenaXEscrow', version: 'v0', eventType: 'TREASURY', parse: parseStruct };
export const escrowTreasuryV1: EventSchema = { namespace: 'ArenaXEscrow', version: 'v1', eventType: 'TREASURY', parse: parseStruct };
export const escrowDepositV0: EventSchema = { namespace: 'ArenaXEscrow', version: 'v0', eventType: 'DEPOSIT', parse: parseStruct };
export const escrowDepositV1: EventSchema = { namespace: 'ArenaXEscrow', version: 'v1', eventType: 'DEPOSIT', parse: parseStruct };
export const escrowLockedV0: EventSchema = { namespace: 'ArenaXEscrow', version: 'v0', eventType: 'LOCKED', parse: parseStruct };
export const escrowLockedV1: EventSchema = { namespace: 'ArenaXEscrow', version: 'v1', eventType: 'LOCKED', parse: parseStruct };
export const escrowReleasedV0: EventSchema = { namespace: 'ArenaXEscrow', version: 'v0', eventType: 'RELEASED', parse: parseStruct };
export const escrowReleasedV1: EventSchema = { namespace: 'ArenaXEscrow', version: 'v1', eventType: 'RELEASED', parse: parseStruct };
export const escrowRefundedV0: EventSchema = { namespace: 'ArenaXEscrow', version: 'v0', eventType: 'REFUNDED', parse: parseStruct };
export const escrowRefundedV1: EventSchema = { namespace: 'ArenaXEscrow', version: 'v1', eventType: 'REFUNDED', parse: parseStruct };
export const escrowSlashedV0: EventSchema = { namespace: 'ArenaXEscrow', version: 'v0', eventType: 'SLASHED', parse: parseStruct };
export const escrowSlashedV1: EventSchema = { namespace: 'ArenaXEscrow', version: 'v1', eventType: 'SLASHED', parse: parseStruct };
export const escrowEmergencyV0: EventSchema = { namespace: 'ArenaXEscrow', version: 'v0', eventType: 'EMERGENCY', parse: parseStruct };
export const escrowEmergencyV1: EventSchema = { namespace: 'ArenaXEscrow', version: 'v1', eventType: 'EMERGENCY', parse: parseStruct };
