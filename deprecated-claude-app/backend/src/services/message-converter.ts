/**
 * Message Converter
 *
 * Конвертирует animachat Message[] → membrane NormalizedMessage[]
 *
 * ВАЖНЫЕ ОСОБЕННОСТИ:
 * 1. animachat хранит текст в branch.content И может дублировать в contentBlocks
 * 2. membrane определяет роль по participant name (не по role!)
 * 3. Нужно правильно обрабатывать tool_result
 * 4. generated_image ≠ image (input vs output)
 * 5. Base64 может приходить с data URL префиксом
 *
 * CACHE STRATEGY (UPDATED):
 * - Use cacheBreakpoint: true instead of metadata.cacheControl
 * - metadata.cacheControl is IGNORED by AnthropicXmlFormatter!
 * - cacheBreakpoint is the new Membrane API for explicit cache boundaries
 */

import { Message, Participant, MessageBranch, Attachment } from '@deprecated-claude/shared';
import type { NormalizedMessage, ContentBlock } from '@animalabs/membrane';

// ============================================================================
// Main Converter
// ============================================================================

/**
 * Конвертирует массив animachat сообщений в membrane формат
 *
 * @param messages - Массив animachat сообщений
 * @param participants - Список участников разговора
 * @param cacheMarkerIndices - Индексы сообщений где ставить cache breakpoint
 * @param assistantParticipantName - Имя assistant participant (по умолчанию "Claude")
 * @returns Массив NormalizedMessage для membrane
 */
export function convertToNormalizedMessages(
  messages: Message[],
  participants: Participant[],
  cacheMarkerIndices?: number[],
  assistantParticipantName: string = 'Claude'  // ВАЖНО: membrane использует это для определения роли
): NormalizedMessage[] {

  const result: NormalizedMessage[] = [];
  const cacheIndices = new Set(cacheMarkerIndices || []);

  // DEBUG: Log input parameters
  console.log(`\n[converter] 🔄 Converting ${messages.length} messages`);
  console.log(`[converter] cacheMarkerIndices: ${JSON.stringify(cacheMarkerIndices)}`);

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    // 1. Найти активную ветку (версию сообщения)
    const branch = message.branches.find(b => b.id === message.activeBranchId);
    if (!branch) continue;

    // 2. Пропустить system сообщения (они передаются отдельно в request.system)
    if (branch.role === 'system') continue;

    // 3. Найти имя участника
    // ВАЖНО: Для assistant роли нужно использовать assistantParticipantName
    // чтобы membrane правильно определил роль
    const participantName = findParticipantName(branch, participants, assistantParticipantName);

    // 4. Конвертировать контент
    const content = convertBranchContent(branch);

    // Пропустить пустые сообщения, НО оставить последнее
    // Membrane использует пустой assistant placeholder как completion target для prefill
    const isLastMessage = i === messages.length - 1;
    if (content.length === 0 && !isLastMessage) continue;

    // 5. Determine cache breakpoint
    // CHANGED: Use cacheBreakpoint instead of metadata.cacheControl
    // metadata.cacheControl is IGNORED by AnthropicXmlFormatter!
    // Sources (in priority order):
    // 1. cacheMarkerIndices (for prefill mode - Chapter II approach)
    // 2. branch._cacheControl (for message-level caching - enhanced-inference adds this)
    const hasCacheIndex = cacheIndices.has(i);
    const branchCacheControl = (branch as any)._cacheControl;
    const shouldCache = !!(hasCacheIndex || branchCacheControl);

    // DEBUG: Log when we find cache control sources
    if (shouldCache) {
      console.log(`[converter] msg ${i} (${message.id.substring(0, 8)}): cacheBreakpoint=true (hasCacheIndex=${hasCacheIndex}, branchCacheControl=${!!branchCacheControl})`);
    }

    // 5b. TOOL CALL SPLITTING for native formatter
    // When an assistant message contains both tool_use AND tool_result blocks,
    // they must be split into separate messages for Anthropic API:
    //   - tool_use → assistant message
    //   - tool_result → user message
    //   - text (final response) → assistant message
    // Without this, second message in conversation fails with:
    //   "messages.0: `tool_use` blocks can only be in `assistant` messages"
    const hasToolUse = content.some(b => b.type === 'tool_use');
    const hasToolResult = content.some(b => b.type === 'tool_result');

    if (hasToolUse && hasToolResult && participantName === assistantParticipantName) {
      // Split into: assistant(tool_use) → user(tool_result) → assistant(text)
      const toolUseBlocks = content.filter(b =>
        b.type === 'tool_use' || b.type === 'thinking' || b.type === 'redacted_thinking'
      );
      const toolResultBlocks = content.filter(b => b.type === 'tool_result');
      const textBlocks = content.filter(b =>
        b.type !== 'tool_use' && b.type !== 'tool_result' &&
        b.type !== 'thinking' && b.type !== 'redacted_thinking'
      );

      console.log(`[converter] msg ${i}: splitting tool call branch → ${toolUseBlocks.length} tool_use + ${toolResultBlocks.length} tool_result + ${textBlocks.length} text`);

      // 1. Assistant: tool_use (+ thinking if present)
      if (toolUseBlocks.length > 0) {
        result.push({ participant: assistantParticipantName, content: toolUseBlocks });
      }
      // 2. User: tool_result
      if (toolResultBlocks.length > 0) {
        result.push({ participant: 'User', content: toolResultBlocks });
      }
      // 3. Assistant: text response (if any)
      if (textBlocks.length > 0) {
        result.push({
          participant: assistantParticipantName,
          content: textBlocks,
          cacheBreakpoint: shouldCache || undefined,
        });
      }
      continue; // Skip normal push — we already added split messages
    }

    // For Native mode (1-on-1 chats): add cache_control directly to last text block
    // This is needed because Native formatter passes blocks directly to API without using cacheBreakpoint
    // For XML/prefill mode, cacheBreakpoint is still used (handled by AnthropicXmlFormatter)
    if (shouldCache && content.length > 0) {
      for (let j = content.length - 1; j >= 0; j--) {
        if (content[j].type === 'text') {
          (content[j] as any).cache_control = { type: 'ephemeral' };
          break;
        }
      }
    }

    // CHANGED: Use cacheBreakpoint (new Membrane API) instead of metadata.cacheControl (ignored!)
    result.push({
      participant: participantName,
      content,
      cacheBreakpoint: shouldCache || undefined,  // true or undefined (not false)
    });
  }

  // CHANGED: Check cacheBreakpoint instead of metadata.cacheControl
  const withCacheBreakpoint = result.filter(m => m.cacheBreakpoint).length;
  console.log(`[converter] ✅ Result: ${result.length} normalized msgs, ${withCacheBreakpoint} with cacheBreakpoint`);
  if (withCacheBreakpoint > 0) {
    const positions = result.map((m, i) => m.cacheBreakpoint ? i : null).filter(x => x !== null);
    console.log(`[converter] Cache breakpoint positions: ${JSON.stringify(positions)}`);
  } else if (cacheMarkerIndices && cacheMarkerIndices.length > 0) {
    console.log(`[converter] ⚠️ WARNING: cacheMarkerIndices provided but no cacheBreakpoint set!`);
  }

  return result;
}

