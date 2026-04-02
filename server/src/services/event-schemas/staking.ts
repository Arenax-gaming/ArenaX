import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { EventSchema } from '../event-parser.service.js';

function parseStruct(data: xdr.ScVal): Record<string, unknown> {
    return scValToNative(data) as Record<string, unknown>;
}

export const stakeInitV0: EventSchema = { namespace: 'ArenaXStake', version: 'v0', eventType: 'INIT', parse: parseStruct };
export const stakeInitV1: EventSchema = { namespace: 'ArenaXStake', version: 'v1', eventType: 'INIT', parse: parseStruct };
export const stakeTokenSetV0: EventSchema = { namespace: 'ArenaXStake', version: 'v0', eventType: 'TOKEN_SET', parse: parseStruct };
export const stakeTokenSetV1: EventSchema = { namespace: 'ArenaXStake', version: 'v1', eventType: 'TOKEN_SET', parse: parseStruct };
export const stakeTournSetV0: EventSchema = { namespace: 'ArenaXStake', version: 'v0', eventType: 'TOURN_SET', parse: parseStruct };
export const stakeTournSetV1: EventSchema = { namespace: 'ArenaXStake', version: 'v1', eventType: 'TOURN_SET', parse: parseStruct };
export const stakeDispSetV0: EventSchema = { namespace: 'ArenaXStake', version: 'v0', eventType: 'DISP_SET', parse: parseStruct };
export const stakeDispSetV1: EventSchema = { namespace: 'ArenaXStake', version: 'v1', eventType: 'DISP_SET', parse: parseStruct };
export const stakeStakedV0: EventSchema = { namespace: 'ArenaXStake', version: 'v0', eventType: 'STAKED', parse: parseStruct };
export const stakeStakedV1: EventSchema = { namespace: 'ArenaXStake', version: 'v1', eventType: 'STAKED', parse: parseStruct };
export const stakeWithdrawnV0: EventSchema = { namespace: 'ArenaXStake', version: 'v0', eventType: 'WITHDRAWN', parse: parseStruct };
export const stakeWithdrawnV1: EventSchema = { namespace: 'ArenaXStake', version: 'v1', eventType: 'WITHDRAWN', parse: parseStruct };
export const stakeSlashedV0: EventSchema = { namespace: 'ArenaXStake', version: 'v0', eventType: 'SLASHED', parse: parseStruct };
export const stakeSlashedV1: EventSchema = { namespace: 'ArenaXStake', version: 'v1', eventType: 'SLASHED', parse: parseStruct };
export const stakeTournNewV0: EventSchema = { namespace: 'ArenaXStake', version: 'v0', eventType: 'TOURN_NEW', parse: parseStruct };
export const stakeTournNewV1: EventSchema = { namespace: 'ArenaXStake', version: 'v1', eventType: 'TOURN_NEW', parse: parseStruct };
export const stakeTournUpdV0: EventSchema = { namespace: 'ArenaXStake', version: 'v0', eventType: 'TOURN_UPD', parse: parseStruct };
export const stakeTournUpdV1: EventSchema = { namespace: 'ArenaXStake', version: 'v1', eventType: 'TOURN_UPD', parse: parseStruct };
export const stakePausedV0: EventSchema = { namespace: 'ArenaXStake', version: 'v0', eventType: 'PAUSED', parse: parseStruct };
export const stakePausedV1: EventSchema = { namespace: 'ArenaXStake', version: 'v1', eventType: 'PAUSED', parse: parseStruct };
