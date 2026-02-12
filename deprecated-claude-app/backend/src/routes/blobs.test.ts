import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';

/**
 * Blobs route characterization tests.
 *
 * The blobs router uses getBlobStore() singleton, so we mock
 * `../database/blob-store.js` to return a controlled fake store.
 * This lets us test route logic (UUID validation, ETag caching,
 * 304 responses) without touching the filesystem.
 */

// Mock the blob-store module before imports
const mockLoadBlob = vi.fn();
const mockGetMetadata = vi.fn();

vi.mock('../database/blob-store.js', () => ({
  getBlobStore: () => ({
    loadBlob: mockLoadBlob,
    getMetadata: mockGetMetadata,
  }),
  initBlobStore: vi.fn(),
}));

// Now import the router (it will use our mock)
import blobRouter from './blobs.js';

let app: express.Express;
let request: supertest.Agent;

const VALID_UUID = '01234567-0123-4012-8012-0123456789ab';

beforeEach(() => {
  mockLoadBlob.mockReset();
  mockGetMetadata.mockReset();

  app = express();
  app.use('/api/blobs', blobRouter);
  request = supertest(app);
});

describe('Blobs routes', () => {
  describe('GET /api/blobs/:id', () => {
    it('returns 400 for invalid blob ID', async () => {
      const res = await request.get('/api/blobs/not-a-uuid');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid blob ID');
    });

    it('returns 400 for UUID-like but wrong version', async () => {
      // Version 1 UUID (third group starts with 1, not 4)
      const res = await request.get('/api/blobs/01234567-0123-1012-8012-0123456789ab');
      expect(res.status).toBe(400);
    });

    it('returns 304 when If-None-Match matches', async () => {
      const res = await request
        .get(`/api/blobs/${VALID_UUID}`)
        .set('If-None-Match', `"${VALID_UUID}"`);

      expect(res.status).toBe(304);
      expect(res.headers['cache-control']).toContain('immutable');
      expect(res.headers['etag']).toBe(`"${VALID_UUID}"`);
      // loadBlob should NOT have been called (no disk I/O)
      expect(mockLoadBlob).not.toHaveBeenCalled();
    });

    it('returns 404 when blob is not found', async () => {
      mockLoadBlob.mockResolvedValue(null);

      const res = await request.get(`/api/blobs/${VALID_UUID}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Blob not found');
    });

    it('serves blob with correct headers', async () => {
      const data = Buffer.from('hello world');
      mockLoadBlob.mockResolvedValue({
        data,
        metadata: {
          mimeType: 'application/octet-stream',
          size: data.length,
          createdAt: '2025-01-01T00:00:00Z',
          hash: 'abc123',
        },
      });

      const res = await request.get(`/api/blobs/${VALID_UUID}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/octet-stream');
      expect(res.headers['cache-control']).toContain('immutable');
      expect(res.headers['etag']).toBe(`"${VALID_UUID}"`);
      expect(res.headers['content-length']).toBe(String(data.length));
      expect(res.body).toEqual(data);
    });

    it('returns 500 when loadBlob throws', async () => {
      mockLoadBlob.mockRejectedValue(new Error('disk failure'));

      const res = await request.get(`/api/blobs/${VALID_UUID}`);
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    });
  });

  describe('GET /api/blobs/:id/metadata', () => {
    it('returns 400 for invalid blob ID', async () => {
      const res = await request.get('/api/blobs/bad-id/metadata');
      expect(res.status).toBe(400);
    });

    it('returns 404 when metadata not found', async () => {
      mockGetMetadata.mockResolvedValue(null);

      const res = await request.get(`/api/blobs/${VALID_UUID}/metadata`);
      expect(res.status).toBe(404);
    });

    it('returns metadata with convenience url', async () => {
      mockGetMetadata.mockResolvedValue({
        mimeType: 'image/png',
        size: 1024,
        createdAt: '2025-06-01T00:00:00Z',
        hash: 'sha256hash',
      });

      const res = await request.get(`/api/blobs/${VALID_UUID}/metadata`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(VALID_UUID);
      expect(res.body.mimeType).toBe('image/png');
      expect(res.body.size).toBe(1024);
      expect(res.body.url).toBe(`/api/blobs/${VALID_UUID}`);
    });

    it('returns 500 when getMetadata throws', async () => {
      mockGetMetadata.mockRejectedValue(new Error('disk failure'));

      const res = await request.get(`/api/blobs/${VALID_UUID}/metadata`);
      expect(res.status).toBe(500);
    });
  });
});
