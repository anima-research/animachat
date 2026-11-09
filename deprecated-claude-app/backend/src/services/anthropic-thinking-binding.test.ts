import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import type { AddressInfo } from 'node:net';

// Run with: npx tsx --test src/services/anthropic-thinking-binding.test.ts
//
// Checks the request AnthropicService sends for a model entry with
// thinkingPrefixMismatch (Fable 5.2): thinking.block_binding in the body and
// the thinking-binding beta added to, not replacing, the default betas.

type Captured = { headers: http.IncomingHttpHeaders; body: any };

function sse(events: object[]): string {
  return events.map(e => `event: ${(e as any).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

async function withMockApi<T>(fn: (captured: Captured[]) => Promise<T>): Promise<T> {
  const captured: Captured[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      captured.push({ headers: req.headers, body: JSON.parse(raw) });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse([
        { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'claude-fable-5-2', stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 }, input_transformations: [] } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '1592' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
        { type: 'message_stop' },
      ]));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    return await fn(captured);
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = previous;
    server.close();
  }
}

const now = new Date();
const history: any[] = [
  { id: 'm1', conversationId: 'c', order: 0, activeBranchId: 'b1',
    branches: [{ id: 'b1', role: 'user', content: 'What is 37 * 43 - 19?', createdAt: now }] },
  { id: 'm2', conversationId: 'c', order: 1, activeBranchId: 'b2',
    branches: [{ id: 'b2', role: 'assistant', content: '1572', createdAt: now,
      contentBlocks: [
        { type: 'thinking', thinking: '37*43 = 1591, minus 19.', signature: 'sig-abc' },
        { type: 'text', text: '1572' },
      ] }] },
  { id: 'm3', conversationId: 'c', order: 2, activeBranchId: 'b3',
    branches: [{ id: 'b3', role: 'user', content: 'Add one.', createdAt: now }] },
];

async function send(hints: any, token = 'sk-ant-api03-test') {
  const { AnthropicService } = await import('./anthropic.js');
  const service = new AnthropicService({} as any, token);
  await service.streamCompletion(
    'claude-fable-5-2', history, 'Be brief.', { temperature: 1, maxTokens: 1000 } as any,
    async () => {}, undefined, 'summarized', hints,
  );
}

const FABLE_52_HINTS = { thinkingApi: 'always-on', effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsSampling: false };

test('thinkingPrefixMismatch sends block_binding and adds the beta to the defaults', async () => {
  await withMockApi(async captured => {
    await send({ ...FABLE_52_HINTS, thinkingPrefixMismatch: 'drop_block' });
    assert.equal(captured.length, 1);
    const { body, headers } = captured[0];
    assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
    assert.equal(headers['anthropic-beta'], 'extended-cache-ttl-2025-04-11,thinking-binding-controls-2026-08-01');
    // The signed thinking block is still replayed verbatim.
    assert.deepEqual(body.messages[1].content[0], { type: 'thinking', thinking: '37*43 = 1591, minus 19.', signature: 'sig-abc' });
    assert.equal(body.temperature, undefined);
  });
});

test('Claude Code tokens keep the oauth beta alongside the binding beta', async () => {
  // streamCompletion rebuilds its client from features.enableClaudeCodeTokens.
  const { ConfigLoader } = await import('../config/loader.js');
  const loader = ConfigLoader.getInstance() as any;
  const original = loader.loadConfig;
  loader.loadConfig = async () => ({ ...(await original.call(loader)), features: { enableClaudeCodeTokens: true } });
  try {
    await withMockApi(async captured => {
      await send({ ...FABLE_52_HINTS, thinkingPrefixMismatch: 'drop_block' }, 'sk-ant-oat-test');
      assert.equal(captured[0].headers.authorization, 'Bearer sk-ant-oat-test');
      assert.equal(captured[0].headers['anthropic-beta'], 'oauth-2025-04-20,extended-cache-ttl-2025-04-11,thinking-binding-controls-2026-08-01');
    });
  } finally {
    loader.loadConfig = original;
  }
});

test('models without the field send neither block_binding nor the beta', async () => {
  await withMockApi(async captured => {
    await send(FABLE_52_HINTS);
    const { body, headers } = captured[0];
    assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized' });
    assert.equal(headers['anthropic-beta'], 'extended-cache-ttl-2025-04-11');
  });
});
