import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

/**
 * Avatars route characterization tests.
 *
 * The avatars router is a plain Router() exported as `default` —
 * it reads AVATARS_PATH from the environment, falling back to a
 * relative path.  We set AVATARS_PATH to a temp dir so all
 * file-system operations are fully isolated.
 *
 * We must call vi.resetModules() before each dynamic import because
 * the module caches AVATARS_BASE_PATH at the top-level scope.
 *
 * The router expects `req.userId` to be set by upstream auth middleware.
 */

let app: express.Express;
let request: supertest.Agent;
let tmpDir: string;

/** Simple middleware that attaches a fake userId (simulates auth) */
function fakeAuth(userId: string) {
  return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as any).userId = userId;
    next();
  };
}

const TEST_USER_ID = 'test-user-123';

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'avatar-test-'));
  process.env.AVATARS_PATH = tmpDir;

  // Reset module cache so the avatar router picks up the fresh AVATARS_PATH.
  // The module caches AVATARS_BASE_PATH at the top level.
  vi.resetModules();
  const mod = await import('./avatars.js');
  const avatarRouter = mod.default;

  app = express();
  app.use(express.json());
  app.use(fakeAuth(TEST_USER_ID));
  app.use('/api/avatars', avatarRouter);

  request = supertest(app);
});

