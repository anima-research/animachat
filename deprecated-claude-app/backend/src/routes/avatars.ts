import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import multer, { FileFilterCallback } from 'multer';
import sharp from 'sharp';

// Thumbnail size (128px for retina displays, will show at 32-64px)
const THUMBNAIL_SIZE = 128;

// Extend Request to include multer file and userId from auth middleware
interface MulterRequest extends Request {
  file?: Express.Multer.File;
  userId?: string;
}

// ES module compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Avatar storage paths - configurable via environment variable
// In production, this should point to the static files directory served by nginx
// e.g., AVATARS_PATH=/var/www/frontend/avatars
// In development, we use the frontend/public/avatars directory
const getAvatarsBasePath = () => {
  if (process.env.AVATARS_PATH) {
    return process.env.AVATARS_PATH;
  }
  // Development default: From dist/routes/ go up 3 levels to deprecated-claude-app, then into frontend
  return path.join(__dirname, '../../../frontend/public/avatars');
};

const AVATARS_BASE_PATH = getAvatarsBasePath();
const SYSTEM_PACKS_PATH = path.join(AVATARS_BASE_PATH, 'system');
const USER_PACKS_PATH = path.join(AVATARS_BASE_PATH, 'users');

console.log(`[Avatars] Using avatar storage path: ${AVATARS_BASE_PATH}`);

// Ensure directories exist
async function ensureDirectories() {
  try {
    await fs.mkdir(SYSTEM_PACKS_PATH, { recursive: true });
    await fs.mkdir(USER_PACKS_PATH, { recursive: true });
  } catch (error: any) {
    console.error(`[Avatars] Failed to create avatar directories at ${AVATARS_BASE_PATH}: ${error.message}`);
    console.error(`[Avatars] Set AVATARS_PATH environment variable to a writable directory`);
    throw error;
  }
}

// Configure multer for avatar uploads - use memory storage for processing with sharp
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PNG, JPEG, GIF, and WebP are allowed.'));
    }
  }
});

// Process and save avatar with thumbnail
async function processAndSaveAvatar(
  buffer: Buffer,
  packPath: string,
  canonicalId: string,
  originalExt: string
): Promise<{ thumbnail: string; original: string }> {
  await fs.mkdir(packPath, { recursive: true });
  
  // Determine output format (convert to webp for efficiency, except for gif)
  const isGif = originalExt.toLowerCase() === '.gif';
  const thumbExt = isGif ? '.gif' : '.webp';
  const origExt = isGif ? '.gif' : '.webp';
  
  const thumbFilename = `${canonicalId}.thumb${thumbExt}`;
  const origFilename = `${canonicalId}${origExt}`;
  
  // Generate thumbnail
  let thumbPipeline = sharp(buffer).resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
    fit: 'cover',
    position: 'center'
  });
  
  if (isGif) {
    // For GIFs, keep as gif but resize
    await thumbPipeline.gif().toFile(path.join(packPath, thumbFilename));
  } else {
    // Convert to webp for smaller size
    await thumbPipeline.webp({ quality: 85 }).toFile(path.join(packPath, thumbFilename));
  }
  
  // Save original (optionally convert to webp for non-gifs)
  if (isGif) {
    await fs.writeFile(path.join(packPath, origFilename), buffer);
  } else {
    await sharp(buffer).webp({ quality: 90 }).toFile(path.join(packPath, origFilename));
  }
  
  return { thumbnail: thumbFilename, original: origFilename };
}

