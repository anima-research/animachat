import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Database } from './index.js';
import fs from 'fs/promises';
import path from 'path';

const TEMP_BASE = '/tmp/animachat-test-db-user';

let db: Database;
let tempDir: string;
let originalCwd: string;

beforeAll(async () => {
  // Database constructor hardcodes './data', so we chdir to a temp dir
  originalCwd = process.cwd();
  tempDir = path.join(TEMP_BASE, `user-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tempDir, { recursive: true });
  process.chdir(tempDir);

  db = new Database();
  await db.init();
}, 30000);

afterAll(async () => {
  await db.close();
  process.chdir(originalCwd);
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('Database — User operations', () => {
  describe('createUser', () => {
    it('creates a user and returns it with all expected fields', async () => {
      const user = await db.createUser('alice@example.com', 'secret123', 'Alice');

      expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(user.email).toBe('alice@example.com');
      expect(user.name).toBe('Alice');
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.emailVerified).toBe(false);
      expect(user.ageVerified).toBe(false);
      expect(user.tosAccepted).toBe(false);
      expect(user.apiKeys).toEqual([]);
    });

    it('creates a user with emailVerified=true when flag is set', async () => {
      const user = await db.createUser('verified@example.com', 'pass', 'Verified', true);
      expect(user.emailVerified).toBe(true);
      expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('creates a user with ageVerified and tosAccepted when flags are set', async () => {
      const user = await db.createUser('full@example.com', 'pass', 'Full', true, true, true);
      expect(user.ageVerified).toBe(true);
      expect(user.ageVerifiedAt).toBeInstanceOf(Date);
      expect(user.tosAccepted).toBe(true);
      expect(user.tosAcceptedAt).toBeInstanceOf(Date);
    });

    it('throws when creating a user with a duplicate email', async () => {
      await db.createUser('dupe@example.com', 'pass1', 'Dupe1');
      await expect(
        db.createUser('dupe@example.com', 'pass2', 'Dupe2')
      ).rejects.toThrow('User already exists');
    });
  });

  describe('getUserById', () => {
    it('returns the user when they exist', async () => {
      const created = await db.createUser('byid@example.com', 'pass', 'ById');
      const fetched = await db.getUserById(created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.email).toBe('byid@example.com');
      expect(fetched!.name).toBe('ById');
    });

    it('returns null for a nonexistent user id', async () => {
      const result = await db.getUserById('nonexistent-id-00000');
      expect(result).toBeNull();
    });
  });

  describe('getUserByEmail', () => {
    it('returns the user by their email', async () => {
      const created = await db.createUser('byemail@example.com', 'pass', 'ByEmail');
      const fetched = await db.getUserByEmail('byemail@example.com');

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.email).toBe('byemail@example.com');
    });

    it('returns null for a nonexistent email', async () => {
      const result = await db.getUserByEmail('ghost@example.com');
      expect(result).toBeNull();
    });

    it('is case-SENSITIVE — different case returns null (characterization)', async () => {
      await db.createUser('CaseSensitive@example.com', 'pass', 'Case');
      // The DB stores email as-is and does an exact match
      const result = await db.getUserByEmail('casesensitive@example.com');
      expect(result).toBeNull();
    });
  });

  describe('validatePassword', () => {
    it('returns true for the correct password', async () => {
      await db.createUser('validate@example.com', 'correcthorse', 'Val');
      const valid = await db.validatePassword('validate@example.com', 'correcthorse');
      expect(valid).toBe(true);
    });

    it('returns false for an incorrect password', async () => {
      await db.createUser('wrongpass@example.com', 'right', 'WP');
      const valid = await db.validatePassword('wrongpass@example.com', 'wrong');
      expect(valid).toBe(false);
    });

    it('returns false for a nonexistent email', async () => {
      const valid = await db.validatePassword('nobody@example.com', 'any');
      expect(valid).toBe(false);
    });
  });

  describe('email verification', () => {
    it('creates a verification token and verifies the email', async () => {
      const user = await db.createUser('toverify@example.com', 'pass', 'Verify');
      expect(user.emailVerified).toBe(false);

      const token = await db.createEmailVerificationToken(user.id);
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);

      const verified = await db.verifyEmail(token);
      expect(verified).not.toBeNull();
      expect(verified!.id).toBe(user.id);
      expect(verified!.emailVerified).toBe(true);
      expect(verified!.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('returns null for a nonexistent token', async () => {
      const result = await db.verifyEmail('invalid-token-that-does-not-exist');
      expect(result).toBeNull();
    });

    it('returns null and deletes an expired token', async () => {
      const user = await db.createUser('expired@example.com', 'pass', 'Expired');
      const token = await db.createEmailVerificationToken(user.id);

      // Manually expire the token by reaching into private state
      const tokenMap = (db as any).emailVerificationTokens as Map<string, { userId: string; expiresAt: Date }>;
      const data = tokenMap.get(token);
      if (data) {
        data.expiresAt = new Date(Date.now() - 1000); // 1 second in the past
      }

      const result = await db.verifyEmail(token);
      expect(result).toBeNull();

      // Token should have been cleaned up
      expect(tokenMap.has(token)).toBe(false);
    });

    it('consumes the token — second verification returns null', async () => {
      const user = await db.createUser('onceverify@example.com', 'pass', 'Once');
      const token = await db.createEmailVerificationToken(user.id);

      const first = await db.verifyEmail(token);
      expect(first).not.toBeNull();

      const second = await db.verifyEmail(token);
      expect(second).toBeNull();
    });
  });

  describe('manual email verification', () => {
    it('marks an unverified user as verified', async () => {
      const user = await db.createUser('manual@example.com', 'pass', 'Manual');
      expect(user.emailVerified).toBe(false);

      const result = await db.verifyUserManually(user.id);
      expect(result).toBe(true);

      const fetched = await db.getUserById(user.id);
      expect(fetched!.emailVerified).toBe(true);
      expect(fetched!.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('returns true for an already-verified user (no-op)', async () => {
      const user = await db.createUser('alreadyverified@example.com', 'pass', 'AV', true);
      const result = await db.verifyUserManually(user.id);
      expect(result).toBe(true);
    });

    it('returns false for a nonexistent user', async () => {
      const result = await db.verifyUserManually('nonexistent-user-id');
      expect(result).toBe(false);
    });
  });

  describe('age verification', () => {
    it('marks a user as age-verified', async () => {
      const user = await db.createUser('age@example.com', 'pass', 'Age');
      expect(await db.isUserAgeVerified(user.id)).toBe(false);

      const result = await db.setAgeVerified(user.id);
      expect(result).not.toBeNull();
      expect(result!.ageVerified).toBe(true);
      expect(result!.ageVerifiedAt).toBeInstanceOf(Date);

      expect(await db.isUserAgeVerified(user.id)).toBe(true);
    });

    it('returns null for a nonexistent user', async () => {
      const result = await db.setAgeVerified('nonexistent');
      expect(result).toBeNull();
    });

    it('returns false for nonexistent user in isUserAgeVerified', async () => {
      const result = await db.isUserAgeVerified('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('ToS acceptance', () => {
    it('marks a user as having accepted ToS', async () => {
      const user = await db.createUser('tos@example.com', 'pass', 'Tos');
      expect(user.tosAccepted).toBe(false);

      const result = await db.setTosAccepted(user.id);
      expect(result).not.toBeNull();
      expect(result!.tosAccepted).toBe(true);
      expect(result!.tosAcceptedAt).toBeInstanceOf(Date);
    });

    it('returns null for a nonexistent user', async () => {
      const result = await db.setTosAccepted('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('password reset flow', () => {
    it('creates a reset token and resets the password', async () => {
      const user = await db.createUser('reset@example.com', 'oldpass', 'Reset');

      // Old password works
      expect(await db.validatePassword('reset@example.com', 'oldpass')).toBe(true);

      const token = await db.createPasswordResetToken(user.id);
      expect(typeof token).toBe('string');

      const resetUser = await db.resetPassword(token, 'newpass');
      expect(resetUser).not.toBeNull();
      expect(resetUser!.id).toBe(user.id);

      // New password works, old does not
      expect(await db.validatePassword('reset@example.com', 'newpass')).toBe(true);
      expect(await db.validatePassword('reset@example.com', 'oldpass')).toBe(false);
    });

    it('returns null for a nonexistent token', async () => {
      const result = await db.resetPassword('bad-token', 'newpass');
      expect(result).toBeNull();
    });

    it('returns null and deletes an expired token', async () => {
      const user = await db.createUser('expreset@example.com', 'pass', 'ExpReset');
      const token = await db.createPasswordResetToken(user.id);

      // Manually expire
      const tokenMap = (db as any).passwordResetTokens as Map<string, { userId: string; expiresAt: Date }>;
      const data = tokenMap.get(token);
      if (data) {
        data.expiresAt = new Date(Date.now() - 1000);
      }

      const result = await db.resetPassword(token, 'newpass');
      expect(result).toBeNull();
      expect(tokenMap.has(token)).toBe(false);
    });

    it('consumes the reset token — second reset returns null', async () => {
      const user = await db.createUser('oncereset@example.com', 'pass', 'OnceReset');
      const token = await db.createPasswordResetToken(user.id);

      const first = await db.resetPassword(token, 'new1');
      expect(first).not.toBeNull();

      const second = await db.resetPassword(token, 'new2');
      expect(second).toBeNull();
    });

    it('getPasswordResetTokenData returns token data for valid token', async () => {
      const user = await db.createUser('tokendata@example.com', 'pass', 'TD');
      const token = await db.createPasswordResetToken(user.id);

      const data = db.getPasswordResetTokenData(token);
      expect(data).not.toBeNull();
      expect(data!.userId).toBe(user.id);
      expect(data!.expiresAt).toBeInstanceOf(Date);
      expect(data!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('getPasswordResetTokenData returns null for expired token and cleans it up', async () => {
      const user = await db.createUser('expdata@example.com', 'pass', 'ED');
      const token = await db.createPasswordResetToken(user.id);

      // Manually expire
      const tokenMap = (db as any).passwordResetTokens as Map<string, { userId: string; expiresAt: Date }>;
      const data = tokenMap.get(token);
      if (data) {
        data.expiresAt = new Date(Date.now() - 1000);
      }

      const result = db.getPasswordResetTokenData(token);
      expect(result).toBeNull();
      expect(tokenMap.has(token)).toBe(false);
    });

    it('getPasswordResetTokenData returns null for nonexistent token', () => {
      const result = db.getPasswordResetTokenData('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getAllUsers', () => {
    it('returns all users including test users and those created in tests', async () => {
      const users = await db.getAllUsers();
      // Should include the test users created during init + our test users
      expect(users.length).toBeGreaterThan(0);
      // Verify our test user is in the list
      const alice = users.find(u => u.email === 'alice@example.com');
      expect(alice).toBeDefined();
    });
  });

  describe('state survives event replay', () => {
    let replayUserId: string;

    it('creates a user then reloads DB from same data dir — user still exists', async () => {
      const user = await db.createUser('replay@example.com', 'replaypass', 'Replay');
      replayUserId = user.id;

      // Create a fresh Database pointing to the same data dir
      const db2 = new Database();
      await db2.init();

      try {
        const fetched = await db2.getUserById(replayUserId);
        expect(fetched).not.toBeNull();
        expect(fetched!.email).toBe('replay@example.com');
        expect(fetched!.name).toBe('Replay');
      } finally {
        await db2.close();
      }
    });

    it('email verification survives event replay', async () => {
      // Verify the user's email in db
      const user = await db.createUser('replayverify@example.com', 'pass', 'RV');
      const token = await db.createEmailVerificationToken(user.id);
      await db.verifyEmail(token);

      // Reload
      const db2 = new Database();
      await db2.init();

      try {
        const fetched = await db2.getUserById(user.id);
        expect(fetched).not.toBeNull();
        expect(fetched!.emailVerified).toBe(true);
      } finally {
        await db2.close();
      }
    });

    it('password reset does NOT survive replay (characterization quirk)', async () => {
      // The password_reset event only cleans up tokens, doesn't store new hash
      const user = await db.createUser('replayreset@example.com', 'oldpass', 'RR');
      const token = await db.createPasswordResetToken(user.id);
      await db.resetPassword(token, 'newpass');

      // In current DB instance, new password works
      expect(await db.validatePassword('replayreset@example.com', 'newpass')).toBe(true);

      // After replay, the old password from user_created is restored
      const db2 = new Database();
      await db2.init();

      try {
        expect(await db2.validatePassword('replayreset@example.com', 'oldpass')).toBe(true);
        expect(await db2.validatePassword('replayreset@example.com', 'newpass')).toBe(false);
      } finally {
        await db2.close();
      }
    });

    it('age verification does NOT survive replay (characterization quirk)', async () => {
      // setAgeVerified logs user_age_verified, but replayEvent has no handler for it
      const user = await db.createUser('replayage@example.com', 'pass', 'RA');
      await db.setAgeVerified(user.id);

      // In current instance it's true
      expect(await db.isUserAgeVerified(user.id)).toBe(true);

      // After replay, the ageVerified from user_created (false) is restored
      const db2 = new Database();
      await db2.init();

      try {
        expect(await db2.isUserAgeVerified(user.id)).toBe(false);
      } finally {
        await db2.close();
      }
    });

    it('ToS acceptance does NOT survive replay (characterization quirk)', async () => {
      // setTosAccepted logs user_tos_accepted, but replayEvent has no handler for it
      const user = await db.createUser('replaytos@example.com', 'pass', 'RT');
      await db.setTosAccepted(user.id);

      const fetched = await db.getUserById(user.id);
      expect(fetched!.tosAccepted).toBe(true);

      const db2 = new Database();
      await db2.init();

      try {
        const replayed = await db2.getUserById(user.id);
        expect(replayed!.tosAccepted).toBe(false);
      } finally {
        await db2.close();
      }
    });

    it('validatePassword works after replay for initial password', async () => {
      const user = await db.createUser('replayvalid@example.com', 'mypass', 'VP');

      const db2 = new Database();
      await db2.init();

      try {
        expect(await db2.validatePassword('replayvalid@example.com', 'mypass')).toBe(true);
        expect(await db2.validatePassword('replayvalid@example.com', 'wrongpass')).toBe(false);
      } finally {
        await db2.close();
      }
    });
  });

  describe('init creates test users when no users exist', () => {
    it('auto-creates test user on fresh DB init', async () => {
      // The DB we have was initialized on a fresh data dir, so test users should exist
      const testUser = await db.getUserByEmail('test@example.com');
      expect(testUser).not.toBeNull();
      expect(testUser!.id).toBe('test-user-id-12345');
      expect(testUser!.name).toBe('Test User');
    });

    it('auto-creates additional test users on fresh DB init', async () => {
      const cassandra = await db.getUserByEmail('cassandra@oracle.test');
      expect(cassandra).not.toBeNull();
      expect(cassandra!.name).toBe('Cassandra');

      const bartleby = await db.getUserByEmail('bartleby@scrivener.test');
      expect(bartleby).not.toBeNull();

      const scheherazade = await db.getUserByEmail('scheherazade@1001nights.test');
      expect(scheherazade).not.toBeNull();
    });
  });
});
