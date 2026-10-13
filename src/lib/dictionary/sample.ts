/**
 * A small synthetic DDv2 dictionary for tests and the development pages. It has the same shape as the published dictionary
 * (config/dd/current.json, read from S3 at run time) and exercises every feature the page renders: envelope keys, nullable/range/default/enum/array
 * properties, an entity without properties, label-to-entity references in both spellings, declared edges, open edge families,
 * a label related only through an open family, and an isolated label. Nothing here is the real dictionary.
 */
const str = { type: ['string', 'null'] };

export const SAMPLE_DICTIONARY = {
  version: 'sample-ddv2-v1',
  schema: 'tenant-observation-envelope',
  required: ['tenantId', 'source', 'eventTime'],
  entities: {
    account: {
      properties: {
        accountId: { ...str, description: 'Identifier of the account.' },
        blastRadiusScore: { type: ['number', 'null'], minimum: 0, maximum: 10, description: 'Hops from a reachable asset to a crown-jewel resource.' },
        decommissioned: { type: 'boolean', default: false },
        scoredAt: { type: ['string', 'null'], format: 'date-time' },
      },
    },
    http_activity: {
      properties: {
        tenantId: str,
        source: str,
        eventTime: { type: 'string', format: 'date-time' },
        srcIp: { ...str, description: 'Client address.' },
        ja3: { ...str, description: 'TLS client fingerprint.' },
        forwarderHost: str,
        outcome: { type: 'string', enum: ['allow', 'block', 'error', 'unknown'] },
        bytesSent: { type: ['integer', 'null'], minimum: 0 },
        tags: { type: ['array', 'null'], items: { type: 'string' } },
      },
    },
    principal: { properties: { principalId: str, displayName: str } },
    resource: { properties: { resourceId: str, kind: str } },
    indicator: { properties: { indicatorId: str, pattern: str } },
    technique: { properties: { techniqueId: str, name: str } },
    service_log: { properties: { message: str } },
    gen3model: { properties: {} },
  },
  graphContract: {
    envelopeKeys: ['tenantId', 'source', 'eventTime'],
    internalKeys: ['sourceIndex'],
    labels: {
      Account: ['account'],
      IpAddress: ['http_activity'],
      Indicator: ['indicator'],
      Observation: ['http_activity'],
      Principal: ['principal'],
      Resource: ['resource'],
      ServiceLog: ['serviceLog'],
      Technique: ['technique'],
      WafRequest: ['http_activity'],
    },
    edges: [
      { type: 'originated', from: 'IpAddress', to: 'Principal', relation: 'originated' },
      { type: 'member_of', from: 'Principal', to: 'Account', relation: 'member_of' },
      { type: 'accessed', from: 'Principal', to: 'Resource', relation: 'accessed' },
      { type: 'requested_by', from: 'WafRequest', to: 'IpAddress', relation: 'requested_by' },
      { type: 'observed', from: 'Observation', to: 'WafRequest', relation: 'observed' },
    ],
    edgeFamilies: [
      { name: 'apiOperation', pattern: '^[A-Za-z][A-Za-z0-9]*$', from: ['Principal'], to: ['Resource'], relation: 'called', note: 'The edge type is an API operation name, so the set is open.' },
      { name: 'flow', pattern: '^flow:[A-Za-z0-9_]+(:[A-Za-z0-9_]+)?$', from: ['IpAddress'], to: ['IpAddress'], relation: 'flowed_to', note: 'flow:<protocol>:<verdict> or flow:<verdict>.' },
      { name: 'stixRelationship', pattern: '^[a-z][a-z-]*$', from: ['Indicator', 'Technique', 'Observation'], to: ['Indicator', 'Technique'], relation: '', note: 'The relationship name is the edge type.' },
    ],
  },
};
