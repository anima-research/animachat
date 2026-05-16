import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: string;
  body: any;
  params: any;
}

// JWT_SECRET is required AND must be sufficiently long. Tokens are signed with
// HS256; a short secret can be brute-forced offline from any issued token,
// after which an attacker can forge auth tokens for any user. RFC 7518 requires
// at least 256 bits of entropy for HS256 keys — we enforce 32 characters as a
// floor (ASCII chars are ~7 bits each, so 32 chars ≈ 224 bits worst case; the
// recommendation in error text is 64 hex chars = 256 bits exactly).
//
// History: previously the server fell back to a hardcoded default visible in
// source code. That was fixed; this commit additionally rejects short or
// placeholder secrets at startup so a weak rotation can't slip in unnoticed.
const MIN_SECRET_LENGTH = 32;

// Well-known placeholder values that have appeared in env.example or similar.
// These pass the length check but are obviously not real secrets.
// Stored lowercase; comparison is case-insensitive (Greptile review of #91).
const KNOWN_PLACEHOLDER_SECRETS: ReadonlySet<string> = new Set([
  'your-secret-key-change-in-production',
  'local-dev-secret-change-in-production',
  'changeme',
  'change-me',
  'change_me',
  'your-jwt-secret-here',
]);

const SECRET_GENERATION_HINT =
  'Generate a strong secret with:\n    openssl rand -hex 32';

function getJwtSecret(): string {
  const raw = process.env.JWT_SECRET;
  if (!raw) {
    throw new Error(
      `JWT_SECRET environment variable is required.\n${SECRET_GENERATION_HINT}`,
    );
  }

  // Trim whitespace before any check (Greptile review of #91): a value like
  // `"               x               "` from a misconfigured env file or
  // copy-paste mishap is 33 characters long and would pass the length guard
  // while having ~1 character of effective entropy. We trim once and use the
  // trimmed value for both validation and signing.
  const secret = raw.trim();

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET is too short (${secret.length} chars after trimming whitespace; ` +
      `minimum ${MIN_SECRET_LENGTH}). A short secret can be brute-forced offline ` +
      `from an issued token, letting an attacker forge auth tokens for any user.\n` +
      `${SECRET_GENERATION_HINT}`,
    );
  }

  // Case-insensitive placeholder check (Greptile review of #91): a developer
  // copying the well-known value with any casing variation (e.g.
  // `Your-Secret-Key-Change-In-Production`) would otherwise bypass the
  // blocklist while still being a meaningless secret.
  if (KNOWN_PLACEHOLDER_SECRETS.has(secret.toLowerCase())) {
    throw new Error(
      `JWT_SECRET is set to a well-known placeholder value. ` +
      `This is not a real secret.\n${SECRET_GENERATION_HINT}`,
    );
  }

  return secret;
}
const JWT_SECRET: string = getJwtSecret();

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    req.userId = (decoded as any).userId;
    next();
  });
}

export function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string };
  } catch {
    return null;
  }
}
