import assert from 'node:assert/strict';
import test from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { anthropicClientOptions, CLAUDE_CODE_PREFIX, isAnthropicOAuthToken, withClaudeCodePrefix } from './anthropic-auth.js';

test('OAuth tokens use Bearer authentication; API keys use x-api-key', async () => {
  for (const [token, oauth] of [
    ['sk-ant-oat-example', true],
    ['eyJexample', true],
    ['sk-ant-api03-example', false],
  ] as const) {
    assert.equal(isAnthropicOAuthToken(token), oauth);
    let headers: Headers | undefined;
    const client = new Anthropic({
      ...anthropicClientOptions(token, true),
      fetch: async (_url, init) => {
        headers = new Headers(init?.headers);
        return new Response(JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'test', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    await client.messages.create({ model: 'test', max_tokens: 1, messages: [{ role: 'user', content: 'Hi' }] });
    assert.equal(headers?.get('authorization'), oauth ? `Bearer ${token}` : null);
    assert.equal(headers?.get('x-api-key'), oauth ? null : token);
  }
});

test('OAuth token uses API key authentication when the feature is disabled', async () => {
  let headers: Headers | undefined;
  const client = new Anthropic({
    ...anthropicClientOptions('sk-ant-oat-example', false),
    fetch: async (_url, init) => {
      headers = new Headers(init?.headers);
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    },
  });
  await client.messages.create({ model: 'test', max_tokens: 1, messages: [{ role: 'user', content: 'Hi' }] });
  assert.equal(headers?.get('authorization'), null);
  assert.equal(headers?.get('x-api-key'), 'sk-ant-oat-example');
});

test('Claude Code identity is the first system block exactly once', () => {
  const prefix = { type: 'text', text: CLAUDE_CODE_PREFIX };
  assert.deepEqual(withClaudeCodePrefix(undefined), [prefix]);
  assert.deepEqual(withClaudeCodePrefix('Persona'), [prefix, { type: 'text', text: 'Persona' }]);
  const cached = { type: 'text', text: 'Persona', cache_control: { type: 'ephemeral' } };
  assert.deepEqual(withClaudeCodePrefix([cached]), [prefix, cached]);
  assert.deepEqual(withClaudeCodePrefix([prefix, cached]), [prefix, cached]);
});
