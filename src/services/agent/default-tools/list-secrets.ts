import { jsonSchema, tool } from 'ai';
import { SECRETS_PATH } from '../../../constants';
import { readSecrets, secretEnvName, secretFields } from '../../secrets/secret-store';

const listSecretsInputSchema = jsonSchema<Record<string, never>>({ type: 'object', properties: {} });

export const listSecretsDescription = `Lists the credentials (usernames, passwords, tokens) the user has made available for this session. You never see the values:
- In the browser, fill a field with browser_fill using {"secret": "<name>.<field>"} instead of "value". Each secret only works on the sites the user allowed.
- If a secret lists bash environment variables, reference them in commands (e.g. "$FL0W_SECRET_GITHUB_TOKEN") without echoing them.
Secret values that appear in any tool output are masked as [secret <name>.<field>].
If a credential you need is missing, ask the user to add it with \`fl0w secrets add <name>\`; never ask them to paste a password into the chat.`;

export const executeListSecrets = async (): Promise<string> => {
  const secrets = await readSecrets();
  const entries = Object.entries(secrets);
  if (entries.length === 0) {
    return `No secrets configured. The user can add one with \`fl0w secrets add <name> --domain <site>\` (stored in ${SECRETS_PATH}).`;
  }
  return entries.map(([name, entry]) => {
    const fields = secretFields(entry).map(([field]) => field);
    return [
      `- ${name}${entry.description ? `: ${entry.description}` : ''}`,
      `  fields: ${fields.map((field) => `${name}.${field}`).join(', ') || '(none)'}`,
      `  browser sites: ${entry.domains?.length ? entry.domains.join(', ') : '(none; cannot be used in the browser)'}`,
      ...(entry.env === true ? [`  bash env: ${fields.map((field) => `$${secretEnvName(name, field)}`).join(', ')}`] : []),
    ].join('\n');
  }).join('\n');
};

export const listSecretsTool = tool({
  description: listSecretsDescription,
  inputSchema: listSecretsInputSchema,
  execute: executeListSecrets,
});

export const listSecretsToolSchema = listSecretsInputSchema.jsonSchema as Record<string, unknown>;