// Helper to read pack.json
async function readPackJson(packPath: string) {
  const packJsonPath = path.join(packPath, 'pack.json');
  try {
    const content = await fs.readFile(packJsonPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// Helper to write pack.json
async function writePackJson(packPath: string, pack: any) {
  const packJsonPath = path.join(packPath, 'pack.json');
  await fs.writeFile(packJsonPath, JSON.stringify(pack, null, 2));
}

// GET /avatars/packs - List all available packs (system + user's own)
router.get('/packs', async (req: Request, res) => {
  try {
    await ensureDirectories();
    const userId = (req as any).userId;
    const packs: any[] = [];

    // Read system packs
    try {
      const systemDirs = await fs.readdir(SYSTEM_PACKS_PATH);
      for (const dir of systemDirs) {
        const packPath = path.join(SYSTEM_PACKS_PATH, dir);
        const stat = await fs.stat(packPath);
        if (stat.isDirectory()) {
          const pack = await readPackJson(packPath);
          if (pack) {
            packs.push({ ...pack, isSystem: true, path: `system/${dir}` });
          }
        }
      }
    } catch (e) {
      // System packs dir might not exist yet
    }

    // Read user packs
    if (userId) {
      const userPacksPath = path.join(USER_PACKS_PATH, userId);
      try {
        const userDirs = await fs.readdir(userPacksPath);
        for (const dir of userDirs) {
          const packPath = path.join(userPacksPath, dir);
          const stat = await fs.stat(packPath);
          if (stat.isDirectory()) {
            const pack = await readPackJson(packPath);
            if (pack) {
              packs.push({ ...pack, isSystem: false, path: `users/${userId}/${dir}` });
            }
          }
        }
      } catch (e) {
        // User packs dir might not exist yet
      }
    }

    res.json(packs);
  } catch (error) {
    console.error('Error listing avatar packs:', error);
    res.status(500).json({ error: 'Failed to list avatar packs' });
  }
});

// GET /avatars/packs/:packId - Get a specific pack
router.get('/packs/:packId', async (req: Request, res) => {
  try {
    const { packId } = req.params;
    const userId = (req as any).userId;

    // Try system pack first
    let packPath = path.join(SYSTEM_PACKS_PATH, packId);
    let pack = await readPackJson(packPath);
    
    if (!pack && userId) {
      // Try user pack
      packPath = path.join(USER_PACKS_PATH, userId, packId);
      pack = await readPackJson(packPath);
    }

    if (!pack) {
      return res.status(404).json({ error: 'Pack not found' });
    }

    // Get list of avatar files
    const files = await fs.readdir(packPath);
    const avatarFiles = files.filter(f => 
      ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(path.extname(f).toLowerCase())
    );

    res.json({ ...pack, avatarFiles });
  } catch (error) {
    console.error('Error getting avatar pack:', error);
    res.status(500).json({ error: 'Failed to get avatar pack' });
  }
});

// POST /avatars/packs - Create a new user pack
router.post('/packs', async (req: Request, res) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id, name, description } = req.body;
    if (!id || !name) {
      return res.status(400).json({ error: 'Pack ID and name are required' });
    }

    // Validate ID format (alphanumeric, hyphens, underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return res.status(400).json({ error: 'Pack ID must be alphanumeric with hyphens or underscores' });
    }

    const packPath = path.join(USER_PACKS_PATH, userId, id);
    
    // Check if pack already exists
    try {
      await fs.access(packPath);
      return res.status(409).json({ error: 'Pack with this ID already exists' });
    } catch {
      // Pack doesn't exist, we can create it
    }

    await fs.mkdir(packPath, { recursive: true });

    const pack = {
      id,
      name,
      description: description || '',
      version: '1.0.0',
      author: 'User',
      isSystem: false,
      avatars: {}
    };

    await writePackJson(packPath, pack);

    res.status(201).json(pack);
  } catch (error) {
    console.error('Error creating avatar pack:', error);
    res.status(500).json({ error: 'Failed to create avatar pack' });
  }
});

// PUT /avatars/packs/:packId - Update pack metadata
router.put('/packs/:packId', async (req: Request, res) => {
  try {
    const userId = (req as any).userId;
    const { packId } = req.params;
    
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const packPath = path.join(USER_PACKS_PATH, userId, packId);
    const pack = await readPackJson(packPath);

    if (!pack) {
      return res.status(404).json({ error: 'Pack not found' });
    }

    const { name, description, history } = req.body;
    
    const updatedPack = {
      ...pack,
      name: name ?? pack.name,
      description: description ?? pack.description,
      history: history ?? pack.history,
    };

    await writePackJson(packPath, updatedPack);

    res.json(updatedPack);
  } catch (error) {
    console.error('Error updating avatar pack:', error);
    res.status(500).json({ error: 'Failed to update avatar pack' });
  }
});

