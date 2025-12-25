/**
 * Content Filter Service
 * 
 * Uses OpenAI's Moderation API to filter harmful content.
 * Applied to non-researcher users only.
 * 
 * The moderation API is free to use and provides comprehensive
 * coverage of hate speech, harassment, violence, and other harmful content.
 */

export interface FilterResult {
  blocked: boolean;
  reason?: string;
  categories?: string[];
}

interface ModerationCategory {
  harassment: boolean;
  'harassment/threatening': boolean;
  hate: boolean;
  'hate/threatening': boolean;
  illicit: boolean;
  'illicit/violent': boolean;
  'self-harm': boolean;
  'self-harm/intent': boolean;
  'self-harm/instructions': boolean;
  sexual: boolean;
  'sexual/minors': boolean;
  violence: boolean;
  'violence/graphic': boolean;
}

interface ModerationResult {
  flagged: boolean;
  categories: ModerationCategory;
  category_scores: Record<string, number>;
}

interface ModerationResponse {
  id: string;
  model: string;
  results: ModerationResult[];
}

// Categories we block on - focusing only on hate speech
const BLOCKING_CATEGORIES: (keyof ModerationCategory)[] = [
  'hate',
  'hate/threatening',
];

// Threshold for blocking (higher = more permissive)
const BLOCKING_THRESHOLD = 0.7;

// Cache for API key
let cachedApiKey: string | null = null;

/**
 * Get OpenAI API key from environment or database
 */
function getOpenAIApiKey(): string | null {
  if (cachedApiKey) return cachedApiKey;
  
  // Try environment variable first
  const envKey = process.env.OPENAI_API_KEY;
  console.log(`[Content Filter] Checking for OPENAI_API_KEY: ${envKey ? 'found (' + envKey.slice(0, 10) + '...)' : 'not found'}`);
  if (envKey) {
    cachedApiKey = envKey;
    return envKey;
  }
  
  // Could also try to get from user's stored API keys, but for moderation
  // it makes sense to use a platform-level key
  return null;
}

/**
 * Check content using OpenAI's Moderation API
 * @param content The text content to check
 * @returns FilterResult with blocked status and optional reason
 */
export async function checkContent(content: string): Promise<FilterResult> {
  console.log(`[Content Filter] checkContent called with ${content?.length || 0} chars`);
  
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return { blocked: false };
  }

  // First, do a quick regex check for the absolute worst terms
  // This catches cases the API might miss
  const syncResult = checkContentSync(content);
  if (syncResult.blocked) {
    console.warn(`[Content Filter] Blocked by regex fallback`);
    return syncResult;
  }

  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    // No API key - fall back to allowing content but log warning
    console.warn('[Content Filter] No OpenAI API key configured, skipping moderation');
    return { blocked: false };
  }

  try {
    const response = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'omni-moderation-latest',
        input: content
      })
    });

    if (!response.ok) {
      console.error(`[Content Filter] Moderation API error: ${response.status} ${response.statusText}`);
      // On API error, allow content to pass (fail open)
      return { blocked: false };
    }

    const data = await response.json() as ModerationResponse;
    
    console.log(`[Content Filter] API response:`, JSON.stringify(data, null, 2));
    
    if (!data.results || data.results.length === 0) {
      console.log(`[Content Filter] No results in response`);
      return { blocked: false };
    }

    const result = data.results[0];
    
    // Log relevant scores
    console.log(`[Content Filter] Scores - hate: ${result.category_scores['hate']?.toFixed(4)}, hate/threatening: ${result.category_scores['hate/threatening']?.toFixed(4)}`);
    
    // Check blocking categories
    const violatedCategories: string[] = [];
    
    for (const category of BLOCKING_CATEGORIES) {
      const score = result.category_scores[category];
      if (score >= BLOCKING_THRESHOLD) {
        violatedCategories.push(category);
      }
    }

    if (violatedCategories.length > 0) {
      console.warn(`[Content Filter] Content blocked. Categories: ${violatedCategories.join(', ')}`);
      return {
        blocked: true,
        reason: 'Message contains content that violates our usage policy',
        categories: violatedCategories
      };
    }

    console.log(`[Content Filter] Content allowed (no categories exceeded threshold)`);
    return { blocked: false };
  } catch (error) {
    console.error('[Content Filter] Error calling moderation API:', error);
    // On network/parsing error, allow content to pass (fail open)
    return { blocked: false };
  }
}

/**
 * Check all messages in a conversation context
 * @param messages Array of message contents to check
 * @returns FilterResult - blocked if any message is blocked
 */
export async function checkMessages(messages: string[]): Promise<FilterResult> {
  // Combine messages for more efficient API call
  const combined = messages.filter(m => m && m.trim()).join('\n\n---\n\n');
  return checkContent(combined);
}

/**
 * Synchronous fallback check using simple patterns
 * Only catches the most egregious content
 * Used when moderation API is unavailable
 */
export function checkContentSync(content: string): FilterResult {
  if (!content || typeof content !== 'string') {
    return { blocked: false };
  }

  // Very basic patterns for absolute worst-case fallback
  const CRITICAL_PATTERNS: RegExp[] = [
    /\bn[i1!|]gg[e3a@]r/i,
    /\bkill\s+(?:all\s+)?(?:jews|muslims|blacks|whites|gays|trans)/i,
    /\bgas\s+the\s+jews/i,
  ];

  const normalized = content.toLowerCase();
  
  for (const pattern of CRITICAL_PATTERNS) {
    if (pattern.test(content) || pattern.test(normalized)) {
      return {
        blocked: true,
        reason: 'Message contains prohibited content'
      };
    }
  }

  return { blocked: false };
}
