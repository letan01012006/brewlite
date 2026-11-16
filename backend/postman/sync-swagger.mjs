import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const url = 'http://127.0.0.1:4001/api/docs-json';
const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error(`Swagger HTTP ${response.status}: ${url}`);
const spec = await response.json();
if (!spec.openapi?.startsWith('3.') || !spec.paths?.['/api/health']) throw new Error('Swagger BrewLite không hợp lệ.');
writeFileSync(new URL('BrewLite.openapi.json', import.meta.url), JSON.stringify(spec, null, 2) + '\n');
const result = spawnSync(process.execPath, [fileURLToPath(new URL('build-collection.mjs', import.meta.url)), '--collection-only'], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
