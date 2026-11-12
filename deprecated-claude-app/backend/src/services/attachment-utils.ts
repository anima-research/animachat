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

/**
 * Extensions that providers send as binary files (PDF documents, audio,
 * video) rather than inlining as text. Matches the media branches of the
 * OpenRouter formatter; the other formatters treat at least PDF the same way.
 */
const BINARY_FILE_EXTENSIONS = [
  'pdf',
  'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'webm',
  'mp4', 'mov', 'avi', 'mkv',
];

/** Rough token cost of one image, whatever its size. */
const IMAGE_TOKEN_ESTIMATE = 1500;

/**
 * Rough token cost of an attachment as the provider formatters send it, for
 * budgeting against the context window (for example when clamping
 * max_tokens).
 *
 * Text attachments are inlined as `<attachment filename="...">` blocks, so
 * they count like message text: about 4 characters per token, plus the
 * wrapper. Images cost a fixed amount. PDFs, audio and video count as
 * nothing: their token cost cannot be read off the base64 length, and
 * counting that length would overstate it many times over. An undercount
 * only lets a real overflow through to the provider, which rejects it with
 * its own message.
 */
export function estimateAttachmentTokens(
  attachment: { fileName?: string | null; content?: string | null }
): number {
  if (!attachment.content) return 0;
  if (isImageFile(attachment.fileName)) return IMAGE_TOKEN_ESTIMATE;
  const ext = attachment.fileName?.split('.').pop()?.toLowerCase() || '';
  if (BINARY_FILE_EXTENSIONS.includes(ext)) return 0;
  return Math.ceil(attachment.content.length / 4) + 16;
}
