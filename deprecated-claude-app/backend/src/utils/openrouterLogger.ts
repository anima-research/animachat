/**
 * OpenRouter-specific logger with smart truncation
 * Logs each request to a separate file to avoid giant log files
 */

import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs', 'openrouter');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Truncate message content to first 100 chars while preserving structure
 */
function truncateMessages(messages: any[]): any[] {
  return messages.map(msg => {
    if (typeof msg.content === 'string') {
      // Simple string content
      return {
        ...msg,
        content: msg.content.length > 100 
          ? msg.content.substring(0, 100) + `... [${msg.content.length} chars total]`
          : msg.content
      };
    } else if (Array.isArray(msg.content)) {
      // Content blocks array
      return {
        ...msg,
        content: msg.content.map((block: any) => {
          if (block.text && block.text.length > 100) {
            return {
              ...block,
              text: block.text.substring(0, 100) + `... [${block.text.length} chars total]`
            };
          }
          return block;
        })
      };
    }
    return msg;
  });
}

/**
 * Simple hash function for cache verification
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Calculate hash of cacheable portion (messages with cache_control)
 */
function calculateCacheHash(messages: any[]): string {
  let cacheableContent = '';
  
  for (const msg of messages) {
    // Include all messages up to and including one with cache_control
    cacheableContent += JSON.stringify({
      role: msg.role,
      content: msg.content
    });
    
    // Check if this message has cache_control
    if (Array.isArray(msg.content)) {
      const hasCache = msg.content.some((b: any) => b.cache_control);
      if (hasCache) break; // Stop at cache point
    }
  }
  
  return simpleHash(cacheableContent);
}

/**
 * Log OpenRouter request with truncated content to separate file
 */
export function logOpenRouterRequest(requestId: string, modelId: string, requestBody: any, provider?: string) {
  const timestamp = new Date().toISOString();
  
  // Create truncated version of request body
  const truncatedBody = {
    ...requestBody,
    messages: truncateMessages(requestBody.messages || [])
  };
  
  const messageCount = requestBody.messages?.length || 0;
  const cacheControlCount = countCacheControls(requestBody.messages || []);
  const cacheHash = calculateCacheHash(requestBody.messages || []);
  
  const logContent = '='.repeat(80) + '\n' +
    `REQUEST: ${requestId}\n` +
    `Time: ${timestamp}\n` +
    `Model: ${modelId} (provider: ${provider})\n` +
    `Messages: ${messageCount}, Cache points: ${cacheControlCount}\n` +
    `Cache Hash: ${cacheHash} (hash of cacheable content)\n` +
    '='.repeat(80) + '\n\n' +
    'REQUEST BODY (truncated):\n' +
    JSON.stringify(truncatedBody, null, 2) + '\n\n';
  
  // Write to separate file per request
  const logFile = path.join(LOG_DIR, `${requestId}.log`);
  fs.writeFileSync(logFile, logContent);
}

/**
 * Log OpenRouter response (appends to same file as request)
 */
export function logOpenRouterResponse(requestId: string, fullResponse: any, usage: any, cacheMetrics: any, responseContent: string) {
  const timestamp = new Date().toISOString();
  
  // Truncate response content
  const truncatedContent = responseContent.length > 200
    ? responseContent.substring(0, 200) + `... [${responseContent.length} chars total]`
    : responseContent;
  
  const logContent = '='.repeat(80) + '\n' +
    `RESPONSE: ${requestId}\n` +
    `Time: ${timestamp}\n` +
    '='.repeat(80) + '\n\n' +
    'RESPONSE CONTENT (truncated):\n' +
    `"${truncatedContent}"\n\n` +
    'FULL RESPONSE STRUCTURE:\n' +
    JSON.stringify({
      id: fullResponse.id,
      provider: fullResponse.provider,
      model: fullResponse.model,
      choices: fullResponse.choices?.map((c: any) => ({
        ...c,
        message: c.message ? {
          role: c.message.role,
          content: c.message.content?.length > 100 
            ? c.message.content.substring(0, 100) + `... [${c.message.content.length} chars]`
            : c.message.content
        } : undefined,
        delta: c.delta ? { content: '[streaming delta]' } : undefined
      })),
      usage: fullResponse.usage
    }, null, 2) + '\n\n' +
    'CACHE METRICS:\n' +
    `  Creation tokens: ${cacheMetrics.cacheCreationInputTokens}\n` +
    `  Read tokens: ${cacheMetrics.cacheReadInputTokens}\n` +
    `  Total cached: ${(cacheMetrics.cacheCreationInputTokens || 0) + (cacheMetrics.cacheReadInputTokens || 0)}\n\n`;
  
  // Append to the same file as the request
  const logFile = path.join(LOG_DIR, `${requestId}.log`);
  fs.appendFileSync(logFile, logContent);
}

/**
 * Count cache_control markers in messages
 */
function countCacheControls(messages: any[]): number {
  let count = 0;
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.cache_control) count++;
      }
    }
  }
  return count;
}

/**
 * Clear old log files (call at startup)
 * Keeps only the most recent 50 request logs
 */
export function clearOpenRouterLog() {
  if (!fs.existsSync(LOG_DIR)) return;
  
  const files = fs.readdirSync(LOG_DIR)
    .filter(f => f.endsWith('.log'))
    .map(f => ({
      name: f,
      path: path.join(LOG_DIR, f),
      time: fs.statSync(path.join(LOG_DIR, f)).mtime
    }))
    .sort((a, b) => b.time.getTime() - a.time.getTime());
  
  // Delete all but the 50 most recent
  if (files.length > 50) {
    for (let i = 50; i < files.length; i++) {
      fs.unlinkSync(files[i].path);
    }
    console.log(`[OpenRouter Logger] Cleaned up ${files.length - 50} old log files`);
  }
}

