import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AGENT_MODE,
  applyModelConfig,
  CONTEXT_WINDOW,
  DECISION_MODEL,
  DEFAULT_AGENT_MODE,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_DECISION_MODEL,
  DEFAULT_LLM_MODEL,
  DEFAULT_TOOL_OUTPUT_MAX_CHARS,
  LLM_MODEL,
  TOOL_OUTPUT_MAX_CHARS,
} from '../../constants';
import { ensureFl0wHome, loadAppConfig } from './app-config';

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
  for (const key of ['LLM_MODEL', 'DECISION_MODEL', 'AGENT_MODE', 'CONTEXT_WINDOW', 'TOOL_OUTPUT_MAX_CHARS'] as const) {
    previousEnv[key] = process.env[key];
    delete process.env[key];
  }
  applyModelConfig();
});

describe('loadAppConfig', () => {
  test('returns empty config when file is missing', async () => {
    const config = await loadAppConfig(join(tempRoot, 'missing.json'));
    expect(config).toEqual({});
  });

  test('loads llmModel and decisionModel into process.env', async () => {
    await mkdir(tempRoot, { recursive: true });
    const configPath = join(tempRoot, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({ llmModel: 'custom/llm', decisionModel: 'custom/fl0w' }),
    );

    const config = await loadAppConfig(configPath);
    expect(config).toEqual({ llmModel: 'custom/llm', decisionModel: 'custom/fl0w' });
    expect(process.env.LLM_MODEL).toBe('custom/llm');
    expect(process.env.DECISION_MODEL).toBe('custom/fl0w');
    expect(LLM_MODEL).toBe('custom/llm');
    expect(DECISION_MODEL).toBe('custom/fl0w');
  });

  test('loads mode into process.env and AGENT_MODE', async () => {
    await mkdir(tempRoot, { recursive: true });
    const configPath = join(tempRoot, 'config.json');
    await writeFile(configPath, JSON.stringify({ mode: 'llm', llmModel: 'custom/llm' }));

    const config = await loadAppConfig(configPath);
    expect(config).toEqual({ mode: 'llm', llmModel: 'custom/llm' });
    expect(process.env.AGENT_MODE).toBe('llm');
    expect(AGENT_MODE).toBe('llm');
  });

  test('ignores invalid mode values', async () => {
    await mkdir(tempRoot, { recursive: true });
    const configPath = join(tempRoot, 'config.json');
    await writeFile(configPath, JSON.stringify({ mode: 'other' }));

    const config = await loadAppConfig(configPath);
    expect(config as Record<string, unknown>).toEqual({ mode: 'other' });
    expect(process.env.AGENT_MODE).toBeUndefined();
    expect(AGENT_MODE).toBe(DEFAULT_AGENT_MODE);
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

  test('loads toolOutputMaxChars into process.env and TOOL_OUTPUT_MAX_CHARS', async () => {
    await mkdir(tempRoot, { recursive: true });
    const configPath = join(tempRoot, 'config.json');
    await writeFile(configPath, JSON.stringify({ toolOutputMaxChars: 5_000 }));

    await loadAppConfig(configPath);
    expect(process.env.TOOL_OUTPUT_MAX_CHARS).toBe('5000');
    expect(TOOL_OUTPUT_MAX_CHARS).toBe(5_000);
  });
});

describe('ensureFl0wHome', () => {
  test('creates default home layout when missing', async () => {
    const home = join(tempRoot, 'fresh-home');
    await ensureFl0wHome(home);

    await access(join(home, 'tools'));
    await access(join(home, 'workspace'));

    const config = JSON.parse(await Bun.file(join(home, 'config.json')).text());
    expect(config).toEqual({
      llmModel: DEFAULT_LLM_MODEL,
      decisionModel: DEFAULT_DECISION_MODEL,
      mode: DEFAULT_AGENT_MODE,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      toolOutputMaxChars: DEFAULT_TOOL_OUTPUT_MAX_CHARS,
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
      decisionModel: DEFAULT_DECISION_MODEL,
      mode: DEFAULT_AGENT_MODE,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      toolOutputMaxChars: DEFAULT_TOOL_OUTPUT_MAX_CHARS,
      sync: true,
    });

    const mcpConfig = JSON.parse(await Bun.file(join(home, 'mcp.json')).text());
    expect(mcpConfig.mcpServers.demo).toEqual({ command: 'echo' });
  });

  test('drops the retired aiGatewayApiKey and aiProxy fields', async () => {
    const home = join(tempRoot, 'legacy-home');
    await mkdir(home, { recursive: true });
    await writeFile(join(home, 'config.json'), JSON.stringify({
      aiGatewayApiKey: 'old-key',
      aiProxy: true,
      llmModel: 'custom/model',
      decisionModel: DEFAULT_DECISION_MODEL,
      mode: DEFAULT_AGENT_MODE,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      sync: true,
    }));

    await ensureFl0wHome(home);

    const config = JSON.parse(await Bun.file(join(home, 'config.json')).text());
    expect(config).toEqual({
      llmModel: 'custom/model',
      decisionModel: DEFAULT_DECISION_MODEL,
      mode: DEFAULT_AGENT_MODE,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      toolOutputMaxChars: DEFAULT_TOOL_OUTPUT_MAX_CHARS,
      sync: true,
    });
  });
});
