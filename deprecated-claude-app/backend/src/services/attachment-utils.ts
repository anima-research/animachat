/**
 * Shared utilities for handling message attachments across providers.
 *
 * Background: prior to this module, "is this filename an image?" was
 * reimplemented in six places (anthropic.ts, bedrock.ts, openrouter.ts,
 * inference.ts ×3, context-strategies.ts) with subtle drift — most notably,
 * five of them excluded GIF with the comment "Anthropic API has issues with
 * some GIF formats" while OpenRouter silently allowed it. That meant the
 * same Claude model would accept a GIF when routed through OpenRouter but
 * reject it when routed through Bedrock or Anthropic-direct.
 *
 * The Anthropic Messages API documents image/jpeg, image/png, image/gif,
 * and image/webp as supported media types (animated GIFs are processed as
 * their first frame). The "GIF issues" comment appears to have been an
 * over-cautious response to a specific past failure that ossified into
 * blanket exclusion across copy-paste sites.
 *
 * This module is the single source of truth. Add new image formats here
 * and they apply uniformly across all providers.
 */

/**
 * Image file extensions accepted across all multi-modal providers.
 *
 * Kept conservative on purpose — providers that support additional formats
 * (HEIC, BMP, TIFF, etc.) can still accept them by extending this list once
 * we've confirmed each provider's behavior. The Anthropic Messages API,
 * Bedrock Claude, OpenRouter, and Gemini all support this set.
 */
export const SUPPORTED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'] as const;

/**
 * Return true if a filename looks like a supported image attachment.
 *
 * Pure filename check — does not inspect file content. Callers that also
 * need to know "do we have data to send" should additionally check
 * `attachment.content` (or equivalent) themselves.
 */
export function isImageFile(fileName: string | undefined | null): boolean {
  if (!fileName) return false;
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return (SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}