// ============================================================================
// Participant Name Resolution
// ============================================================================

/**
 * Найти имя участника по branch
 *
 * ВАЖНО: membrane определяет роль так:
 * - assistant если participant === assistantParticipantName
 * - user для всех остальных
 *
 * Поэтому для assistant роли нужно вернуть assistantParticipantName!
 */
function findParticipantName(
  branch: MessageBranch,
  participants: Participant[],
  assistantParticipantName: string
): string {
  // Если есть participantId — ищем по нему
  if (branch.participantId) {
    const participant = participants.find(p => p.id === branch.participantId);
    if (participant) {
      // Для assistant типа возвращаем assistantParticipantName
      if (participant.type === 'assistant') {
        return assistantParticipantName;
      }
      return participant.name;
    }
  }

  // Fallback на role
  // ВАЖНО: для assistant возвращаем assistantParticipantName, не "Assistant"!
  return branch.role === 'user' ? 'User' : assistantParticipantName;
}

// ============================================================================
// Content Conversion
// ============================================================================

/**
 * Конвертировать содержимое branch в membrane ContentBlock[]
 *
 * ЛОГИКА:
 * - Если есть contentBlocks с text — используем их, игнорируем branch.content
 * - Если contentBlocks пустые или без text — используем branch.content
 * - Всегда добавляем attachments
 */
function convertBranchContent(branch: MessageBranch): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  // Проверяем есть ли text blocks в contentBlocks
  const hasTextBlocks = branch.contentBlocks?.some(
    block => block.type === 'text' && (block as any).text?.trim()
  );

  // 1. Текстовый контент
  // Добавляем branch.content ТОЛЬКО если нет text blocks в contentBlocks
  // Это предотвращает дублирование
  if (!hasTextBlocks && branch.content && branch.content.trim()) {
    blocks.push({
      type: 'text',
      text: branch.content
    });
  }

  // 2. ContentBlocks (thinking, tool_use, tool_result, text, image)
  if (branch.contentBlocks) {
    for (const block of branch.contentBlocks) {
      const converted = convertContentBlock(block);
      if (converted) {
        blocks.push(converted);
      }
    }
  }

  // 3. Attachments (картинки, документы, аудио)
  if (branch.attachments) {
    for (const attachment of branch.attachments) {
      const converted = convertAttachment(attachment);
      if (converted) {
        blocks.push(converted);
      }
    }
  }

  return blocks;
}

