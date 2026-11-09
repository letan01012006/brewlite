import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

// Explicit development command only. Persist the key so restarting the server
// does not invalidate pending OTPs. Never change an existing configuration key.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (!existsSync(envFile)) {
  throw new Error('Missing backend/.env. Run Copy-Item .env.example .env and configure DATABASE_URL/JWT_SECRET before migrating.');
}
const contents = readFileSync(envFile, 'utf8');
const settings = { ...parseEnv(contents), ...process.env };
if (settings.NODE_ENV && !['development', 'test'].includes(settings.NODE_ENV)) {
  throw new Error('start:dev only supports NODE_ENV=development/test; no environment file was changed.');
}
if (settings.OTP_HASH_SECRET !== undefined && settings.OTP_HASH_SECRET.length < 32) {
  throw new Error('OTP_HASH_SECRET must have at least 32 characters. Update backend/.env; existing values were preserved.');
}
const additions = [];
if (!settings.NODE_ENV) additions.push('NODE_ENV=development');
if (settings.OTP_HASH_SECRET === undefined) {
  additions.push('OTP_HASH_SECRET="' + randomBytes(32).toString('hex') + '"');
}
if (additions.length) {
  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  appendFileSync(envFile, (contents.endsWith('\n') ? '' : newline) + additions.join(newline) + newline);
  console.log('Development configuration: added ' + additions.map(line => line.split('=')[0]).join(', ') + ' to backend/.env.');
}
