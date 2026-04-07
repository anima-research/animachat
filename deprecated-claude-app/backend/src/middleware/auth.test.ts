import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { generateToken, verifyToken, authenticateToken } from './auth.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Helper to create a minimal mock response object
function createMockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('generateToken', () => {
  it('returns a valid JWT string containing the userId', () => {
    const token = generateToken('user-123');
    expect(typeof token).toBe('string');
    // Decode without verification to inspect payload
    const decoded = jwt.decode(token) as any;
    expect(decoded.userId).toBe('user-123');
  });

  it('produces a token that jwt.verify accepts with the correct secret', () => {
    const token = generateToken('user-456');
    const payload = jwt.verify(token, JWT_SECRET) as any;
    expect(payload.userId).toBe('user-456');
  });

  it('sets a 7-day expiration', () => {
    const token = generateToken('user-789');
    const decoded = jwt.decode(token) as any;
    // exp - iat should be 7 days in seconds
    const sevenDaysInSeconds = 7 * 24 * 60 * 60;
    expect(decoded.exp - decoded.iat).toBe(sevenDaysInSeconds);
  });

  it('produces different tokens for different user IDs', () => {
    const token1 = generateToken('user-a');
    const token2 = generateToken('user-b');
    expect(token1).not.toBe(token2);
  });
});

describe('verifyToken', () => {
  it('returns { userId } for a valid token', () => {
    const token = generateToken('user-100');
    const result = verifyToken(token);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe('user-100');
  });

  it('returns null for a token signed with the wrong secret', () => {
    const wrongToken = jwt.sign({ userId: 'user-100' }, 'wrong-secret', { expiresIn: '7d' });
    const result = verifyToken(wrongToken);
    expect(result).toBeNull();
  });

  it('returns null for an expired token', () => {
    const expiredToken = jwt.sign({ userId: 'user-100' }, JWT_SECRET, { expiresIn: '-1s' });
    const result = verifyToken(expiredToken);
    expect(result).toBeNull();
  });

  it('returns null for a completely malformed token', () => {
    const result = verifyToken('not-a-real-token');
    expect(result).toBeNull();
  });

  it('returns null for an empty string', () => {
    const result = verifyToken('');
    expect(result).toBeNull();
  });

  it('returns null for a token with a tampered payload', () => {
    const token = generateToken('user-legit');
    // Split the JWT and modify the payload
    const parts = token.split('.');
    // Decode payload, change it, re-encode without re-signing
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    payload.userId = 'user-hacker';
    parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const tamperedToken = parts.join('.');
    const result = verifyToken(tamperedToken);
    expect(result).toBeNull();
  });
});

describe('authenticateToken', () => {
  it('calls next() and sets req.userId when a valid token is provided', () => {
    const token = generateToken('user-200');
    const req: any = {
      headers: { authorization: `Bearer ${token}` },
    };
    const res = createMockRes();
    const next = vi.fn();

    authenticateToken(req, res, next);

    // jwt.verify is async via callback, but executes synchronously for valid tokens
    // Wait a tick to let the callback execute
    expect(next).toHaveBeenCalledOnce();
    expect(req.userId).toBe('user-200');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when no authorization header is present', () => {
    const req: any = {
      headers: {},
    };
    const res = createMockRes();
    const next = vi.fn();

    authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Access token required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when authorization header has no token after Bearer', () => {
    const req: any = {
      headers: { authorization: 'Bearer ' },
    };
    const res = createMockRes();
    const next = vi.fn();

    authenticateToken(req, res, next);

    // 'Bearer '.split(' ')[1] is '', which is falsy
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Access token required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when token is invalid', () => {
    const req: any = {
      headers: { authorization: 'Bearer invalid-token-here' },
    };
    const res = createMockRes();
    const next = vi.fn();

    authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when token is expired', () => {
    const expiredToken = jwt.sign({ userId: 'user-200' }, JWT_SECRET, { expiresIn: '-1s' });
    const req: any = {
      headers: { authorization: `Bearer ${expiredToken}` },
    };
    const res = createMockRes();
    const next = vi.fn();

    authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when token is signed with wrong secret', () => {
    const wrongToken = jwt.sign({ userId: 'user-200' }, 'wrong-secret', { expiresIn: '7d' });
    const req: any = {
      headers: { authorization: `Bearer ${wrongToken}` },
    };
    const res = createMockRes();
    const next = vi.fn();

    authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when authorization header is just "Bearer" with no space/token', () => {
    const req: any = {
      headers: { authorization: 'Bearer' },
    };
    const res = createMockRes();
    const next = vi.fn();

    authenticateToken(req, res, next);

    // 'Bearer'.split(' ')[1] is undefined, which is falsy
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Access token required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('extracts userId correctly from a token with a complex user ID', () => {
    const complexId = 'usr_a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const token = generateToken(complexId);
    const req: any = {
      headers: { authorization: `Bearer ${token}` },
    };
    const res = createMockRes();
    const next = vi.fn();

    authenticateToken(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.userId).toBe(complexId);
  });
});
