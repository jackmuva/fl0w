import { saveFl0wGatewayKey } from '../config/app-config';
import { syncConfigFiles } from '../sync/config-sync';
import { login } from './login';
import { clearFl0wAuth, readFl0wAuth } from './token';

export async function runAccountCommand(command: string): Promise<number> {
  try {
    if (command === 'login') {
      const { auth, aiGatewayApiKey } = await login();
      if (!aiGatewayApiKey) {
        console.log(`Signed in as ${auth.user.email}, but fl0w couldn't issue an AI Gateway key. Try \`fl0w login\` again later, or set AI_GATEWAY_API_KEY.`);
      } else if (await saveFl0wGatewayKey(aiGatewayApiKey)) {
        console.log(`Signed in as ${auth.user.email}. Your fl0w AI Gateway key was saved to config.json.`);
      } else {
        console.log(`Signed in as ${auth.user.email}. Keeping your own AI Gateway key (AI_GATEWAY_API_KEY or config.json's aiGatewayApiKey); remove it and run \`fl0w login\` again to use fl0w's key.`);
      }
      await reportLoginSync();
      return 0;
    }
    if (command === 'logout') {
      await clearFl0wAuth();
      console.log('Signed out.');
      return 0;
    }
    const auth = await readFl0wAuth();
    console.log(auth ? `Signed in as ${auth.user.email}` : 'Not signed in. Run `fl0w login`.');
    return auth ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/** A fresh login pulls config (MCP auth, settings) other devices already synced, and pushes this device's. */
async function reportLoginSync() {
  try {
    const results = await syncConfigFiles();
    if (!results) return;
    const failed = Object.entries(results ?? {}).filter(([, r]) => r instanceof Error);
    if (failed.length) console.log(`Config sync incomplete: ${failed.map(([f, r]) => `${f}: ${(r as Error).message}`).join('; ')}`);
    else console.log('Config synced with fl0w-work.');
  } catch (error) {
    console.log(`Config sync failed: ${error instanceof Error ? error.message : String(error)}. It will retry on next start.`);
  }
}
