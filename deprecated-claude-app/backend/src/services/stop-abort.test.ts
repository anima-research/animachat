import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import type { AddressInfo } from 'node:net';

// Run with: npx tsx --test src/services/stop-abort.test.ts
//
// The Stop button aborts the generation's AbortSignal. The signal must cancel
// the provider request itself, not wait for the next chunk to reach the
// callback: during silent stretches (time to first token, ping-only periods)
// and after a post-facto stop sequence no chunk ever arrives there. Drives
// EnhancedInferenceService -> InferenceService -> AnthropicService -> SDK
// against a local mock API; only model lookup, API key and pricing are stubbed.

function event(e: any): string {
  return `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
}

type ApiState = { streaming: boolean; clientClosed: boolean };

// Streams forever (every 20ms) until the client hangs up: either pings only, or
// text that turns into another participant's turn after a few deltas.
async function withEndlessApi<T>(mode: 'pings' | 'stop-sequence', fn: (state: ApiState) => Promise<T>): Promise<T> {
  const state: ApiState = { streaming: false, clientClosed: false };
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      state.streaming = true;
      res.write(event({ type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'claude-test', stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } }));
      res.write(event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
      let i = 0;
      const timer = setInterval(() => {
        i++;
        if (mode === 'pings') {
          res.write(event({ type: 'ping' }));
        } else {
          // The mock ignores stop_sequences, like pseudo-prefill or upstreams that don't enforce them
          const text = i === 3 ? '\n\nUser: speaking for the user' : `w${i} `;
          res.write(event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }));
        }
      }, 20);
      res.on('close', () => {
        clearInterval(timer);
        state.clientClosed = true;
      });
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    return await fn(state);
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = previous;
    server.closeAllConnections();
    server.close();
  }
}

// Presses Stop once the response is streaming (not while the request is still being built).
// Returns a cleanup that cancels the pending press, for tests that fail before it happens.
function stopAfterStreaming(state: ApiState, controller: AbortController, delayMs: number): () => void {
  let press: ReturnType<typeof setTimeout> | undefined;
  const poll = setInterval(() => {
    if (state.streaming) {
      clearInterval(poll);
      press = setTimeout(() => controller.abort(), delayMs);
    }
  }, 5);
  return () => {
    clearInterval(poll);
    clearTimeout(press);
  };
}

async function closedWithin(state: ApiState, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!state.clientClosed && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return state.clientClosed;
}

const model: any = {
  id: 'test-model', provider: 'anthropic', providerModelId: 'claude-test', displayName: 'Test',
  contextWindow: 200000, outputTokenLimit: 8192, supportsPrefill: true, supportsThinking: false,
  supportsPromptCaching: false,
};
const participants: any[] = [
  { id: 'p-user', name: 'User', type: 'user', conversationId: 'c', isActive: true },
  { id: 'p-claude', name: 'Claude', type: 'assistant', model: model.id, conversationId: 'c', isActive: true },
];
const history: any[] = [
  { id: 'm1', conversationId: 'c', order: 0, activeBranchId: 'b1',
    branches: [{ id: 'b1', role: 'user', content: 'Hello', createdAt: new Date(), parentBranchId: 'root', participantId: 'p-user' }] },
];

async function generate(format: 'standard' | 'prefill', signal: AbortSignal, onChunk: (isComplete: boolean) => void) {
  const { InferenceService } = await import('./inference.js');
  const { EnhancedInferenceService } = await import('./enhanced-inference.js');
  const { ContextManager } = await import('./context-manager.js');
  const base: any = new InferenceService({} as any);
  base.modelLoader = { getModelById: async () => model };
  base.apiKeyManager = {
    getApiKeyForRequest: async () => ({ source: 'user', credentials: { apiKey: 'sk-ant-api03-test' } }),
    checkRateLimits: async () => ({ allowed: true }),
  };
  const enhanced: any = new EnhancedInferenceService(base, new ContextManager());
  enhanced.calculateCostBreakdown = async () => new Proxy({}, { get: () => 0 });
  const conversation: any = { id: 'c', userId: 'u', format, model: model.id, title: 't', settings: {} };
  await enhanced.streamCompletion(
    model, history, '', { temperature: 1, maxTokens: 4096 }, 'u',
    async (_chunk: string, isComplete: boolean) => onChunk(isComplete),
    conversation, participants[1], async () => {}, participants, signal,
  );
}

test('Stop cancels the request while the stream is silent', { timeout: 5000 }, async t => {
  await withEndlessApi('pings', async state => {
    const controller = new AbortController();
    t.after(stopAfterStreaming(state, controller, 200));
    const started = Date.now();
    await assert.rejects(generate('standard', controller.signal, () => {}), /Generation aborted/);
    assert.ok(Date.now() - started < 1500, `settled after ${Date.now() - started}ms`);
    assert.equal(await closedWithin(state, 1000), true, 'the HTTP request was not cancelled');
  });
});

test('Stop cancels the request after a post-facto stop sequence swallowed the rest', { timeout: 5000 }, async t => {
  await withEndlessApi('stop-sequence', async state => {
    const controller = new AbortController();
    let completedEarly = false;
    t.after(stopAfterStreaming(state, controller, 300));
    const started = Date.now();
    await assert.rejects(
      generate('prefill', controller.signal, isComplete => { if (isComplete) completedEarly = true; }),
      /Generation aborted/,
    );
    assert.equal(completedEarly, true, 'the client was told the message is complete before Stop');
    assert.ok(Date.now() - started < 1500, `settled after ${Date.now() - started}ms`);
    assert.equal(await closedWithin(state, 1000), true, 'the HTTP request was not cancelled');
  });
});
