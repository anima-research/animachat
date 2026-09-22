export const CLAUDE_CODE_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude.";

export function isAnthropicOAuthToken(token: string): boolean {
  return !token.startsWith('sk-ant-api') &&
    (token.startsWith('sk-ant-') || token.startsWith('eyJ'));
}

export function anthropicClientOptions(token: string, allowOAuth: boolean) {
  return allowOAuth && isAnthropicOAuthToken(token)
    ? { apiKey: null, authToken: token }
    : { apiKey: token, authToken: null };
}

export function withClaudeCodePrefix(system: unknown): unknown {
  const blocks = typeof system === 'string'
    ? system ? [{ type: 'text', text: system }] : []
    : Array.isArray(system) ? system : [];
  if (blocks[0]?.type === 'text' && blocks[0]?.text === CLAUDE_CODE_PREFIX) return blocks;
  return [{ type: 'text', text: CLAUDE_CODE_PREFIX }, ...blocks];
}
