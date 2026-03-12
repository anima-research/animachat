import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkContent, checkMessages, checkContentSync, type FilterResult, type UserContext } from './content-filter.js';

// Helper to build a moderation API response
function buildModerationResponse(categoryScores: Record<string, number>): {
  id: string;
  model: string;
  results: Array<{
    flagged: boolean;
    categories: Record<string, boolean>;
    category_scores: Record<string, number>;
  }>;
} {
  const defaultScores: Record<string, number> = {
    'harassment': 0.0,
    'harassment/threatening': 0.0,
    'hate': 0.0,
    'hate/threatening': 0.0,
    'illicit': 0.0,
    'illicit/violent': 0.0,
    'self-harm': 0.0,
    'self-harm/intent': 0.0,
    'self-harm/instructions': 0.0,
    'sexual': 0.0,
    'sexual/minors': 0.0,
    'violence': 0.0,
    'violence/graphic': 0.0,
    ...categoryScores,
  };

  const categories: Record<string, boolean> = {};
  for (const [key, score] of Object.entries(defaultScores)) {
    categories[key] = score > 0.5;
  }

  return {
    id: 'modr-test-123',
    model: 'omni-moderation-latest',
    results: [{
      flagged: Object.values(defaultScores).some(s => s > 0.5),
      categories,
      category_scores: defaultScores,
    }],
  };
}

// Mock fetch globally
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
  // Provide an API key so the moderation API is called
  vi.stubEnv('OPENAI_API_KEY', 'sk-test-key-123456');
  // Suppress console output during tests
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  // Clear the cached API key by re-importing or resetting module state
});

// Reset the module between tests to clear the cachedApiKey
beforeEach(async () => {
  vi.resetModules();
});

function setupFetchResponse(categoryScores: Record<string, number>) {
  const response = buildModerationResponse(categoryScores);
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => response,
  });
}

function setupFetchError(status: number, statusText: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText,
  });
}

// ── checkContentSync ─────────────────────────────────────────────

describe('checkContentSync', () => {
  it('returns blocked: false for benign content', () => {
    const result = checkContentSync('Hello, how are you today?');
    expect(result.blocked).toBe(false);
  });

  it('returns blocked: false for empty string', () => {
    expect(checkContentSync('').blocked).toBe(false);
  });

  it('returns blocked: false for null/undefined input', () => {
    expect(checkContentSync(null as any).blocked).toBe(false);
    expect(checkContentSync(undefined as any).blocked).toBe(false);
  });

  it('blocks content matching critical hate speech patterns', () => {
    const result = checkContentSync('kill all jews');
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('Message contains prohibited content');
  });

  it('blocks content matching slur patterns with leet-speak substitutions', () => {
    const result = checkContentSync('you are a n1gger');
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('Message contains prohibited content');
  });

  it('is case-insensitive for pattern matching', () => {
    const result = checkContentSync('GAS THE JEWS');
    expect(result.blocked).toBe(true);
  });

  it('does not block content with partial matches that are not the full pattern', () => {
    const result = checkContentSync('I killed my todo list');
    expect(result.blocked).toBe(false);
  });
});

// ── checkContent — Admin bypass ──────────────────────────────────