// POST /avatars/packs/:packId/avatars - Upload an avatar to a pack
router.post('/packs/:packId/avatars', upload.single('avatar'), async (req: MulterRequest, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { packId } = req.params;
    const { canonicalId } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!canonicalId) {
      return res.status(400).json({ error: 'canonicalId is required' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const packPath = path.join(USER_PACKS_PATH, userId, packId);
    const pack = await readPackJson(packPath);

    if (!pack) {
      return res.status(404).json({ error: 'Pack not found' });
    }

    // Process image and create thumbnail
    const originalExt = path.extname(req.file.originalname);
    const { thumbnail, original } = await processAndSaveAvatar(
      req.file.buffer,
      packPath,
      canonicalId,
      originalExt
    );

    // Update pack.json with thumbnail (used for display) and original reference
    pack.avatars[canonicalId] = thumbnail;
    if (!pack.originals) pack.originals = {};
    pack.originals[canonicalId] = original;
    await writePackJson(packPath, pack);

    res.json({ 
      success: true, 
      canonicalId, 
      thumbnail,
      original,
      path: `/avatars/users/${userId}/${packId}/${thumbnail}`
    });
  } catch (error) {
    console.error('Error uploading avatar:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// DELETE /avatars/packs/:packId/avatars/:canonicalId - Remove an avatar from a pack
router.delete('/packs/:packId/avatars/:canonicalId', async (req: Request, res) => {
  try {
    const userId = (req as any).userId;
    const { packId, canonicalId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const packPath = path.join(USER_PACKS_PATH, userId, packId);
    const pack = await readPackJson(packPath);

    if (!pack) {
      return res.status(404).json({ error: 'Pack not found' });
    }

    const thumbFilename = pack.avatars[canonicalId];
    const origFilename = pack.originals?.[canonicalId];
    
    if (!thumbFilename) {
      return res.status(404).json({ error: 'Avatar not found in pack' });
    }

    // Delete both thumbnail and original files
    for (const filename of [thumbFilename, origFilename]) {
      if (filename) {
        try {
          await fs.unlink(path.join(packPath, filename));
        } catch {
          // File might already be deleted
        }
      }
    }

    // Update pack.json
    delete pack.avatars[canonicalId];
    if (pack.originals) delete pack.originals[canonicalId];
    await writePackJson(packPath, pack);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting avatar:', error);
    res.status(500).json({ error: 'Failed to delete avatar' });
  }
});

// PUT /avatars/packs/:packId/colors/:canonicalId - Set color for a model in a pack
router.put('/packs/:packId/colors/:canonicalId', async (req: Request, res) => {
  try {
    const userId = (req as any).userId;
    const { packId, canonicalId } = req.params;
    const { color } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const packPath = path.join(USER_PACKS_PATH, userId, packId);
    const pack = await readPackJson(packPath);

    if (!pack) {
      return res.status(404).json({ error: 'Pack not found' });
    }

    // Initialize colors object if it doesn't exist
    if (!pack.colors) {
      pack.colors = {};
    }

    if (color) {
      // Set or update color
      pack.colors[canonicalId] = color;
    } else {
      // Remove color if empty/null
      delete pack.colors[canonicalId];
    }

    await writePackJson(packPath, pack);

    res.json({ success: true, color: pack.colors[canonicalId] });
  } catch (error) {
    console.error('Error updating avatar color:', error);
    res.status(500).json({ error: 'Failed to update avatar color' });
  }
});

// DELETE /avatars/packs/:packId - Delete an entire pack
router.delete('/packs/:packId', async (req: Request, res) => {
  try {
    const userId = (req as any).userId;
    const { packId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const packPath = path.join(USER_PACKS_PATH, userId, packId);
    
    // Check if pack exists
    try {
      await fs.access(packPath);
    } catch {
      return res.status(404).json({ error: 'Pack not found' });
    }

    // Remove directory recursively
    await fs.rm(packPath, { recursive: true });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting avatar pack:', error);
    res.status(500).json({ error: 'Failed to delete avatar pack' });
  }
});

// POST /avatars/packs/:packId/clone - Clone a system pack to user packs
router.post('/packs/:packId/clone', async (req: Request, res) => {
  try {
    const userId = (req as any).userId;
    const { packId } = req.params;
    const { newId, newName } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!newId || !newName) {
      return res.status(400).json({ error: 'newId and newName are required' });
    }

    // Find source pack (try system first, then user)
    let sourcePath = path.join(SYSTEM_PACKS_PATH, packId);
    let sourcePack = await readPackJson(sourcePath);
    
    if (!sourcePack) {
      sourcePath = path.join(USER_PACKS_PATH, userId, packId);
      sourcePack = await readPackJson(sourcePath);
    }

    if (!sourcePack) {
      return res.status(404).json({ error: 'Source pack not found' });
    }

    const destPath = path.join(USER_PACKS_PATH, userId, newId);

    // Check if dest already exists
    try {
      await fs.access(destPath);
      return res.status(409).json({ error: 'Pack with this ID already exists' });
    } catch {
      // Good, it doesn't exist
    }

    // Copy the directory
    await fs.mkdir(destPath, { recursive: true });

    // Copy all files
    const files = await fs.readdir(sourcePath);
    for (const file of files) {
      const srcFile = path.join(sourcePath, file);
      const destFile = path.join(destPath, file);
      await fs.copyFile(srcFile, destFile);
    }

    // Update pack.json with new metadata
    const newPack = {
      ...sourcePack,
      id: newId,
      name: newName,
      isSystem: false,
      author: 'User',
      history: `Cloned from ${sourcePack.name}. ${sourcePack.history || ''}`
    };

    await writePackJson(destPath, newPack);

    res.status(201).json(newPack);
  } catch (error) {
    console.error('Error cloning avatar pack:', error);
    res.status(500).json({ error: 'Failed to clone avatar pack' });
  }
});

export default router;

