import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AI_GATEWAY_API_KEY_PLACEHOLDER, DEFAULT_LLM_MODEL } from '../../constants';
import { ensureJevHome, loadAppConfig } from './app-config';

const tempRoot = join(import.meta.dir, '__fixtures__', 'app-config');
let previousApiKey: string | undefined;

afterEach(async () => {
  if (previousApiKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = previousApiKey;
  await rm(tempRoot, { recursive: true, force: true });
});

beforeEach(() => {
  previousApiKey = process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
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
});

describe('ensureJevHome', () => {
  test('creates default home layout when missing', async () => {
    const home = join(tempRoot, 'fresh-home');
    await ensureJevHome(home);

    await access(join(home, 'tools'));

    const config = JSON.parse(await Bun.file(join(home, 'config.json')).text());
    expect(config).toEqual({
      aiGatewayApiKey: AI_GATEWAY_API_KEY_PLACEHOLDER,
      llmModel: DEFAULT_LLM_MODEL,
    });

    const mcpConfig = JSON.parse(await Bun.file(join(home, 'mcp.json')).text());
    expect(mcpConfig).toEqual({ mcpServers: {} });
  });

  test('does not overwrite existing config files', async () => {
    const home = join(tempRoot, 'existing-home');
    await mkdir(home, { recursive: true });
    await writeFile(join(home, 'config.json'), JSON.stringify({ llmModel: 'custom/model' }));
    await writeFile(join(home, 'mcp.json'), JSON.stringify({ mcpServers: { demo: { command: 'echo' } } }));

    await ensureJevHome(home);

    const config = JSON.parse(await Bun.file(join(home, 'config.json')).text());
    expect(config).toEqual({ llmModel: 'custom/model' });

    const mcpConfig = JSON.parse(await Bun.file(join(home, 'mcp.json')).text());
    expect(mcpConfig.mcpServers.demo).toEqual({ command: 'echo' });
  });
});
