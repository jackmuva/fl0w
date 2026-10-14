import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { access, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AI_GATEWAY_API_KEY_PLACEHOLDER,
  applyModelConfig,
  CONTEXT_WINDOW,
  DECISION_MODEL,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_DECISION_MODEL,
  DEFAULT_LLM_MODEL,
  LLM_MODEL,
} from '../../constants';
import { ensureFl0wHome, loadAppConfig, saveFl0wGatewayKey } from './app-config';

const tempRoot = join(import.meta.dir, '__fixtures__', 'app-config');

const previousEnv: Record<string, string | undefined> = {};

afterEach(async () => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(tempRoot, { recursive: true, force: true });
});

beforeEach(() => {
  for (const key of ['AI_GATEWAY_API_KEY', 'LLM_MODEL', 'DECISION_MODEL', 'CONTEXT_WINDOW'] as const) {
    previousEnv[key] = process.env[key];
    delete process.env[key];
  }
  applyModelConfig();
});

describe('loadAppConfig', () => {
  test('returns empty config when file is missing', async () => {
    const config = await loadAppConfig(join(tempRoot, 'missing.json'));
    expect(config).toEqual({});
    expect(process.env.AI_GATEWAY_API_KEY).toBeUndefined();
  });

  test('ignores placeholder aiGatewayApiKey', async () => {
    await mkdir(tempRoot, { recursive: true });
    const configPath = join(tempRoot, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({ aiGatewayApiKey: AI_GATEWAY_API_KEY_PLACEHOLDER }),
    );

    const config = await loadAppConfig(configPath);
    expect(config).toEqual({ aiGatewayApiKey: AI_GATEWAY_API_KEY_PLACEHOLDER });
    expect(process.env.AI_GATEWAY_API_KEY).toBeUndefined();
  });

  test('loads aiGatewayApiKey into process.env', async () => {
    await mkdir(tempRoot, { recursive: true });
    const configPath = join(tempRoot, 'config.json');
    await writeFile(configPath, JSON.stringify({ aiGatewayApiKey: 'test-key' }));

    const config = await loadAppConfig(configPath);
    expect(config).toEqual({ aiGatewayApiKey: 'test-key' });
    expect(process.env.AI_GATEWAY_API_KEY).toBe('test-key');
  });

  test('loads llmModel and decisionModel into process.env', async () => {
    await mkdir(tempRoot, { recursive: true });
    const configPath = join(tempRoot, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({ llmModel: 'custom/llm', decisionModel: 'custom/jev' }),
    );

    const config = await loadAppConfig(configPath);
    expect(config).toEqual({ llmModel: 'custom/llm', decisionModel: 'custom/jev' });
    expect(process.env.LLM_MODEL).toBe('custom/llm');
    expect(process.env.DECISION_MODEL).toBe('custom/jev');
    expect(LLM_MODEL).toBe('custom/llm');
    expect(DECISION_MODEL).toBe('custom/jev');
  });

  test('loads contextWindow into process.env and CONTEXT_WINDOW', async () => {
    await mkdir(tempRoot, { recursive: true });
    const configPath = join(tempRoot, 'config.json');
    await writeFile(configPath, JSON.stringify({ contextWindow: 128_000 }));

    const config = await loadAppConfig(configPath);
    expect(config).toEqual({ contextWindow: 128_000 });
    expect(process.env.CONTEXT_WINDOW).toBe('128000');
    expect(CONTEXT_WINDOW).toBe(128_000);
  });
});

describe('saveFl0wGatewayKey', () => {
  const readConfig = async (path: string) => JSON.parse(await Bun.file(path).text());

  test('replaces the placeholder, keeps other settings, and restricts permissions', async () => {
    await mkdir(tempRoot, { recursive: true });
    const configPath = join(tempRoot, 'config.json');
    await writeFile(configPath, JSON.stringify({ aiGatewayApiKey: AI_GATEWAY_API_KEY_PLACEHOLDER, llmModel: 'custom/model' }));

    expect(await saveFl0wGatewayKey('fl0w-key', configPath)).toBe(true);
    expect(await readConfig(configPath)).toEqual({ aiGatewayApiKey: 'fl0w-key', llmModel: 'custom/model' });
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    expect(process.env.AI_GATEWAY_API_KEY).toBe('fl0w-key');
  });

  test('creates config.json when missing', async () => {
    await mkdir(tempRoot, { recursive: true });
    const configPath = join(tempRoot, 'config.json');

    expect(await saveFl0wGatewayKey('fl0w-key', configPath)).toBe(true);
    expect(await readConfig(configPath)).toEqual({ aiGatewayApiKey: 'fl0w-key' });
  });

  test('keeps a different user-supplied key in config.json', async () => {
    await mkdir(tempRoot, { recursive: true });
    const configPath = join(tempRoot, 'config.json');
    await writeFile(configPath, JSON.stringify({ aiGatewayApiKey: 'own-key' }));

    expect(await saveFl0wGatewayKey('fl0w-key', configPath)).toBe(false);
    expect(await readConfig(configPath)).toEqual({ aiGatewayApiKey: 'own-key' });
  });

  test('keeps a user-supplied AI_GATEWAY_API_KEY env var', async () => {
    await mkdir(tempRoot, { recursive: true });
    const configPath = join(tempRoot, 'config.json');
    await writeFile(configPath, JSON.stringify({ aiGatewayApiKey: AI_GATEWAY_API_KEY_PLACEHOLDER }));
    process.env.AI_GATEWAY_API_KEY = 'own-key';

    expect(await saveFl0wGatewayKey('fl0w-key', configPath)).toBe(false);
    expect(await readConfig(configPath)).toEqual({ aiGatewayApiKey: AI_GATEWAY_API_KEY_PLACEHOLDER });
  });
});

describe('ensureFl0wHome', () => {
  test('creates default home layout when missing', async () => {
    const home = join(tempRoot, 'fresh-home');
    await ensureFl0wHome(home);

    await access(join(home, 'tools'));

    const config = JSON.parse(await Bun.file(join(home, 'config.json')).text());
    expect(config).toEqual({
      aiGatewayApiKey: AI_GATEWAY_API_KEY_PLACEHOLDER,
      llmModel: DEFAULT_LLM_MODEL,
      decisionModel: DEFAULT_DECISION_MODEL,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      sync: true,
    });

    const mcpConfig = JSON.parse(await Bun.file(join(home, 'mcp.json')).text());
    expect(mcpConfig).toEqual({ mcpServers: {} });
  });

  test('does not overwrite existing config files', async () => {
    const home = join(tempRoot, 'existing-home');
    await mkdir(home, { recursive: true });
    await writeFile(join(home, 'config.json'), JSON.stringify({ llmModel: 'custom/model' }));
    await writeFile(join(home, 'mcp.json'), JSON.stringify({ mcpServers: { demo: { command: 'echo' } } }));

    await ensureFl0wHome(home);

    const config = JSON.parse(await Bun.file(join(home, 'config.json')).text());
    expect(config).toEqual({
      llmModel: 'custom/model',
      aiGatewayApiKey: AI_GATEWAY_API_KEY_PLACEHOLDER,
      decisionModel: DEFAULT_DECISION_MODEL,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      sync: true,
    });

    const mcpConfig = JSON.parse(await Bun.file(join(home, 'mcp.json')).text());
    expect(mcpConfig.mcpServers.demo).toEqual({ command: 'echo' });
  });
});
