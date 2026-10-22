import { createHash, randomBytes } from 'node:crypto';
import { FL0W_API_URL } from '../../constants';
import type { Fl0wAuth } from '../../models/auth';
import { openBrowser } from '../utils';
import { callbackUrl, listenForAuthCode } from './callback-server';
import { requestTokens, saveFl0wAuth } from './token';

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

  const auth = await requestTokens({ grant_type: 'authorization_code', code: await code, code_verifier: codeVerifier });
  await saveFl0wAuth(auth);
  return auth;
}
