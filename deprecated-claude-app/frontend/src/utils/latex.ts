import katex from 'katex';

/**
 * Render LaTeX in content.
 *
 * Supports four math delimiters:
 *   - Display: $$...$$  and  \[...\]
 *   - Inline:  $...$    and  \(...\)
 *
 * IMPORTANT ORDERING: LaTeX must be extracted from the source text BEFORE
 * markdown parses it, because CommonMark backslash-escapes (`\(`, `\)`, `\[`,
 * `\]`) get consumed by marked.parse() — turning `\(n \ge 1\)` into `(n \ge 1)`
 * before KaTeX can ever see it.
 *
 * Pipeline:
 *   1. extractMath(content) → replaces math regions with placeholder tokens
 *      and returns the substituted text plus a map of rendered HTML.
 *   2. marked.parse() runs on the substituted text. Placeholders survive
 *      because they sit between Private Use Area unicode brackets that no
 *      markdown rule touches.
 *   3. restoreMath(html, map) substitutes the rendered HTML back in.
 *
 * Currency-safety: the `$...$` inline matcher is intentionally strict —
 * it requires a non-digit, non-whitespace character immediately inside both
 * delimiters and refuses to match if a digit follows the closing `$`. So
 * `$100. Strike at $110, premium $3` stays as text. Math intended as inline
 * math should use `\(...\)` (which is what Claude and GPT typically emit
 * anyway) or display form `$$...$$`.
 */

interface KatexOptions {
  throwOnError: boolean;
  strict: boolean;
  output: 'html';
  displayMode: boolean;
}

const BASE_OPTIONS: Omit<KatexOptions, 'displayMode'> = {
  throwOnError: false,
  strict: false, // Suppress warnings about unicode box-drawing chars etc.
  output: 'html',
};

// Placeholder tokens use a Private Use Area unicode bracket around an ASCII
// body. The PUA characters (U+E000 / U+E001) are not assigned to any script,
// effectively never appear in normal text or model output, and aren't
// markdown-special — so (a) collision risk with real content is effectively
// zero, and (b) marked.parse() passes them through unchanged. The body
// stays ASCII (`ARCMATH<N>`) so the placeholder is still grep-friendly in
// dev. The trailing PUA bracket also disambiguates adjacent multi-digit
// indices, which a greedy `\d+` regex would otherwise tangle (e.g.
// `ARCMATH1ARCMATH23` could be misparsed as a single match).
const PLACEHOLDER_OPEN = '';
const PLACEHOLDER_CLOSE = '';
const PLACEHOLDER_PREFIX = `${PLACEHOLDER_OPEN}ARCMATH`;
const PLACEHOLDER_SUFFIX = PLACEHOLDER_CLOSE;
const PLACEHOLDER_RE = new RegExp(
  `${PLACEHOLDER_OPEN}ARCMATH(\\d+)${PLACEHOLDER_CLOSE}`,
  'g',
);

function renderToHtml(latex: string, displayMode: boolean, original: string): string {
  try {
    return katex.renderToString(latex.trim(), { ...BASE_OPTIONS, displayMode });
  } catch (err) {
    console.warn(`[latex] render error (${displayMode ? 'display' : 'inline'}):`, err);
    // Fall back to the unrendered original so the user sees their source.
    return original;
  }
}

/**
 * Strict inline `$...$` matcher.
 *
 * Rules (any one failure means the candidate is treated as plain text):
 *   - Opening `$` must be followed by a non-digit, non-whitespace character.
 *   - Closing `$` must be preceded by a non-whitespace character.
 *   - Closing `$` must not be followed by a digit.
 *   - No newlines inside the match (would suggest paragraph break, not math).
 *   - Not part of `$$` (handled separately as display math).
 *
 * The capture group is an alternation so both single-char (`$n$`, `$x$`,
 * `$k$` — very common in mathematical prose) and multi-char (`$x + 1$`,
 * `$\frac{a}{b}$`) bodies match. The original single-branch regex
 * `[^\s\d$][^\n$]*?[^\s$]` required at least two distinct characters and
 * silently dropped single-letter inline math.
 *
 * Examples:
 *   ✓  `$n$`              — single letter
 *   ✓  `$x + 1$`          — letter follows opening, no digit issues
 *   ✓  `$\frac{1}{2}$`    — backslash follows opening
 *   ✗  `$100`             — digit follows opening
 *   ✗  `strike $110, $3`  — digit follows opening
 *   ✗  `cost is $ 50 $`   — whitespace follows opening
 */
const INLINE_DOLLAR_RE =
  /(?<!\$)\$(?!\$)([^\s\d$][^\n$]*?[^\s$]|[^\s\d$])\$(?!\d)/g;

/**
 * Extract math regions from raw model output, replacing them with placeholder
 * tokens. Order matters: longest/most-specific delimiters first so we don't
 * partially consume display math.
 */
export function extractMath(content: string): { text: string; rendered: string[] } {
  const rendered: string[] = [];
  let text = content;

  const replace = (re: RegExp, displayMode: boolean) => {
    text = text.replace(re, (match, body) => {
      const html = renderToHtml(body, displayMode, match);
      const idx = rendered.length;
      rendered.push(html);
      return `${PLACEHOLDER_PREFIX}${idx}${PLACEHOLDER_SUFFIX}`;
    });
  };

  // Order: $$ first (greediest), then \[ \], then strict $, then \( \).
  // Display math: $$ ... $$
  replace(/\$\$([\s\S]+?)\$\$/g, true);
  // Display math: \[ ... \]
  replace(/\\\[([\s\S]+?)\\\]/g, true);
  // Inline math: \( ... \)   — must run BEFORE $...$ so that escapes inside
  // \(...\) aren't grabbed by the dollar matcher.
  replace(/\\\(([\s\S]+?)\\\)/g, false);
  // Inline math: $ ... $   (currency-safe; see INLINE_DOLLAR_RE comment)
  replace(INLINE_DOLLAR_RE, false);

  return { text, rendered };
}

/**
 * Substitute the rendered KaTeX HTML back in for placeholder tokens.
 * Safe to call on either raw text or post-markdown HTML.
 */
export function restoreMath(html: string, rendered: string[]): string {
  return html.replace(PLACEHOLDER_RE, (_, idx) => rendered[Number(idx)] ?? '');
}

/**
 * Legacy single-pass API.
 *
 * Kept for backwards compatibility (in case any caller still depends on the
 * old "render math in-place over an HTML string" behavior), but DO NOT use
 * for new code: it runs after markdown has already stripped `\(`/`\[`
 * delimiters. Use `extractMath` + `restoreMath` around `marked.parse` instead.
 *
 * @deprecated Use `extractMath` / `restoreMath` around markdown parsing.
 */
export function renderLatex(content: string): string {
  if (!content.includes('$') && !content.includes('\\(') && !content.includes('\\[')) {
    return content;
  }
  const { text, rendered } = extractMath(content);
  return restoreMath(text, rendered);
}

/**
 * KaTeX-generated tags that need to be allowed through DOMPurify so the
 * rendered math survives sanitization.
 */
export const KATEX_ALLOWED_TAGS = [
  'span', 'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub',
  'mfrac', 'mover', 'munder', 'munderover', 'msqrt', 'mroot', 'mtable',
  'mtr', 'mtd', 'mtext', 'mspace', 'annotation', 'svg', 'line', 'path',
];

/** Attributes KaTeX emits. */
export const KATEX_ALLOWED_ATTRS = [
  'class', 'style', 'aria-hidden', 'encoding', 'xmlns', 'xlink:href',
  'viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width',
  'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
];
