import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const spec = read('BrewLite.openapi.json');
const collection = read('BrewLite.postman_collection.json');
assert.ok(collection.item.every(f => f.item && !/^\d\d\b/.test(f.name)), 'Only top-level Swagger tags are allowed');
const expected = new Map();
for (const [path, methods] of Object.entries(spec.paths)) for (const [method, op] of Object.entries(methods)) {
  if (['get', 'post', 'patch', 'put', 'delete', 'head', 'options'].includes(method)) expected.set(`${method.toUpperCase()} ${path}`, op);
}
const actual = new Set();
const flatten = items => items.flatMap(i => i.item ? flatten(i.item) : [i]);
const variableKeys = new Set(collection.variable.map(v => v.key));
const deref = schema => schema.$ref ? spec.components.schemas[schema.$ref.split('/').at(-1)] : schema;
function validate(value, rawSchema) {
  const schema = deref(rawSchema);
  if (schema.enum) assert.ok(schema.enum.includes(value), `Invalid enum ${value}`);
  if (schema.type === 'object' && schema.properties) {
    for (const key of schema.required || []) assert.ok(key in value, `Missing ${key}`);
    for (const [key, child] of Object.entries(value)) { assert.ok(schema.properties[key], `Unknown ${key}`); validate(child, schema.properties[key]); }
  } else if (schema.type === 'array') { assert.ok(Array.isArray(value)); for (const child of value) validate(child, schema.items); }
  else if (schema.type === 'integer') assert.ok(Number.isInteger(value));
  else if (schema.type) assert.equal(typeof value, schema.type);
}
const replace = text => text.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
  if (key === '$guid') return '00112233-4455-4677-8899-aabbccddeeff';
  assert.ok(variableKeys.has(key), `Undefined variable ${key}`);
  return ({ size: 'M', otp_code: '123456', register_phone: '0900000002', staff_phone: '0900000003', register_password: 'Postman@123', staff_password: 'Barista@123', promo_code: 'BREW10' })[key] || (/(_id)$/.test(key) ? '1' : 'demo');
});
for (const group of collection.item) for (const item of group.item) {
  const req = item.request;
  const raw = typeof req.url === 'string' ? req.url : req.url.raw;
  const path = '/api' + raw.replace('{{base_url}}', '').split('?')[0].replace(/\{\{size\}\}/g, '{size}').replace(/\{\{\w+_id\}\}/g, '{id}');
  const key = `${req.method} ${path}`;
  assert.ok(!actual.has(key), `Duplicate ${key}`);
  actual.add(key);
  const op = expected.get(key);
  assert.ok(op, `Unexpected ${key}`);
  assert.equal(group.name, op.tags[0]);
  assert.equal(req.auth.type, op.security?.length ? 'bearer' : 'noauth');
  if (group.name === 'admin/staff') assert.equal(req.auth.bearer[0].value, '{{barista_token}}', 'Only the Barista token may manage staff accounts');
  assert.equal(!!req.body, !!op.requestBody, `Body mismatch ${key}`);
  if (req.body) validate(JSON.parse(replace(req.body.raw)), op.requestBody.content['application/json'].schema);
  if (typeof req.url === 'object') {
    const query = req.url.query || [];
    assert.deepEqual(query.map(q => q.key), (op.parameters || []).filter(p => p.in === 'query').map(p => p.name));
    assert.equal(req.url.raw.split('?')[1] || '', query.filter(q => !q.disabled).map(q => `${q.key}=${q.value}`).join('&'));
  }
  const headers = req.header.map(h => h.key.toLowerCase());
  assert.equal(new Set(headers).size, headers.length, `Duplicate headers ${key}`);
  for (const p of op.parameters || []) if (p.in === 'header') assert.ok(headers.includes(p.name.toLowerCase()));
}
assert.deepEqual([...actual].sort(), [...expected.keys()].sort());
let scripts = 0;
for (const item of flatten(collection.item)) {
  replace(JSON.stringify(item.request));
  for (const event of item.event || []) { new Function(event.script.exec.join('\n')); scripts++; }
}
assert.deepEqual(collection.item.map(g => g.name), [...new Set([...expected.values()].map(op => op.tags[0]))]);
assert.equal(flatten(collection.item).length, expected.size);
console.log(`PASS: ${actual.size}/${expected.size} Swagger endpoints in ${collection.item.length} top-level groups; tags, auth, body schemas, query, headers, variables; ${scripts} scripts parse; no legacy folders.`);
