/**
 * Secret-redacting log helpers.
 *
 * The provider services hit external HTTP endpoints with URLs and headers
 * that frequently carry credentials — Authorization bearer tokens, API keys
 * embedded in URL query strings, and the occasional `user:pass@host` inline
 * auth from a custom-model baseUrl. When those requests fail, the natural
 * `console.error(err)` pattern dumps `err.config` (axios) or the stringified
 * Error (fetch) into the log, which silently surfaces the credentials.
 *
 * `safeErrorLog` and the underlying `redactSecrets` give a single place to
 * scrub those values before they hit stdout. Cheap, targeted, and bounded
 * to the patterns we actually emit — it is *not* a general-purpose log
 * scrubber, and won't catch creative new exfiltration shapes that future
 * code introduces. New leak surfaces should add cases here.
 *
 * The three patterns are designed to be non-overlapping: each matches a
 * distinct context (URL inline auth, URL query, header/JSON), and the
 * replacement leaves a `[REDACTED]` token that the other patterns won't
 * re-match (the body class excludes `[`).
 */

// 1. Inline auth in URLs: `https://user:pass@host/path`
const INLINE_AUTH_RE = /([a-z][a-z0-9+.-]*:\/\/)([^@/?#\s]+):([^@/?#\s]+)@/gi;

// 2. URL query-string secrets: `?api_key=...`, `&token=...`, etc.
// Body stops at any URL delimiter so multiple params get redacted
// independently rather than the first one eating the rest.
const QUERY_SECRET_RE =
  /([?&])([a-z0-9_.-]*(?:api[_-]?key|token|secret|password|auth|sig|signature)[a-z0-9_.-]*)=[^&#\s'"]*/gi;

// 3. Header-like contexts: `Authorization: Bearer xxx`, `"x-api-key":"sk-..."`,
// `x-api-key=...` in a free-form log line. Body class is alphanumeric + a
// few token-friendly punctuation chars, which intentionally excludes `[`
// — so a previously-redacted `[REDACTED]` value can't be re-matched.
const HEADER_RE =
  /((?:authorization|(?:x-)?api[_-]?key)['"]?\s*[:=]\s*['"]?(?:Bearer\s+)?)[A-Za-z0-9._\-+/=]{4,}/gi;

/**
 * Strip likely-credential substrings from a string. Designed to be applied
 * to URLs, error messages, and stringified objects on their way to a log.
 *
 * - `https://user:secret@host/path`              → `https://user:[REDACTED]@host/path`
 * - `?api_key=abc&token=xyz`                     → `?api_key=[REDACTED]&token=[REDACTED]`
 * - `Authorization: Bearer eyJ...`               → `Authorization: Bearer [REDACTED]`
 * - `"x-api-key": "sk-..."`                      → `"x-api-key": "[REDACTED]"`
 *
 * Anything not matching one of these shapes passes through unchanged.
 */
export function redactSecrets(s: string): string {
  if (!s) return s;
  return s
    .replace(INLINE_AUTH_RE, '$1$2:[REDACTED]@')
    .replace(QUERY_SECRET_RE, '$1$2=[REDACTED]')
    .replace(HEADER_RE, '$1[REDACTED]');
}

/**
 * Format an error for logging with secrets redacted. Preserves the stack
 * (useful for debugging) but scrubs URLs and headers from both the
 * message and the stack body.
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    const head = `${error.name}: ${error.message}`;
    // Node's Error.stack starts with `${name}: ${message}\n`. Avoid double-printing.
    const stackBody =
      error.stack && error.stack.startsWith(head)
        ? error.stack.slice(head.length)
        : error.stack
          ? `\n${error.stack}`
          : '';
    return redactSecrets(head + stackBody);
  }
  if (error && typeof error === 'object') {
    try {
      return redactSecrets(JSON.stringify(error));
    } catch {
      return redactSecrets(String(error));
    }
  }
  return redactSecrets(String(error));
}

/**
 * Drop-in replacement for `console.error(prefix, error, ...extra)` that
 * redacts known credential shapes from the error and any string extras.
 *
 * Non-string `extra` values are JSON-stringified before redaction. Pass
 * structured data here rather than embedding it in `prefix`.
 */
export function safeErrorLog(
  prefix: string,
  error: unknown,
  ...extra: unknown[]
): void {
  const formatted = formatError(error);
  if (extra.length === 0) {
    console.error(prefix, formatted);
    return;
  }
  const extras = extra.map((e) =>
    typeof e === 'string'
      ? redactSecrets(e)
      : redactSecrets(safeStringify(e)),
  );
  console.error(prefix, formatted, ...extras);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
