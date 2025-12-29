/**
 * Shared media utilities for file type detection and MIME type resolution.
 * Used across multiple provider services (Anthropic, Bedrock, OpenRouter, etc.)
 */

/**
 * Get the MIME type for a file based on filename or provided mimeType.
 * Returns the provided mimeType if available, otherwise infers from extension.
 */
export function getMediaType(fileName: string, mimeType?: string): string {
  // Use provided mimeType if available
  if (mimeType) return mimeType;
  
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  const mediaTypes: { [key: string]: string } = {
    // Images
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    // Documents
    'pdf': 'application/pdf',
    // Audio
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'flac': 'audio/flac',
    'ogg': 'audio/ogg',
    'm4a': 'audio/mp4',
    'aac': 'audio/aac',
    'webm': 'audio/webm',
    // Video
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska',
  };
  return mediaTypes[extension] || 'application/octet-stream';
}

/**
 * Check if a file is an image attachment.
 * Note: GIF excluded - Anthropic/Bedrock APIs have issues with some GIF formats.
 */
export function isImageAttachment(fileName: string): boolean {
  const imageExtensions = ['jpg', 'jpeg', 'png', 'webp'];
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  return imageExtensions.includes(extension);
}

/**
 * Check if a file is a PDF attachment.
 */
export function isPdfAttachment(fileName: string): boolean {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  return extension === 'pdf';
}

/**
 * Check if a file is an audio attachment.
 */
export function isAudioAttachment(fileName: string): boolean {
  const audioExtensions = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'webm'];
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  return audioExtensions.includes(extension);
}

/**
 * Check if a file is a video attachment.
 */
export function isVideoAttachment(fileName: string): boolean {
  const videoExtensions = ['mp4', 'mov', 'avi', 'mkv', 'webm'];
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  return videoExtensions.includes(extension);
}

/**
 * Get the file extension from a filename.
 */
export function getFileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

