/**
 * Verify the thinking-block signature lifecycle the app depends on:
 *   1. ThinkingContentBlockSchema accepts and round-trips a `signature`.
 *   2. JSON persistence (the event-log path) preserves it.
 *   3. The replay gate ("send structured iff signature present, else downgrade
 *      to <thinking> text") behaves correctly for signed, unsigned, and
 *      redacted blocks.
 *
 * Anthropic rejects continuations whose thinking blocks lack their signatures;
 * if any of these round-trips drop the field, the next turn 400s. This script
 * locks the contract in until the test suite (#112) is merged.
 *
 *   npx tsx scripts/verify-thinking-signature.ts   (exits non-zero on failure)
 */
import {
  ThinkingContentBlockSchema,
  RedactedThinkingContentBlockSchema,
  ContentBlockSchema,
} from '@deprecated-claude/shared';

let failed = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

console.log('# schema: signed thinking block round-trip');
const signed = { type: 'thinking' as const, thinking: 'step 1 → step 2', signature: 'sig-abc123' };
{
  const parsed = ThinkingContentBlockSchema.parse(signed);
  check('schema preserves .signature on parse', parsed.signature === 'sig-abc123');
  const roundtripped = ThinkingContentBlockSchema.parse(JSON.parse(JSON.stringify(parsed)));
  check('JSON persist round-trip preserves .signature', roundtripped.signature === 'sig-abc123');
}

console.log('\n# schema: unsigned thinking block (import / external) is accepted, signature undefined');
{
  const unsigned = { type: 'thinking' as const, thinking: 'imported step' };
  const parsed = ThinkingContentBlockSchema.parse(unsigned);
  check('schema accepts thinking without signature', parsed.signature === undefined);
}

console.log('\n# schema: redacted thinking carries .data, not .signature');
{
  const redacted = { type: 'redacted_thinking' as const, data: 'enc-payload-xyz' };
  const parsed = RedactedThinkingContentBlockSchema.parse(redacted);
  check('redacted thinking has .data', parsed.data === 'enc-payload-xyz');
}

console.log('\n# discriminated union: ContentBlockSchema dispatches by type correctly');
{
  const blocks = [
    { type: 'thinking' as const, thinking: 'a', signature: 's1' },
    { type: 'thinking' as const, thinking: 'unsigned' },
    { type: 'redacted_thinking' as const, data: 'r1' },
    { type: 'text' as const, text: 'hello' },
  ];
  const parsed = blocks.map((b) => ContentBlockSchema.parse(b));
  check('signed thinking via union retains signature', (parsed[0] as any).signature === 's1');
  check('unsigned thinking via union has undefined signature', (parsed[1] as any).signature === undefined);
  check('redacted via union retains data', (parsed[2] as any).data === 'r1');
  check('text via union retains text', (parsed[3] as any).text === 'hello');
}

console.log('\n# replay gate semantics (mirrors anthropic.ts apiContentBlocks builder)');
{
  // Inlined from anthropic.ts:585–609 to validate the gate's behaviour without
  // pulling the whole service. If the source logic ever changes, update here.
  function toApiBlocks(blocks: any[]): { api: any[]; downgradedText: string } {
    let downgradedText = '';
    const api: any[] = [];
    for (const block of blocks) {
      if (block.type === 'thinking') {
        if (block.signature) {
          api.push({ type: 'thinking', thinking: block.thinking, signature: block.signature });
        } else {
          downgradedText += `<thinking>\n${block.thinking}\n</thinking>\n\n`;
        }
      } else if (block.type === 'redacted_thinking') {
        api.push({ type: 'redacted_thinking', data: block.data });
      } else if (block.type === 'text') {
        api.push({ type: 'text', text: block.text });
      }
    }
    return { api, downgradedText };
  }

  const result = toApiBlocks([
    { type: 'thinking', thinking: 'reasoning A', signature: 'sigA' },
    { type: 'thinking', thinking: 'imported B' /* no signature */ },
    { type: 'redacted_thinking', data: 'rd-data' },
    { type: 'text', text: 'final answer' },
  ]);
  check('signed thinking goes through as structured', result.api[0]?.type === 'thinking' && result.api[0]?.signature === 'sigA');
  check('unsigned thinking is downgraded to <thinking> text (not sent structured)',
    !result.api.some((b) => b.type === 'thinking' && !b.signature) && result.downgradedText.includes('imported B'));
  check('redacted thinking emitted as structured with .data', result.api[1]?.type === 'redacted_thinking' && result.api[1]?.data === 'rd-data');
  check('text passes through', result.api[2]?.type === 'text' && result.api[2]?.text === 'final answer');
}

if (failed === 0) { console.log('\nPASS'); process.exit(0); }
console.error(`\nFAIL — ${failed} assertion(s) failed`);
process.exit(1);