/**
 * Конвертировать animachat ContentBlock в membrane ContentBlock
 */
function convertContentBlock(block: any): ContentBlock | null {
  switch (block.type) {
    case 'text':
      // Текстовый блок
      if (block.text && block.text.trim()) {
        return {
          type: 'text',
          text: block.text
        };
      }
      return null;

    case 'thinking':
      return {
        type: 'thinking',
        thinking: block.thinking,
        signature: block.signature
      };

    case 'redacted_thinking':
      return {
        type: 'redacted_thinking'
      };

    case 'tool_use':
      // Валидация обязательных полей
      if (!block.id || !block.name) {
        console.warn('[MessageConverter] tool_use missing id or name', block);
        return null;
      }

      // Parse input - может быть строкой JSON или объектом
      let toolInput: Record<string, unknown> = {};
      if (typeof block.input === 'string') {
        try {
          toolInput = JSON.parse(block.input);
        } catch {
          toolInput = { raw: block.input };
        }
      } else if (block.input && typeof block.input === 'object') {
        toolInput = block.input;
      }

      return {
        type: 'tool_use',
        id: String(block.id),
        name: String(block.name),
        input: toolInput
      };

    case 'tool_result':
      // ВАЖНО: Не забыть tool_result!
      // content может быть string | ContentBlock[]
      let resultContent: string | ContentBlock[] = block.content ?? '';

      if (Array.isArray(resultContent)) {
        // Уже массив ContentBlock[] — оставляем как есть
      } else if (typeof resultContent === 'object' && resultContent !== null) {
        // Объект (не массив) — сериализуем в JSON строку
        try {
          resultContent = JSON.stringify(resultContent, null, 2);
        } catch {
          resultContent = String(resultContent);
        }
      } else {
        // Строка или примитив
        resultContent = String(resultContent);
      }

      // FIX: Use camelCase field names to match membrane ToolResultContent type
      return {
        type: 'tool_result',
        toolUseId: String(block.tool_use_id || block.toolUseId || ''),
        content: resultContent,
        isError: block.is_error || block.isError || false
      };

    case 'generated_image':
      // Сгенерированное изображение от модели (output, не input!)
      // membrane тоже должен поддерживать этот тип
      if (block.data) {
        return {
          type: 'image',
          source: {
            type: 'base64',
            data: normalizeBase64(block.data),
            mediaType: block.mimeType || 'image/png'
          }
        };
      }
      return null;

    case 'image':
      // Входное изображение
      if (block.data) {
        return {
          type: 'image',
          source: {
            type: 'base64',
            data: normalizeBase64(block.data),
            mediaType: block.mimeType || 'image/png'
          }
        };
      }

      // blobId требует резолвинга в membrane-inference.ts
      if (block.blobId) {
        console.warn(`[MessageConverter] image block has blobId without data - needs resolution: ${block.blobId}`);
      }
      return null;

    case 'audio':
      // Сгенерированное аудио от модели
      if (block.data) {
        return {
          type: 'audio',
          source: {
            type: 'base64',
            data: normalizeBase64(block.data),
            mediaType: block.mimeType || 'audio/mp3'
          },
          duration: block.duration
        };
      }
      return null;

    default:
      // Неизвестный тип — логируем и пропускаем
      console.warn(`[MessageConverter] Unknown content block type: ${block.type}`);
      return null;
  }
}

/**
 * Конвертировать animachat Attachment в membrane ContentBlock
 */
