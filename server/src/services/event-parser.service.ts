import { xdr, scValToNative } from '@stellar/stellar-sdk';

export class UnknownEventError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UnknownEventError';
    }
}

export interface ParsedEvent<T = Record<string, unknown>> {
    namespace: string;
    version: string;
    eventType: string;
    data: T;
}

export interface EventSchema<T = Record<string, unknown>> {
    namespace: string;
    version: string;
    eventType: string;
    parse: (data: xdr.ScVal) => T;
}

function scValToString(val: xdr.ScVal): string {
    const native = scValToNative(val);
    return typeof native === 'string' ? native : String(native);
}

function splitNamespaceVersion(topic: string): { namespace: string; version: string } {
    const lastUnderscore = topic.lastIndexOf('_v');
    if (lastUnderscore !== -1) {
        const candidate = topic.substring(lastUnderscore + 1);
        if (/^v\d+$/.test(candidate)) {
            return {
                namespace: topic.substring(0, lastUnderscore),
                version: candidate,
            };
        }
    }
    return { namespace: topic, version: 'v0' };
}

export class EventParserService {
    private schemas = new Map<string, EventSchema>();

    register(schema: EventSchema): void {
        const key = `${schema.namespace}:${schema.version}:${schema.eventType}`;
        this.schemas.set(key, schema);
    }

    parseEvent(topics: xdr.ScVal[], data: xdr.ScVal): ParsedEvent {
        if (topics.length < 2) {
            throw new UnknownEventError(`Unexpected topic count: ${topics.length}`);
        }

        const firstTopic = scValToString(topics[0]);
        const eventType = scValToString(topics[1]);
        const { namespace, version } = splitNamespaceVersion(firstTopic);

        return this.dispatch(namespace, version, eventType, data);
    }

    private dispatch(
        namespace: string,
        version: string,
        eventType: string,
        data: xdr.ScVal,
    ): ParsedEvent {
        const key = `${namespace}:${version}:${eventType}`;
        const schema = this.schemas.get(key);
        if (!schema) {
            throw new UnknownEventError(`No parser registered for ${key}`);
        }
        return {
            namespace,
            version,
            eventType,
            data: schema.parse(data),
        };
    }

    getRegisteredKeys(): string[] {
        return Array.from(this.schemas.keys());
    }
}

export default new EventParserService();
