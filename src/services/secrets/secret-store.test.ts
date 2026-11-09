import { describe, expect, test } from 'bun:test';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SecretsFile } from '../../models/secrets';
import { readSecrets, resolveSecretRef, secretEnv, secretRedactor, writeSecrets } from './secret-store';

const secrets: SecretsFile = {
  github: { description: 'Work account', domains: ['github.com'], username: 'ada-work', password: 'hunter2-pass' },
  intranet: { domains: ['https://intranet.example.com/login'], password: 'p4ss.word*' },
  api: { env: true, token: 'tok_123456' },
  anywhere: { domains: ['*'], pin: '987654' },
};

describe('resolveSecretRef', () => {
  test('returns the value on an allowed site or subdomain', () => {
    expect(resolveSecretRef(secrets, 'github.password', 'https://github.com/login')).toBe('hunter2-pass');
    expect(resolveSecretRef(secrets, 'github.username', 'https://gist.github.com/')).toBe('ada-work');
    expect(resolveSecretRef(secrets, 'intranet.password', 'https://intranet.example.com/')).toBe('p4ss.word*');
    expect(resolveSecretRef(secrets, 'anywhere.pin', 'https://bank.example/')).toBe('987654');
  });

  test('refuses other sites, insecure pages, and secrets without sites', () => {
    expect(() => resolveSecretRef(secrets, 'github.password', 'https://evil.com/github.com')).toThrow('may only be used on github.com');
    expect(() => resolveSecretRef(secrets, 'github.password', 'https://notgithub.com/')).toThrow('may only be used on');
    expect(() => resolveSecretRef(secrets, 'github.password', 'http://github.com/')).toThrow('insecure');
    expect(() => resolveSecretRef(secrets, 'api.token', 'https://api.example/')).toThrow('no allowed domains');
  });

  test('explains unknown secrets and fields', () => {
    expect(() => resolveSecretRef(secrets, 'gitlab.password', 'https://gitlab.com/')).toThrow('Unknown secret "gitlab"');
    expect(() => resolveSecretRef(secrets, 'github.token', 'https://github.com/')).toThrow('github.username, github.password');
    expect(() => resolveSecretRef(secrets, 'github.description', 'https://github.com/')).toThrow('has no field');
  });
});

describe('secretRedactor', () => {
  const redact = secretRedactor(secrets);

  test('masks values in strings and nested results', () => {
    expect(redact('login ada-work / hunter2-pass')).toBe('login [secret github.username] / [secret github.password]');
    expect(redact({ content: ['p4ss.word*'], isError: false })).toEqual({ content: ['[secret intranet.password]'], isError: false });
  });

  test('leaves output alone when there are no secrets', () => {
    expect(secretRedactor({})('hunter2-pass')).toBe('hunter2-pass');
  });
});

test('secretEnv only exposes secrets that opt in', () => {
  expect(secretEnv(secrets)).toEqual({ FL0W_SECRET_API_TOKEN: 'tok_123456' });
});

test('secrets are written owner-only and loose permissions are tightened on read', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'fl0w-secrets-')), 'secrets.json');
  expect(await readSecrets(path)).toEqual({});
  await writeSecrets(secrets, path);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  await writeFile(path, JSON.stringify(secrets), { mode: 0o644 });
  expect(await readSecrets(path)).toEqual(secrets);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  await writeFile(path, '[]');
  await expect(readSecrets(path)).rejects.toThrow('must be a JSON object');
});
