import { SECRETS_PATH } from '../constants';
import type { SecretEntry } from '../models/secrets';
import { readSecrets, SECRET_NAME_PATTERN, secretEnvName, secretFields, writeSecrets } from '../services/secrets/secret-store';
import { configSyncStore } from '../services/sync/config-sync';

const USAGE = `Usage:
  fl0w secrets [list]
  fl0w secrets add <name> [--domain <site>]... [--description "<text>"] [--field <field>]... [--env | --no-env]
  fl0w secrets remove <name>

Stores credentials the agent may use without seeing them, in ${SECRETS_PATH} (mode 0600). When signed in,
the file syncs with fl0w-work (encrypted at rest); if two machines change it, the newer file wins.
add prompts for each field (default: username, password; passwords are not echoed). With an existing
secret, empty input keeps a field's current value and omitted options keep their current setting.
  --domain        Site where browser_fill may type the secret (subdomains included; repeatable; "*" = any site)
  --field         Field to prompt for instead of username/password (repeatable), e.g. --field token
  --env           Also expose the fields to the agent's bash tool as FL0W_SECRET_<NAME>_<FIELD>`;

const VISIBLE_FIELD = /user|email|login|account/i;

let pipedLines: string[] | undefined;

const readInput = async (label: string, hidden: boolean): Promise<string> => {
  if (!process.stdin.isTTY) {
    pipedLines ??= (await Bun.stdin.text()).split(/\r?\n/);
    return pipedLines.shift() ?? '';
  }
  process.stdout.write(label);
  const stdin = process.stdin;
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const finish = (settle: () => void) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      settle();
    };
    const onData = (chunk: Buffer | string) => {
      for (const char of String(chunk)) {
        if (char === '\r' || char === '\n') return finish(() => resolve(value));
        if (char === '\u0003') return finish(() => reject(new Error('Cancelled.')));
        if (char === '\u007f' || char === '\b') {
          if (value && !hidden) process.stdout.write('\b \b');
          value = value.slice(0, -1);
        } else if (char >= ' ') {
          value += char;
          if (!hidden) process.stdout.write(char);
        }
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
};

const SYNC_TIMEOUT_MS = 8_000;

/** Syncs secrets.json with fl0w-work (newer file wins). A no-op when signed out; failures only warn, the local file still works. */
const syncSecrets = async () => {
  try {
    const results = await Promise.race([
      configSyncStore.syncConfigFiles(['secrets.json']),
      new Promise<'timeout'>((resolve) => setTimeout(resolve, SYNC_TIMEOUT_MS, 'timeout').unref()),
    ]);
    if (results === 'timeout') console.error('Secrets sync with fl0w-work timed out; using the local file.');
    else if (results?.['secrets.json'] instanceof Error) console.error(`Secrets sync: ${results['secrets.json'].message}`);
  } catch (error) {
    console.error(`Secrets sync with fl0w-work failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const listSecrets = async () => {
  await syncSecrets();
  const entries = Object.entries(await readSecrets());
  if (entries.length === 0) {
    console.log(`No secrets yet. Add one with: fl0w secrets add <name> --domain <site>`);
    return 0;
  }
  for (const [name, entry] of entries) {
    const fields = secretFields(entry).map(([field]) => field);
    console.log(`${name}${entry.description ? ` — ${entry.description}` : ''}`);
    console.log(`  fields: ${fields.join(', ') || '(none)'}`);
    console.log(`  sites:  ${entry.domains?.length ? entry.domains.join(', ') : '(none; not usable in the browser)'}`);
    if (entry.env === true) console.log(`  bash:   ${fields.map((field) => `$${secretEnvName(name, field)}`).join(', ')}`);
  }
  return 0;
};

const addSecret = async (argv: string[]) => {
  const [name, ...options] = argv;
  if (!name || name.startsWith('-')) return usageError('add needs a secret name');
  if (!SECRET_NAME_PATTERN.test(name)) return usageError(`Secret names may only contain letters, numbers, "-" and "_": ${name}`);

  const domains: string[] = [];
  const fields: string[] = [];
  let description: string | undefined;
  let env: boolean | undefined;
  for (let i = 0; i < options.length; i++) {
    const option = options[i];
    const next = () => options[++i] ?? '';
    if (option === '--domain') domains.push(next());
    else if (option === '--field') fields.push(next());
    else if (option === '--description') description = next();
    else if (option === '--env') env = true;
    else if (option === '--no-env') env = false;
    else return usageError(`Unknown option: ${option}`);
  }
  const badField = fields.find((field) => !SECRET_NAME_PATTERN.test(field) || ['description', 'domains', 'env'].includes(field));
  if (badField !== undefined) return usageError(`Invalid field name: "${badField}"`);
  if (domains.some((domain) => !domain)) return usageError('--domain needs a site, e.g. --domain github.com');

  await syncSecrets();
  const secrets = await readSecrets();
  const existing = secrets[name];
  const entry: SecretEntry = { ...existing };
  if (description !== undefined) entry.description = description;
  if (domains.length) entry.domains = domains;
  if (env !== undefined) entry.env = env;

  const existingFields = existing ? secretFields(existing).map(([field]) => field) : [];
  const prompted = fields.length ? fields : existingFields.length ? existingFields : ['username', 'password'];
  for (const field of prompted) {
    const current = typeof existing?.[field] === 'string' ? existing[field] as string : undefined;
    const value = await readInput(`${field}${current !== undefined ? ' (Enter to keep current)' : ''}: `, !VISIBLE_FIELD.test(field));
    if (value) entry[field] = value;
    else if (current === undefined) console.error(`Skipped empty ${field}.`);
  }
  if (secretFields(entry).length === 0) {
    console.error('Nothing saved: the secret has no values.');
    return 1;
  }

  await writeSecrets({ ...secrets, [name]: entry });
  await syncSecrets();
  console.log(`${existing ? 'Updated' : 'Saved'} secret "${name}" (${secretFields(entry).map(([field]) => `${name}.${field}`).join(', ')}).`);
  if (!entry.domains?.length) console.log(`It has no sites yet, so the agent can't type it in the browser. Add one with --domain <site>.`);
  return 0;
};

const removeSecret = async (name: string | undefined) => {
  if (!name) return usageError('remove needs a secret name');
  await syncSecrets();
  const secrets = await readSecrets();
  if (!secrets[name]) {
    console.error(`No secret named "${name}".`);
    return 1;
  }
  delete secrets[name];
  await writeSecrets(secrets);
  await syncSecrets();
  console.log(`Removed secret "${name}".`);
  return 0;
};

const usageError = (message: string) => {
  console.error(`${message}\n\n${USAGE}`);
  return 1;
};

export const runSecretsCommand = async (argv: string[]): Promise<number> => {
  const [subcommand, ...rest] = argv;
  try {
    switch (subcommand) {
      case undefined:
      case 'list':
        return await listSecrets();
      case 'add':
      case 'set':
        return await addSecret(rest);
      case 'remove':
      case 'rm':
        return await removeSecret(rest[0]);
      case 'help':
      case '-h':
      case '--help':
        console.log(USAGE);
        return 0;
      default:
        return usageError(`Unknown secrets command: ${subcommand}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
};