afterEach(async () => {
  delete process.env.AVATARS_PATH;
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper – create a pack on disk so the router can find it
// ---------------------------------------------------------------------------
async function createSystemPack(
  packId: string,
  packJson: Record<string, any>,
  files: Record<string, Buffer> = {}
) {
  const packDir = path.join(tmpDir, 'system', packId);
  await mkdir(packDir, { recursive: true });
  await writeFile(path.join(packDir, 'pack.json'), JSON.stringify(packJson));
  for (const [name, data] of Object.entries(files)) {
    await writeFile(path.join(packDir, name), data);
  }
  return packDir;
}

async function createUserPack(
  userId: string,
  packId: string,
  packJson: Record<string, any>,
  files: Record<string, Buffer> = {}
) {
  const packDir = path.join(tmpDir, 'users', userId, packId);
  await mkdir(packDir, { recursive: true });
  await writeFile(path.join(packDir, 'pack.json'), JSON.stringify(packJson));
  for (const [name, data] of Object.entries(files)) {
    await writeFile(path.join(packDir, name), data);
  }
  return packDir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Avatars routes', () => {
  describe('GET /api/avatars/packs', () => {
    it('returns empty array when no packs exist', async () => {
      const res = await request.get('/api/avatars/packs');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('lists system packs', async () => {
      await createSystemPack('default', {
        id: 'default',
        name: 'Default Pack',
        avatars: { 'claude': 'claude.webp' },
      });

      const res = await request.get('/api/avatars/packs');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe('default');
      expect(res.body[0].isSystem).toBe(true);
      expect(res.body[0].path).toBe('system/default');
    });

    it('lists user packs alongside system packs', async () => {
      await createSystemPack('sys-pack', { id: 'sys-pack', name: 'System', avatars: {} });
      await createUserPack(TEST_USER_ID, 'my-pack', { id: 'my-pack', name: 'My Pack', avatars: {} });

      const res = await request.get('/api/avatars/packs');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const sysPack = res.body.find((p: any) => p.id === 'sys-pack');
      const userPack = res.body.find((p: any) => p.id === 'my-pack');

      expect(sysPack.isSystem).toBe(true);
      expect(userPack.isSystem).toBe(false);
      expect(userPack.path).toContain(TEST_USER_ID);
    });
  });

  describe('GET /api/avatars/packs/:packId', () => {
    it('returns 404 for non-existent pack', async () => {
      const res = await request.get('/api/avatars/packs/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Pack not found');
    });

    it('returns system pack with avatar file list', async () => {
      // Create a 1x1 PNG pixel for the avatar file
      const pngPixel = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      await createSystemPack('pack1', { id: 'pack1', name: 'Pack 1', avatars: {} }, {
        'avatar.png': pngPixel,
      });

      const res = await request.get('/api/avatars/packs/pack1');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('pack1');
      expect(res.body.avatarFiles).toContain('avatar.png');
    });

    it('returns user pack when system pack not found', async () => {
      await createUserPack(TEST_USER_ID, 'user-only', {
        id: 'user-only',
        name: 'User Only Pack',
        avatars: {},
      });

      const res = await request.get('/api/avatars/packs/user-only');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('user-only');
    });
  });

  describe('POST /api/avatars/packs', () => {
    it('creates a new user pack', async () => {
      const res = await request
        .post('/api/avatars/packs')
        .send({ id: 'new-pack', name: 'New Pack', description: 'A test pack' });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('new-pack');
      expect(res.body.name).toBe('New Pack');
      expect(res.body.isSystem).toBe(false);

      // Verify pack.json was written
      const packJsonStr = await readFile(
        path.join(tmpDir, 'users', TEST_USER_ID, 'new-pack', 'pack.json'),
        'utf-8'
      );
      const packJson = JSON.parse(packJsonStr);
      expect(packJson.id).toBe('new-pack');
    });

    it('returns 400 if id or name missing', async () => {
      const res = await request.post('/api/avatars/packs').send({ id: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('rejects invalid pack ID format', async () => {
      const res = await request
        .post('/api/avatars/packs')
        .send({ id: 'bad id!@#', name: 'Bad' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('alphanumeric');
    });

    it('returns 409 for duplicate pack ID', async () => {
      await createUserPack(TEST_USER_ID, 'existing', { id: 'existing', name: 'Exists', avatars: {} });

      const res = await request
        .post('/api/avatars/packs')
        .send({ id: 'existing', name: 'New' });
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already exists');
    });

    it('returns 401 when userId is missing', async () => {
      // Build a separate app without auth middleware
      const mod = await import('./avatars.js');
      const noAuthApp = express();
      noAuthApp.use(express.json());
      noAuthApp.use('/api/avatars', mod.default);

      const res = await supertest(noAuthApp)
        .post('/api/avatars/packs')
        .send({ id: 'pack', name: 'Pack' });
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/avatars/packs/:packId', () => {
    it('updates pack metadata', async () => {
      await createUserPack(TEST_USER_ID, 'editable', {
        id: 'editable',
        name: 'Old Name',
        description: 'Old desc',
        avatars: {},
      });

      const res = await request
        .put('/api/avatars/packs/editable')
        .send({ name: 'New Name', description: 'New desc' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('New Name');
      expect(res.body.description).toBe('New desc');
    });

    it('returns 404 for non-existent pack', async () => {
      const res = await request
        .put('/api/avatars/packs/nonexistent')
        .send({ name: 'X' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/avatars/packs/:packId/avatars/:canonicalId', () => {
    it('deletes an avatar and updates pack.json', async () => {
      const packDir = await createUserPack(TEST_USER_ID, 'pack-del', {
        id: 'pack-del',
        name: 'Del Pack',
        avatars: { 'model-a': 'model-a.thumb.webp' },
        originals: { 'model-a': 'model-a.webp' },
      });
      // Create the actual files
      await writeFile(path.join(packDir, 'model-a.thumb.webp'), Buffer.from('thumb'));
      await writeFile(path.join(packDir, 'model-a.webp'), Buffer.from('orig'));

      const res = await request.delete('/api/avatars/packs/pack-del/avatars/model-a');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify pack.json was updated
      const packJson = JSON.parse(await readFile(path.join(packDir, 'pack.json'), 'utf-8'));
      expect(packJson.avatars['model-a']).toBeUndefined();
    });

    it('returns 404 if avatar not in pack', async () => {
      await createUserPack(TEST_USER_ID, 'pack-nodel', {
        id: 'pack-nodel',
        name: 'Pack',
        avatars: {},
      });

      const res = await request.delete('/api/avatars/packs/pack-nodel/avatars/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Avatar not found');
    });

    it('returns 404 if pack does not exist', async () => {
      const res = await request.delete('/api/avatars/packs/ghost/avatars/foo');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/avatars/packs/:packId/colors/:canonicalId', () => {
    it('sets a color for a canonical ID', async () => {
      await createUserPack(TEST_USER_ID, 'color-pack', {
        id: 'color-pack',
        name: 'Color Pack',
        avatars: {},
      });

      const res = await request
        .put('/api/avatars/packs/color-pack/colors/model-x')
        .send({ color: '#ff0000' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.color).toBe('#ff0000');
    });

    it('removes a color when color is empty', async () => {
      await createUserPack(TEST_USER_ID, 'color-pack2', {
        id: 'color-pack2',
        name: 'Color Pack 2',
        avatars: {},
        colors: { 'model-x': '#00ff00' },
      });

      const res = await request
        .put('/api/avatars/packs/color-pack2/colors/model-x')
        .send({ color: '' });

      expect(res.status).toBe(200);
    });

    it('returns 404 for non-existent pack', async () => {
      const res = await request
        .put('/api/avatars/packs/nope/colors/model-x')
        .send({ color: '#ff0000' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/avatars/packs/:packId', () => {
    it('deletes an entire pack', async () => {
      await createUserPack(TEST_USER_ID, 'to-delete', {
        id: 'to-delete',
        name: 'Delete Me',
        avatars: {},
      });

      const res = await request.delete('/api/avatars/packs/to-delete');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Directory should be gone
      const userDir = path.join(tmpDir, 'users', TEST_USER_ID);
      const remaining = await readdir(userDir).catch(() => []);
      expect(remaining).not.toContain('to-delete');
    });

    it('returns 404 for non-existent pack', async () => {
      const res = await request.delete('/api/avatars/packs/ghost-pack');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/avatars/packs/:packId/clone', () => {
    it('clones a system pack to user packs', async () => {
      await createSystemPack('source', {
        id: 'source',
        name: 'Source Pack',
        description: 'Original',
        avatars: { 'a': 'a.webp' },
      }, {
        'a.webp': Buffer.from('avatar-data'),
      });

      const res = await request
        .post('/api/avatars/packs/source/clone')
        .send({ newId: 'cloned', newName: 'Cloned Pack' });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('cloned');
      expect(res.body.name).toBe('Cloned Pack');
      expect(res.body.isSystem).toBe(false);
      expect(res.body.history).toContain('Cloned from Source Pack');

      // Verify files were copied
      const clonedDir = path.join(tmpDir, 'users', TEST_USER_ID, 'cloned');
      const files = await readdir(clonedDir);
      expect(files).toContain('a.webp');
      expect(files).toContain('pack.json');
    });

    it('returns 400 if newId or newName missing', async () => {
      await createSystemPack('src', { id: 'src', name: 'Src', avatars: {} });

      const res = await request
        .post('/api/avatars/packs/src/clone')
        .send({ newId: 'x' });
      expect(res.status).toBe(400);
    });

    it('returns 404 if source pack does not exist', async () => {
      const res = await request
        .post('/api/avatars/packs/ghost/clone')
        .send({ newId: 'c', newName: 'C' });
      expect(res.status).toBe(404);
    });

    it('returns 409 if destination already exists', async () => {
      await createSystemPack('src2', { id: 'src2', name: 'Src2', avatars: {} });
      await createUserPack(TEST_USER_ID, 'taken', { id: 'taken', name: 'Taken', avatars: {} });

      const res = await request
        .post('/api/avatars/packs/src2/clone')
        .send({ newId: 'taken', newName: 'Clone' });
      expect(res.status).toBe(409);
    });
  });
});
