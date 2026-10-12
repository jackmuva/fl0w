import { FL0W_API_URL } from '../../constants';
import { login } from './login';
import { clearFl0wAuth, readFl0wAuth } from './token';

export async function runAccountCommand(command: string): Promise<number> {
  try {
    if (command === 'login') {
      const auth = await login();
      console.log(process.env.AI_GATEWAY_API_KEY
        ? `Signed in as ${auth.user.email}. An AI Gateway key is set (AI_GATEWAY_API_KEY or config.json's aiGatewayApiKey), so model calls will use it instead of ${FL0W_API_URL}.`
        : `Signed in as ${auth.user.email}. Model calls will go through ${FL0W_API_URL}.`);
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
