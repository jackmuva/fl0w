import { GatewayAuthenticationError } from '@ai-sdk/gateway';
import { APICallError } from 'ai';

const isContextLimitError = (error: APICallError): boolean => {
  const statusCode = 'statusCode' in error ? (error as { statusCode?: number }).statusCode : undefined;
  if (statusCode === 413) return true;

  const message = error.message.toLowerCase();
  return (
    message.includes('context')
    || message.includes('token')
    || message.includes('too long')
    || message.includes('maximum')
    || message.includes('payload')
    || (statusCode === 400 && (
      message.includes('length')
      || message.includes('limit')
      || message.includes('request')
    ))
  );
};

const isMissingCredentialsError = (error: unknown): boolean => {
  for (let e = error; e; e = (e as { cause?: unknown }).cause) {
    if (GatewayAuthenticationError.isInstance(e)) return true;
    const message = e instanceof Error ? e.message : '';
    if (message.includes('Unauthenticated request to AI Gateway')) return true;
  }
  return false;
};

// AI Gateway rejects with 402 `quota_for_entity_exceeded`, which AI SDK may surface as a 500-class error.
const isBudgetExceededError = (error: unknown): boolean => {
  for (let e = error; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { statusCode?: number }).statusCode === 402) return true;
    const message = e instanceof Error ? e.message : '';
    if (message.includes('quota_for_entity_exceeded') || message.includes('Quota limit exceeded')) return true;
  }
  return false;
};

export const formatAgentRunError = (error: unknown): string => {
  if (isBudgetExceededError(error)) {
    return 'Your AI Gateway budget is used up. Set your own AI_GATEWAY_API_KEY (or config.json\'s aiGatewayApiKey) to keep going.';
  }
  if (isMissingCredentialsError(error)) {
    return 'No valid AI Gateway key. Run `fl0w login` to get one, or set AI_GATEWAY_API_KEY.';
  }
  if (APICallError.isInstance(error)) {
    if (isContextLimitError(error)) {
      return 'The conversation or tool output exceeded the model context limit. Large tool results were trimmed automatically; try a shorter task, disable unused MCP tools, or start a new session.';
    }
    const statusCode = 'statusCode' in error ? (error as { statusCode?: number }).statusCode : undefined;
    const prefix = statusCode != null ? `API error (${statusCode})` : 'API error';
    const detail = error.message.trim();
    const hint = statusCode === 401 ? ' Run `fl0w login` or set a valid AI_GATEWAY_API_KEY.' : '';
    return (detail ? `${prefix}: ${detail}` : prefix) + hint;
  }

  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'The agent run failed due to an unexpected error.';
};
