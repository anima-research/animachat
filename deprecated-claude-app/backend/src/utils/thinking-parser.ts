/**
 * Shared utility for parsing thinking/reasoning tags from AI responses.
 * Used across multiple provider services to extract structured thinking blocks.
 */

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export type ContentBlock = ThinkingBlock | TextBlock;

/**
 * Parse <think>...</think> tags from content and create content blocks.
 * Used for prefill mode thinking and open source models that output reasoning
 * in <think> tag format (DeepSeek, Qwen, etc.)
 * 
 * @param content - The raw content string potentially containing <think> tags
 * @returns Array of content blocks (thinking and/or text)
 */
export function parseThinkingTags(content: string): ContentBlock[] {
  const contentBlocks: ContentBlock[] = [];
  
  // Match all <think>...</think> blocks (non-greedy, handles multiple)
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
  let match;
  let textContent = content;
  
  while ((match = thinkRegex.exec(content)) !== null) {
    const thinkingContent = match[1].trim();
    if (thinkingContent) {
      contentBlocks.push({
        type: 'thinking',
        thinking: thinkingContent
      });
    }
  }
  
  // Remove thinking tags from content to get the text part
  textContent = content.replace(thinkRegex, '').trim();
  
  // Add text block if there's remaining content AND we found thinking blocks
  // (if no thinking blocks, return empty array - the raw content is just text)
  if (textContent && contentBlocks.length > 0) {
    contentBlocks.push({
      type: 'text',
      text: textContent
    });
  }
  
  return contentBlocks;
}

