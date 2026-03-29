import eventParser from '../event-parser.service.js';
import * as reputation from './reputation.js';
import * as reputationIndex from './reputation-index.js';
import * as match from './match.js';
import * as escrow from './escrow.js';
import * as slashing from './slashing.js';
import * as governance from './governance.js';
import * as staking from './staking.js';
import * as antiCheat from './anti-cheat.js';
import * as dispute from './dispute.js';
import * as registry from './registry.js';
import * as authGateway from './auth-gateway.js';
import * as identity from './identity.js';
import * as token from './token.js';

const allModules = [
    reputation, reputationIndex, match, escrow, slashing,
    governance, staking, antiCheat, dispute, registry,
    authGateway, identity, token,
];

for (const mod of allModules) {
    for (const schema of Object.values(mod)) {
        if (schema && typeof schema === 'object' && 'namespace' in schema && 'parse' in schema) {
            eventParser.register(schema);
        }
    }
}

export { eventParser };