function convertAttachment(attachment: Attachment): ContentBlock | null {
  // Получаем расширение файла с fallback на fileName
  const fileTypeFromField = (attachment.fileType || '').toLowerCase().replace(/^\./, '');
  const fileType = fileTypeFromField || extractExtension(attachment.fileName);
  const mimeType = attachment.mimeType || guessMimeType(fileType);

  // ✅ URL images - Membrane поддерживает URL только для изображений
  if (attachment.encoding === 'url' && isImageType(fileType)) {
    return {
      type: 'image',
      source: {
        type: 'url',
        url: attachment.content
      }
    };
  }

  // URL для не-изображений не поддерживается Membrane
  if (attachment.encoding === 'url') {
    console.warn(`[MessageConverter] URL attachment not supported for ${fileType}: ${attachment.fileName}`);
    return null;
  }

  // Base64 data - нормализуем (убираем префикс и пробелы)
  const base64Data = normalizeBase64(attachment.content);

  // Изображения (входные, от пользователя)
  if (isImageType(fileType)) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        data: base64Data,
        mediaType: mimeType
      }
    };
  }

  // PDF документы
  if (fileType === 'pdf') {
    return {
      type: 'document',
      source: {
        type: 'base64',
        data: base64Data,
        mediaType: 'application/pdf'
      },
      filename: attachment.fileName
    };
  }

  // Аудио
  if (isAudioType(fileType)) {
    return {
      type: 'audio',
      source: {
        type: 'base64',
        data: base64Data,
        mediaType: mimeType
      },
      duration: attachment.metadata?.duration
    };
  }

  // Видео
  if (isVideoType(fileType)) {
    return {
      type: 'video',
      source: {
        type: 'base64',
        data: base64Data,
        mediaType: mimeType
      },
      duration: attachment.metadata?.duration
    };
  }

  // Текстовые файлы — добавляем как текст
  if (isTextType(fileType) && attachment.encoding === 'text') {
    return {
      type: 'text',
      text: `[File: ${attachment.fileName}]\n${attachment.content}`
    };
  }

  // Неподдерживаемый тип — пропускаем с предупреждением
  console.warn(`[MessageConverter] Unsupported attachment type: ${fileType} (${attachment.fileName})`);
  return null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Убрать data URL префикс если есть
 *
 * Примеры:
 * - "data:image/png;base64,iVBOR..." → "iVBOR..."
 * - "data:image/svg+xml;charset=utf-8;base64,..." → "..."
 * - "data:application/pdf;name=x.pdf;base64,..." → "..."
 * - "iVBOR..." → "iVBOR..." (без изменений)
 *
 * Используем .*? чтобы захватить любые параметры до ;base64,
 * Используем [\s\S] чтобы захватить переносы строк в base64
 */
function stripDataUrlPrefix(data: string): string {
  if (!data) return '';

  // Более гибкий regex - матчит любые параметры до ;base64,
  const match = data.match(/^data:.*?;base64,([\s\S]+)$/);
  return match ? match[1].trim() : data.trim();
}

/**
 * Нормализовать base64 данные
 *
 * - Убирает data URL префикс
 * - Удаляет пробелы и переносы строк (некоторые API на них падают)
 */
function normalizeBase64(data: string): string {
  return stripDataUrlPrefix(data).replace(/\s+/g, '');
}

/**
 * Извлечь расширение файла из имени
 *
 * Примеры:
 * - "photo.jpg" → "jpg"
 * - "document.PDF" → "pdf"
 * - "file" → ""
 */
function extractExtension(fileName?: string): string {
  if (!fileName) return '';
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? '';
}

// ============================================================================
// Type Detection Helpers
// ============================================================================

const IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
const AUDIO_TYPES = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'];
const VIDEO_TYPES = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
const TEXT_TYPES = ['txt', 'md', 'json', 'xml', 'csv', 'html', 'css', 'js', 'ts', 'py'];

function isImageType(fileType: string): boolean {
  return IMAGE_TYPES.includes(fileType);
}

function isAudioType(fileType: string): boolean {
  return AUDIO_TYPES.includes(fileType);
}

function isVideoType(fileType: string): boolean {
  return VIDEO_TYPES.includes(fileType);
}

function isTextType(fileType: string): boolean {
  return TEXT_TYPES.includes(fileType);
}

function guessMimeType(fileType: string): string {
  const mimeMap: Record<string, string> = {
    // Images
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'bmp': 'image/bmp',
    'svg': 'image/svg+xml',
    // Audio
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'flac': 'audio/flac',
    'm4a': 'audio/mp4',
    'aac': 'audio/aac',
    // Video
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska',
    // Documents
    'pdf': 'application/pdf',
    // Text
    'txt': 'text/plain',
    'md': 'text/markdown',
    'json': 'application/json',
    'xml': 'application/xml',
    'csv': 'text/csv',
    'html': 'text/html',
  };

  return mimeMap[fileType] || 'application/octet-stream';
}

// ============================================================================
// Exports
// ============================================================================

export {
  findParticipantName,
  convertBranchContent,
  convertAttachment,
  convertContentBlock,
  stripDataUrlPrefix,
  normalizeBase64,
  extractExtension,
  isImageType,
  isAudioType,
  isVideoType,
  isTextType,
  guessMimeType
};
