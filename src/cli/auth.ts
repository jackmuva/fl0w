import { configSyncStore } from '../services/sync/config-sync';
import { outboxStore } from '../services/sync/outbox';
import { FL0W_API_URL } from '../constants';
import type { Fl0wAuth } from '../models/auth';
import { authService} from '../services/auth/auth-service';
import { createHash, randomBytes } from 'node:crypto';
import { openBrowser } from '../services/utils';
import { callbackUrl, listenForAuthCode } from '../services/mcp/callback-server';

export async function login(log: (line: string) => void = console.log): Promise<Fl0wAuth> {
  const state = crypto.randomUUID();
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const { port, code } = listenForAuthCode(0, state);
  const loginUrl = new URL(`${FL0W_API_URL}/cli/login`);
  loginUrl.searchParams.set('redirect_uri', callbackUrl(port));
  loginUrl.searchParams.set('state', state);
  loginUrl.searchParams.set('code_challenge', codeChallenge);

  log(`Opening your browser to sign in. If it doesn't open, visit:\n${loginUrl}`);
  openBrowser(loginUrl.toString());

  const auth = await authService.requestTokens({ grant_type: 'authorization_code', code: await code, code_verifier: codeVerifier });
  await authService.saveFl0wAuth(auth);
  return auth;
}

export async function runAccountCommand(command: string): Promise<number> {
  try {
    if (command === 'login') {
      const auth = await login();
      console.log(`Signed in as ${auth.user.email}.`);
      await reportLoginSync();
      return 0;
    }
    if (command === 'logout') {
      await authService.clearFl0wAuth();
      console.log('Signed out.');
      return 0;
    }
    const auth = await authService.readFl0wAuth();
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
    const results = await configSyncStore.syncConfigFiles();
    if (!results) return;
    const failed = Object.entries(results ?? {}).filter(([, r]) => r instanceof Error);
    if (failed.length) console.log(`Config sync incomplete: ${failed.map(([f, r]) => `${f}: ${(r as Error).message}`).join('; ')}`);
    else console.log('Config synced with fl0w-work.');
  } catch (error) {
    console.log(`Config sync failed: ${error instanceof Error ? error.message : String(error)}. It will retry on next start.`);
  }
  // session and workflow writes left from before a sign-in expired
  await outboxStore.flushOutbox();
}
