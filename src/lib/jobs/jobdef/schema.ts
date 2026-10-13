import Ajv from 'ajv';

const text = (n: number) => ({ type: 'string', maxLength: n });
const NAME = '^[A-Za-z_][A-Za-z0-9_]{0,127}$';
const argv = { type: 'array', minItems: 1, maxItems: 64, items: text(2048) };
const fileType = { enum: ['FILE', 'DIRECTORY'] };
const image = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,511}$' };
const envMap = { type: 'object', maxProperties: 64, propertyNames: { pattern: NAME }, additionalProperties: text(1024) };

const PARAMS_SCHEMA = {
      type: 'array', maxItems: 32,
      items: {
        type: 'object', additionalProperties: false, required: ['name', 'label', 'type'],
        properties: {
          name: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$' },
          label: { type: 'string', minLength: 1, maxLength: 128 },
          description: text(1024),
          type: { enum: ['string', 'integer', 'number', 'boolean', 'enum', 's3_url', 'http_url'] },
          required: { type: 'boolean' },
          default: { oneOf: [text(4096), { type: 'number' }, { type: 'boolean' }] },
          values: { type: 'array', minItems: 1, maxItems: 64, uniqueItems: true, items: text(128) },
          pattern: text(128),
          min: { type: 'number' },
          max: { type: 'number' },
          max_length: { type: 'integer', minimum: 1, maximum: 4096 },
          allow_leading_dash: { type: 'boolean' },
        },
      },
    } as const;

const JOBDEF_SCHEMA = {
  $id: 'vectis-jobdef-v1',
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'id', 'name', 'image', 'command'],
  properties: {
    schema_version: { const: 1 },
    id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,62}$' },
    name: { type: 'string', minLength: 1, maxLength: 128 },
    description: text(2048),
    tags: { type: 'array', maxItems: 16, uniqueItems: true, items: { type: 'string', pattern: '^[a-z0-9][a-z0-9_.-]{0,31}$' } },
    image,
    command: argv,
    env: envMap,
    params: PARAMS_SCHEMA,
    inputs: {
      type: 'array', maxItems: 32,
      items: {
        type: 'object', additionalProperties: false, required: ['name', 'url', 'path'],
        properties: { name: text(128), description: text(1024), url: text(2048), path: text(1024), type: fileType },
      },
    },
    outputs: {
      type: 'array', maxItems: 32,
      items: {
        type: 'object', additionalProperties: false, required: ['name', 'url', 'path'],
        properties: { name: text(128), description: text(1024), url: text(2048), path: text(1024), path_prefix: text(1024), type: fileType },
      },
    },
    resources: {
      type: 'object', additionalProperties: false,
      properties: {
        cpu_cores: { type: 'integer', minimum: 1, maximum: 16 },
        ram_gb: { type: 'number', minimum: 0.1, maximum: 128 },
        disk_gb: { type: 'number', minimum: 0.1, maximum: 500 },
        preemptible: { type: 'boolean' },
      },
    },
    executors_after: {
      type: 'array', maxItems: 7,
      items: { type: 'object', additionalProperties: false, required: ['image', 'command'], properties: { image, command: argv, env: envMap, workdir: text(1024) } },
    },
    secrets: { type: 'array', maxItems: 32, uniqueItems: true, items: { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,64}$' } },
    timeout_seconds: { type: 'integer', minimum: 1, maximum: 604800 },
    owner: { type: 'string', pattern: '^[A-Za-z0-9 _.@/-]{1,128}$' },
  },
} as const;

/**
 * A catalog entry for a workflow-engine job: OUR metadata around an engine-native definition file kept in the same commit.
 * The native file is passed through to the engine; there is no translation language here.
 */
const DAGDEF_SCHEMA = {
  $id: 'vectis-dagdef-v1',
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'kind', 'engine', 'id', 'name', 'definition'],
  properties: {
    schema_version: { const: 1 },
    kind: { const: 'dag' },
    engine: { enum: ['dagu'] },
    id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,62}$' },
    name: { type: 'string', minLength: 1, maxLength: 128 },
    description: text(2048),
    tags: { type: 'array', maxItems: 16, uniqueItems: true, items: { type: 'string', pattern: '^[a-z0-9][a-z0-9_.-]{0,31}$' } },
    // path of the native file relative to the catalog directory, in the SAME commit; a yaml file, no '..', no leading '/'
    definition: { type: 'string', pattern: '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}(/[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}){0,3}\\.ya?ml$' },
    params: PARAMS_SCHEMA,
    owner: { type: 'string', pattern: '^[A-Za-z0-9 _.@/-]{1,128}$' },
  },
} as const;

let validator: ReturnType<Ajv['compile']> | null = null;
let dagValidator: ReturnType<Ajv['compile']> | null = null;
export function dagDefValidator() {
  if (!dagValidator) dagValidator = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true }).compile(DAGDEF_SCHEMA);
  return dagValidator;
}
export function jobDefValidator() {
  if (!validator) validator = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true }).compile(JOBDEF_SCHEMA);
  return validator;
}
