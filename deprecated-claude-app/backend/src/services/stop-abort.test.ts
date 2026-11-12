import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import type { AddressInfo } from 'node:net';

// Run with: npx tsx --test src/services/stop-abort.test.ts
//
// The Stop button aborts the generation's AbortSignal. The signal must cancel
// the provider request itself, not wait for the next chunk to reach the
// callback: during silent stretches (time to first token, ping-only periods)
// and after a post-facto stop sequence no chunk ever arrives there. A post-facto
// stop sequence must also cancel the request on its own, with no Stop press. Drives
// EnhancedInferenceService -> InferenceService -> AnthropicService -> SDK
// against a local mock API; only model lookup, API key and pricing are stubbed.

function event(e: any): string {
  return `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
}

type ApiState = { streaming: boolean; clientClosed: boolean; stopSequenceSentAt?: number; clientClosedAt?: number };

// Streams forever (every 20ms) until the client hangs up: either pings only, or the
// given text deltas followed by endless filler. The delta written as { stop } is the
// one that starts another participant's turn; the cancellation clock starts there. The mock ignores stop_sequences, like pseudo-prefill or upstreams
// that don't enforce them.
type ScriptDelta = string | { stop: string };

async function withEndlessApi<T>(script: 'pings' | ScriptDelta[], fn: (state: ApiState) => Promise<T>): Promise<T> {
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
        if (script === 'pings') {
          res.write(event({ type: 'ping' }));
        } else {
          const delta = script[i - 1] ?? `f${i} `;
          const text = typeof delta === 'string' ? delta : delta.stop;
          if (typeof delta !== 'string') state.stopSequenceSentAt = Date.now();
          res.write(event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }));
        }
      }, 20);
      res.on('close', () => {
        clearInterval(timer);
        state.clientClosed = true;
        state.clientClosedAt = Date.now();
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

type GenerateOptions = {
  thinking?: boolean;                      // prefill with <think> tags
  pseudoPrefill?: 'cat' | 'tail-cut';      // responder's conversationMode
};

async function generate(
  format: 'standard' | 'prefill',
  signal: AbortSignal,
  onChunk: (isComplete: boolean, chunk: string) => void | Promise<void>,
  options: GenerateOptions = {},
) {
  const { InferenceService } = await import('./inference.js');
  const { EnhancedInferenceService } = await import('./enhanced-inference.js');
  const { ContextManager } = await import('./context-manager.js');
  const testModel = { ...model, supportsThinking: !!options.thinking };
  const responder = options.pseudoPrefill
    ? { ...participants[1], conversationMode: 'pseudo-prefill', pseudoPrefillMode: options.pseudoPrefill }
    : participants[1];
  const testParticipants = [participants[0], responder];
  const base: any = new InferenceService({} as any);
  base.modelLoader = { getModelById: async () => testModel };
  base.apiKeyManager = {
    getApiKeyForRequest: async () => ({ source: 'user', credentials: { apiKey: 'sk-ant-api03-test' } }),
    checkRateLimits: async () => ({ allowed: true }),
  };
  const enhanced: any = new EnhancedInferenceService(base, new ContextManager());
  enhanced.calculateCostBreakdown = async () => new Proxy({}, { get: () => 0 });
  const conversation: any = { id: 'c', userId: 'u', format, model: model.id, title: 't', settings: {} };
  const settings: any = { temperature: 1, maxTokens: 4096 };
  if (options.thinking) settings.thinking = { enabled: true, budgetTokens: 1024 };
  await enhanced.streamCompletion(
    testModel, history, '', settings, 'u',
    async (chunk: string, isComplete: boolean) => onChunk(isComplete, chunk),
    conversation, responder, async () => {}, testParticipants, signal,
  );
}

// Without the cancellation the mock streams forever; fail instead of hanging.
async function withinDeadline<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error(`still streaming after ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(deadline));
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

// Each stop path in InferenceService: the model's text, and what the client should get.
const stopPaths: { name: string; script: ScriptDelta[]; expected: string; options?: GenerateOptions }[] = [
  {
    name: 'prefill',
    script: ['w1 ', 'w2 ', { stop: '\n\nUser: speaking for the user' }],
    expected: 'w1 w2',
  },
  {
    name: 'prefill with thinking, stop later in the response',
    script: ['<think>', 'pondering', '</think>\n\nanswer ', 'w2 ', { stop: '\n\nUser: speaking for the user' }],
    expected: 'answer w2',
    options: { thinking: true },
  },
  {
    name: 'prefill with thinking, stop right after </think>',
    script: ['<think>', 'pondering', { stop: '</think>\n\nUser: speaking for the user' }],
    expected: '',
    options: { thinking: true },
  },
  {
    name: 'pseudo-prefill cat',
    script: ['User: Hello\n\nClaude: ', 'This is the reply, long enough to pass the fifty-character mark. ', 'w2 ', { stop: '\n\nUser: speaking for the user' }],
    expected: 'This is the reply, long enough to pass the fifty-character mark. w2',
    options: { pseudoPrefill: 'cat' },
  },
  {
    name: 'pseudo-prefill tail-cut',
    script: ['Claude: hi there ', 'w2 ', { stop: '\n\nUser: speaking for the user' }],
    expected: 'hi there w2',
    options: { pseudoPrefill: 'tail-cut' },
  },
];

for (const path of stopPaths) {
  test(`A post-facto stop sequence cancels the request and completes normally: ${path.name}`, { timeout: 5000 }, async () => {
    await withEndlessApi(path.script, async state => {
      const userStop = new AbortController();
      let text = '';
      let completions = 0;
      await withinDeadline(generate('prefill', userStop.signal, (isComplete, chunk) => {
        text += chunk;
        if (isComplete) completions++;
      }, path.options));
      assert.equal(text.trimEnd(), path.expected, 'the text is cut at the stop sequence');
      assert.equal(completions, 1);
      assert.equal(userStop.signal.aborted, false, 'the user signal was touched');
      assert.equal(await closedWithin(state, 1000), true, 'the HTTP request was not cancelled');
      const lag = state.clientClosedAt! - state.stopSequenceSentAt!;
      assert.ok(lag < 100, `request cancelled ${lag}ms after the stop sequence`);
    });
  });
}

test('A failure saving the cut reply is not hidden by the cancellation', { timeout: 5000 }, async () => {
  await withEndlessApi(stopPaths[0].script, async state => {
    await assert.rejects(
      withinDeadline(generate('prefill', new AbortController().signal, isComplete => {
        if (isComplete) throw new Error('save failed');
      })),
      /save failed/,
    );
    assert.equal(await closedWithin(state, 1000), true, 'the HTTP request was not cancelled');
  });
});
