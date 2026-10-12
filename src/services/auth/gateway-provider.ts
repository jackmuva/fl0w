import { createGateway } from '@ai-sdk/gateway';
import { FL0W_API_URL } from '../../constants';
import { getAccessToken } from './token';

const withToken = (init: RequestInit | undefined, token: string): RequestInit => {
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${token}`);
  return { ...init, headers };
};

const authedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const res = await fetch(input, withToken(init, await getAccessToken()));
  if (res.status !== 401) return res;
  // fetch drops Authorization on cross-origin redirects (e.g. apex -> www), so the token never arrives.
  if (res.redirected) {
    throw new Error(`fl0w API redirected to ${new URL(res.url).origin}; set FL0W_API_URL to that origin.`);
  }
  // Token may have been revoked or expired early; refresh once and retry.
  return fetch(input, withToken(init, await getAccessToken({ force: true })));
};

export function installFl0wGateway(): void {
  globalThis.AI_SDK_DEFAULT_PROVIDER = createGateway({
    baseURL: `${FL0W_API_URL}/api/ai`,
    // Replaced per request by authedFetch.
    apiKey: 'fl0w',
    fetch: authedFetch as typeof fetch,
  });
}
