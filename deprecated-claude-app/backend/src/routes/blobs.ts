import { Router, Request, Response } from 'express';
import { getBlobStore } from '../database/blob-store.js';

const router = Router();

// UUID v4 format validation regex - prevents path traversal attacks
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidBlobId(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * GET /api/blobs/:id
 * 
 * Serves blob content with proper MIME type and caching headers.
 * Blobs are immutable (identified by content hash), so we can cache aggressively.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!id || !isValidBlobId(id)) {
      return res.status(400).json({ error: 'Invalid blob ID' });
    }
    
    // Check conditional request BEFORE any disk I/O
    // ETag is the blob ID, which we already have from the URL
    const ifNoneMatch = req.get('If-None-Match');
    if (ifNoneMatch === `"${id}"`) {
      // Client has the cached version - no need to read blob from disk
      res.set({
        'Cache-Control': 'public, max-age=31536000, immutable',
        'ETag': `"${id}"`,
      });
      return res.status(304).end();
    }
    
    const blobStore = getBlobStore();
    const blob = await blobStore.loadBlob(id);
    
    if (!blob) {
      return res.status(404).json({ error: 'Blob not found' });
    }
    
    // Set response headers
    res.set({
      'Content-Type': blob.metadata.mimeType,
      'Content-Length': blob.metadata.size.toString(),
      // Aggressive caching - blobs are immutable (identified by content hash)
      'Cache-Control': 'public, max-age=31536000, immutable',
      // ETag based on blob ID (which is unique)
      'ETag': `"${id}"`,
    });
    
    // Send the blob data
    res.send(blob.data);
    
  } catch (error) {
    console.error('[Blobs] Error serving blob:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/blobs/:id/metadata
 * 
 * Returns blob metadata without the actual content.
 * Useful for checking blob existence or getting info before download.
 */
router.get('/:id/metadata', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!id || !isValidBlobId(id)) {
      return res.status(400).json({ error: 'Invalid blob ID' });
    }
    
    const blobStore = getBlobStore();
    const metadata = await blobStore.getMetadata(id);
    
    if (!metadata) {
      return res.status(404).json({ error: 'Blob not found' });
    }
    
    res.json({
      id,
      ...metadata,
      // Add a URL for convenience
      url: `/api/blobs/${id}`
    });
    
  } catch (error) {
    console.error('[Blobs] Error getting metadata:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
