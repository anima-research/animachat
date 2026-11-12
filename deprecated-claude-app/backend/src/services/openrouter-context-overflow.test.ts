import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The request loggers write under process.cwd()/logs; keep them out of the repo.
process.chdir(mkdtempSync(path.join(tmpdir(), 'arc-openrouter-test-')));

const { estimateAttachmentTokens } = await import('./attachment-utils.js');
const { describeErrorResponse, OpenRouterService } = await import('./openrouter.js');
const { InferenceService } = await import('./inference.js');

// OpenRouter's reply to a request whose input plus max_tokens exceed the window.
const OVERFLOW_BODY = JSON.stringify({
  error: {
    message: "This endpoint's maximum context length is 1048576 tokens. However, you requested about 1146223 tokens (202505 of text input, 943718 in the output). Please reduce the length of either one, or use the context-compression plugin to compress your prompt automatically.",
    code: 400,
    metadata: { provider_name: null },
  },
});

function jsonResponse(status: number, statusText: string, body: string) {
  return new Response(body, { status, statusText, headers: { 'Content-Type': 'application/json' } });
}

function withFetch(fake: (url: string, init: any) => Promise<Response>, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = fake as typeof fetch;
  return run().finally(() => { globalThis.fetch = original; });
}

function userMessage(content: string, attachments: any[] = []) {
  const branchId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    conversationId: crypto.randomUUID(),
    activeBranchId: branchId,
    order: 0,
    branches: [{ id: branchId, role: 'user', content, createdAt: new Date(), attachments }],
  } as any;
}

test('estimateAttachmentTokens counts text, prices images flat and skips binary files', () => {
  assert.equal(estimateAttachmentTokens({ fileName: 'notes.md', content: 'x'.repeat(4000) }), 1016);
  assert.equal(estimateAttachmentTokens({ fileName: 'photo.PNG', content: 'A'.repeat(4_000_000) }), 1500);
  assert.equal(estimateAttachmentTokens({ fileName: 'paper.pdf', content: 'A'.repeat(4_000_000) }), 0);
  assert.equal(estimateAttachmentTokens({ fileName: 'talk.mp3', content: 'A'.repeat(4_000_000) }), 0);
  assert.equal(estimateAttachmentTokens({ fileName: 'empty.txt', content: '' }), 0);
});

test('describeErrorResponse surfaces the reason OpenRouter gives', async () => {
  assert.equal(
    await describeErrorResponse(jsonResponse(400, 'Bad Request', OVERFLOW_BODY)),
    `OpenRouter API error (400): ${JSON.parse(OVERFLOW_BODY).error.message}`,
  );
  // Upstream failures carry the provider's own reply in metadata.raw.
  const upstream = JSON.stringify({
    error: { message: 'Provider returned error', code: 400, metadata: { provider_name: 'Google', raw: 'Request contains an invalid argument.' } },
  });
  assert.equal(
    await describeErrorResponse(jsonResponse(400, 'Bad Request', upstream)),
    'OpenRouter API error (400): Provider returned error (Google: Request contains an invalid argument.)',
  );
  assert.equal(
    await describeErrorResponse(new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' })),
    'OpenRouter API error (502): <html>bad gateway</html>',
  );
  assert.equal(
    await describeErrorResponse(new Response('', { status: 503, statusText: 'Service Unavailable' })),
    'OpenRouter API error (503): Service Unavailable',
  );
});

test('a request OpenRouter rejects is reported with its reason and not charged', async () => {
  const service = new OpenRouterService({} as any, 'test-key');
  const completions: any[] = [];
  await withFetch(async () => jsonResponse(400, 'Bad Request', OVERFLOW_BODY), async () => {
    await assert.rejects(
      service.streamCompletion('google/gemini-test', [userMessage('hi')], undefined, { temperature: 1, maxTokens: 943718 } as any,
        async (_chunk, isComplete, _blocks, usage) => { if (isComplete) completions.push(usage); }),
      /OpenRouter API error \(400\): This endpoint's maximum context length is 1048576 tokens/,
    );
  });
  assert.deepEqual(completions, [], 'no failure usage is recorded for a rejected request');
});

test('a request that fails after OpenRouter accepted it is still charged', async () => {
  const service = new OpenRouterService({} as any, 'test-key');
  const completions: any[] = [];
  const brokenStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'));
      controller.error(new Error('connection reset'));
    },
  });
  await withFetch(async () => new Response(brokenStream, { status: 200 }), async () => {
    await assert.rejects(
      service.streamCompletion('google/gemini-test', [userMessage('hi')], undefined, { temperature: 1, maxTokens: 1000 } as any,
        async (_chunk, isComplete, _blocks, usage) => { if (isComplete) completions.push(usage); }),
      /connection reset/,
    );
  });
  assert.equal(completions.length, 1);
  assert.equal(completions[0].failed, true);
  assert.ok(completions[0].inputTokens > 0);
});

test('max_tokens is clamped to the context left after a large text attachment', async () => {
  // The failing conversation: a custom OpenRouter model whose max tokens
  // default to the provider's output limit, and a ~1.86M-character archive
  // attached to a one-word message.
  const model = {
    id: 'custom-gemini', provider: 'openrouter', providerModelId: 'google/gemini-test',
    displayName: 'Gemini', contextWindow: 1048576, outputTokenLimit: 943718,
    supportsThinking: true, supportsPrefill: false,
  };
  const archive = 'lorem ipsum dolor sit amet '.repeat(68_717); // 1,855,359 chars
  const service = new InferenceService({} as any);
  (service as any).modelLoader = { getModelById: async () => model };
  (service as any).apiKeyManager = {
    getApiKeyForRequest: async () => ({ source: 'user', credentials: { apiKey: 'test-key' } }),
    trackUsage: async () => {},
  };

  let sent: any;
  await withFetch(async (_url, init) => {
    sent = JSON.parse(init.body);
    return jsonResponse(400, 'Bad Request', OVERFLOW_BODY);
  }, async () => {
    await service.streamCompletion(
      'custom-gemini',
      [userMessage('here', [{ id: crypto.randomUUID(), fileName: 'archive.md', fileType: 'md', fileSize: archive.length, content: archive, encoding: 'text', createdAt: new Date() }])],
      undefined,
      { temperature: 1, maxTokens: 943718 } as any,
      'user-1',
      async () => {},
    ).catch(() => {});
  });

  assert.ok(sent, 'the request reached fetch');
  const sentText = JSON.stringify(sent.messages);
  assert.ok(sentText.includes(archive.slice(0, 1000)), 'the attachment is inlined into the request');
  // OpenRouter's own check counts ~4 characters per token of text input.
  const inputTokens = Math.ceil(archive.length / 4);
  assert.ok(sent.max_tokens < 943718, `max_tokens was clamped (sent ${sent.max_tokens})`);
  assert.ok(inputTokens + sent.max_tokens <= 1048576, `input + max_tokens fits the window (sent ${sent.max_tokens})`);
  assert.ok(sent.max_tokens > 500_000, `the clamp leaves the rest of the window for output (sent ${sent.max_tokens})`);
});