describe('checkContent — admin bypass', () => {
  it('allows any content for admin users without calling the API', async () => {
    const result = await checkContent('extremely bad content', { isAdmin: true });
    expect(result.blocked).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── checkContent — empty/invalid input ───────────────────────────

describe('checkContent — empty/invalid input', () => {
  it('allows empty string without calling API', async () => {
    const result = await checkContent('');
    expect(result.blocked).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('allows whitespace-only string without calling API', async () => {
    const result = await checkContent('   \n\t  ');
    expect(result.blocked).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('allows non-string input without calling API', async () => {
    const result = await checkContent(null as any);
    expect(result.blocked).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── checkContent — no API key ────────────────────────────────────

describe('checkContent — no API key configured', () => {
  it('allows content when no OpenAI API key is available (fail open)', async () => {
    vi.unstubAllEnvs();
    // Need to reimport to reset the cached key
    vi.resetModules();
    const { checkContent: freshCheckContent } = await import('./content-filter.js');

    // Ensure no env key
    delete process.env.OPENAI_API_KEY;

    const result = await freshCheckContent('some content');
    expect(result.blocked).toBe(false);
  });
});

// ── checkContent — TIER 1: Always-blocked categories ─────────────

describe('checkContent — always-blocked categories', () => {
  it('blocks content with sexual/minors score at critical threshold (0.5)', async () => {
    setupFetchResponse({ 'sexual/minors': 0.5 });
    const result = await checkContent('test content');
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain('sexual/minors');
    expect(result.reason).toContain('prohibited content');
  });

  it('blocks content with sexual/minors score above critical threshold', async () => {
    setupFetchResponse({ 'sexual/minors': 0.8 });
    const result = await checkContent('test content');
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain('sexual/minors');
  });

  it('allows content with sexual/minors score below critical threshold (0.49)', async () => {
    setupFetchResponse({ 'sexual/minors': 0.49 });
    const result = await checkContent('test content');
    expect(result.blocked).toBe(false);
  });

  it('blocks content with self-harm/instructions score at critical threshold', async () => {
    setupFetchResponse({ 'self-harm/instructions': 0.5 });
    const result = await checkContent('test content');
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain('self-harm/instructions');
  });

  it('blocks even for researcher users (no exemption for always-blocked)', async () => {
    setupFetchResponse({ 'sexual/minors': 0.8 });
    const result = await checkContent('test content', { isResearcher: true });
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain('sexual/minors');
  });

  it('blocks even for age-verified users (no exemption for always-blocked)', async () => {
    setupFetchResponse({ 'sexual/minors': 0.8 });
    const result = await checkContent('test content', { isAgeVerified: true });
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain('sexual/minors');
  });

  it('reports multiple always-blocked categories when both are violated', async () => {
    setupFetchResponse({ 'sexual/minors': 0.6, 'self-harm/instructions': 0.7 });
    const result = await checkContent('test content');
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain('sexual/minors');
    expect(result.categories).toContain('self-harm/instructions');
    expect(result.categories).toHaveLength(2);
  });
});

// ── checkContent — TIER 2: Age-restricted categories ─────────────

describe('checkContent — age-restricted categories', () => {
  it('blocks sexual content for non-age-verified user at blocking threshold (0.7)', async () => {
    setupFetchResponse({ 'sexual': 0.7 });
    const result = await checkContent('test content');
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain('sexual');
    expect(result.reason).toContain('age-restricted');
  });

  it('blocks sexual content for non-age-verified user above blocking threshold', async () => {
    setupFetchResponse({ 'sexual': 0.9 });
    const result = await checkContent('test content', { isResearcher: true });
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain('sexual');
  });

  it('allows sexual content below blocking threshold for non-age-verified user (0.69)', async () => {
    setupFetchResponse({ 'sexual': 0.69 });
    const result = await checkContent('test content');
    expect(result.blocked).toBe(false);
  });

  it('allows sexual content for age-verified user even above threshold', async () => {
    setupFetchResponse({ 'sexual': 0.95 });
    const result = await checkContent('test content', { isAgeVerified: true });
    expect(result.blocked).toBe(false);
  });

  it('allows sexual content for age-verified researcher', async () => {
    setupFetchResponse({ 'sexual': 0.95 });
    const result = await checkContent('test content', { isAgeVerified: true, isResearcher: true });
    expect(result.blocked).toBe(false);
  });
});

// ── checkContent — TIER 3: Researcher-exempt categories ──────────

describe('checkContent — researcher-exempt categories', () => {
  it('blocks hate content for regular user at blocking threshold (0.7)', async () => {
    setupFetchResponse({ 'hate': 0.7 });
    const result = await checkContent('test content');
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain('hate');
    expect(result.reason).toContain('usage policy');
  });

  it('blocks hate/threatening content for regular user above threshold', async () => {
    setupFetchResponse({ 'hate/threatening': 0.85 });
    const result = await checkContent('test content');
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain('hate/threatening');
  });

  it('allows hate content below blocking threshold for regular user (0.69)', async () => {
    setupFetchResponse({ 'hate': 0.69 });
    const result = await checkContent('test content');
    expect(result.blocked).toBe(false);
  });

  it('allows hate content for researcher user even above threshold', async () => {
    setupFetchResponse({ 'hate': 0.95 });
    const result = await checkContent('test content', { isResearcher: true });
    expect(result.blocked).toBe(false);
  });

  it('allows hate/threatening content for researcher user', async () => {
    setupFetchResponse({ 'hate/threatening': 0.95 });
    const result = await checkContent('test content', { isResearcher: true });
    expect(result.blocked).toBe(false);
  });

  it('blocks both hate categories when both exceed threshold for regular user', async () => {
    setupFetchResponse({ 'hate': 0.8, 'hate/threatening': 0.75 });
    const result = await checkContent('test content');
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain('hate');
    expect(result.categories).toContain('hate/threatening');
  });
});

// ── checkContent — tier priority ─────────────────────────────────

describe('checkContent — tier priority', () => {
  it('always-blocked categories take priority over age-restricted', async () => {
    // If sexual/minors is flagged, it should be reported as always-blocked,
    // not as age-restricted sexual content
    setupFetchResponse({ 'sexual/minors': 0.6, 'sexual': 0.9 });
    const result = await checkContent('test content');
    expect(result.blocked).toBe(true);
    // Should be blocked by tier 1 (always-blocked), not tier 2
    expect(result.categories).toContain('sexual/minors');
    expect(result.reason).toContain('prohibited content');
    // sexual should not appear because tier 1 returns early
    expect(result.categories).not.toContain('sexual');
  });

  it('always-blocked categories take priority over researcher-exempt', async () => {
    setupFetchResponse({ 'self-harm/instructions': 0.6, 'hate': 0.9 });
    const result = await checkContent('test content');
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain('self-harm/instructions');
    expect(result.reason).toContain('prohibited content');
    expect(result.categories).not.toContain('hate');
  });

  it('age-restricted takes priority over researcher-exempt when both triggered', async () => {
    // Non-age-verified, non-researcher user with both sexual + hate content
    setupFetchResponse({ 'sexual': 0.8, 'hate': 0.9 });
    const result = await checkContent('test content');
    expect(result.blocked).toBe(true);
    // Tier 2 (age-restricted) runs before Tier 3 (researcher-exempt)
    expect(result.categories).toContain('sexual');
    expect(result.reason).toContain('age-restricted');
    // hate should not appear because tier 2 returns early
    expect(result.categories).not.toContain('hate');
  });
});

// ── checkContent — benign content ────────────────────────────────

describe('checkContent — benign content', () => {
  it('allows content when all scores are below threshold', async () => {
    setupFetchResponse({
      'harassment': 0.01,
      'hate': 0.02,
      'sexual': 0.05,
      'sexual/minors': 0.001,
      'self-harm/instructions': 0.003,
    });
    const result = await checkContent('Lovely day for a walk');
    expect(result.blocked).toBe(false);
    expect(result.categories).toBeUndefined();
  });
});

// ── checkContent — API error handling ────────────────────────────

describe('checkContent — API error handling', () => {
  it('allows content when moderation API returns non-OK status (fail open)', async () => {
    setupFetchError(500, 'Internal Server Error');
    const result = await checkContent('some content');
    expect(result.blocked).toBe(false);
  });

  it('allows content when fetch throws a network error (fail open)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network timeout'));
    const result = await checkContent('some content');
    expect(result.blocked).toBe(false);
  });

  it('allows content when API returns empty results array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'modr-test', model: 'test', results: [] }),
    });
    const result = await checkContent('some content');
    expect(result.blocked).toBe(false);
  });

  it('allows content when API returns no results field', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'modr-test', model: 'test' }),
    });
    const result = await checkContent('some content');
    expect(result.blocked).toBe(false);
  });
});

// ── checkContent — sync regex fallback ───────────────────────────

describe('checkContent — sync regex fallback runs before API call', () => {
  it('blocks content matching sync patterns without calling the API', async () => {
    const result = await checkContent('gas the jews');
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('Message contains prohibited content');
    // The sync check should block before reaching the API call
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── checkContent — API request format ────────────────────────────

describe('checkContent — API request format', () => {
  it('sends correct request to OpenAI Moderation API', async () => {
    setupFetchResponse({});
    await checkContent('test content to moderate');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/moderations');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers['Authorization']).toBe('Bearer sk-test-key-123456');

    const body = JSON.parse(options.body);
    expect(body.model).toBe('omni-moderation-latest');
    expect(body.input).toBe('test content to moderate');
  });
});

// ── checkMessages ────────────────────────────────────────────────

describe('checkMessages', () => {
  it('combines messages and checks them as a single content block', async () => {
    setupFetchResponse({});
    await checkMessages(['Hello', 'World'], { isAgeVerified: true });

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input).toBe('Hello\n\n---\n\nWorld');
  });

  it('filters out empty and whitespace-only messages before combining', async () => {
    setupFetchResponse({});
    await checkMessages(['Hello', '', '  ', 'World']);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input).toBe('Hello\n\n---\n\nWorld');
  });

  it('blocks if combined content triggers moderation', async () => {
    setupFetchResponse({ 'sexual/minors': 0.9 });
    const result = await checkMessages(['message one', 'message two']);
    expect(result.blocked).toBe(true);
  });

  it('allows if combined content passes moderation', async () => {
    setupFetchResponse({});
    const result = await checkMessages(['safe message', 'another safe message']);
    expect(result.blocked).toBe(false);
  });

  it('passes user context through to content check', async () => {
    // Age-verified user should not be blocked by sexual content
    setupFetchResponse({ 'sexual': 0.9 });
    const result = await checkMessages(['content'], { isAgeVerified: true });
    expect(result.blocked).toBe(false);
  });

  it('returns not blocked for empty messages array (all filtered out)', async () => {
    const result = await checkMessages(['', '  ', '\t']);
    // After filtering, combined string is empty → checkContent returns not blocked
    expect(result.blocked).toBe(false);
  });
});

// ── Threshold boundary tests ─────────────────────────────────────

describe('threshold boundary precision', () => {
  it('critical threshold (0.5) — exactly at threshold blocks', async () => {
    setupFetchResponse({ 'sexual/minors': 0.5 });
    const result = await checkContent('test');
    expect(result.blocked).toBe(true);
  });

  it('critical threshold (0.5) — just below threshold allows', async () => {
    setupFetchResponse({ 'sexual/minors': 0.4999 });
    const result = await checkContent('test');
    expect(result.blocked).toBe(false);
  });

  it('blocking threshold (0.7) — exactly at threshold blocks', async () => {
    setupFetchResponse({ 'hate': 0.7 });
    const result = await checkContent('test');
    expect(result.blocked).toBe(true);
  });

  it('blocking threshold (0.7) — just below threshold allows', async () => {
    setupFetchResponse({ 'hate': 0.6999 });
    const result = await checkContent('test');
    expect(result.blocked).toBe(false);
  });

  it('sexual uses blocking threshold (0.7), not critical threshold', async () => {
    // Score between critical (0.5) and blocking (0.7) threshold:
    // Should NOT block for sexual (uses 0.7 threshold)
    setupFetchResponse({ 'sexual': 0.6 });
    const result = await checkContent('test');
    expect(result.blocked).toBe(false);
  });
});
