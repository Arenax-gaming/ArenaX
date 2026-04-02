const { nativeToScVal } = require('@stellar/stellar-sdk');

function buildTopics(values) {
    return values.map((v) => nativeToScVal(v, { type: 'symbol' }));
}

function buildV0Topics(namespace, eventType) {
    return buildTopics([namespace, eventType]);
}

function buildV1Topics(namespace, eventType) {
    return buildTopics([`${namespace}_v1`, eventType]);
}

function buildEventData(fields) {
    return nativeToScVal(fields);
}

module.exports = { buildTopics, buildV0Topics, buildV1Topics, buildEventData };
