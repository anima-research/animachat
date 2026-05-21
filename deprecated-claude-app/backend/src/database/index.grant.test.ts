import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Database } from './index.js';
import { GrantInfo, GrantCapability } from '@deprecated-claude/shared';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';

const TEMP_BASE = '/tmp/animachat-test-db-grant';

let db: Database;
let tempDir: string;
let originalCwd: string;
let testUserId: string;

function makeGrant(overrides: Partial<GrantInfo> = {}): GrantInfo {
  return {
    id: uuidv4(),
    time: new Date().toISOString(),
    type: 'mint',
    amount: 100,
    toUserId: testUserId,
    currency: 'credit',
    reason: 'test grant',
    ...overrides,
  };
}

beforeAll(async () => {
  originalCwd = process.cwd();
  tempDir = path.join(TEMP_BASE, `grant-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tempDir, { recursive: true });
  process.chdir(tempDir);

  db = new Database();
  await db.init();

  const user = await db.createUser('grantuser@example.com', 'pass', 'GrantUser');
  testUserId = user.id;
}, 30000);

afterAll(async () => {
  await db.close();
  process.chdir(originalCwd);
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('Database — Grant operations', () => {
  describe('recordGrantInfo + getUserGrantSummary', () => {
    it('minting a grant increases the user balance', async () => {
      await db.recordGrantInfo(makeGrant({ amount: 50, currency: 'credit' }));

      const summary = await db.getUserGrantSummary(testUserId);
      expect(summary.totals['credit']).toBe(50);
      expect(summary.grantInfos.length).toBeGreaterThanOrEqual(1);
    });

    it('multiple mints for the same currency aggregate correctly', async () => {
      const before = await db.getUserGrantSummary(testUserId);
      const prevBalance = before.totals['credit'] || 0;

      await db.recordGrantInfo(makeGrant({ amount: 30, currency: 'credit' }));
      await db.recordGrantInfo(makeGrant({ amount: 20, currency: 'credit' }));

      const summary = await db.getUserGrantSummary(testUserId);
      expect(summary.totals['credit']).toBe(prevBalance + 50);
    });

    it('burn reduces the user balance', async () => {
      const before = await db.getUserGrantSummary(testUserId);
      const prevBalance = before.totals['credit'] || 0;

      await db.recordGrantInfo(makeGrant({
        type: 'burn',
        amount: 10,
        fromUserId: testUserId,
        toUserId: undefined,
        currency: 'credit',
      }));

      const summary = await db.getUserGrantSummary(testUserId);
      expect(summary.totals['credit']).toBe(prevBalance - 10);
    });

    it('burn can bring balance below zero (no enforcement)', async () => {
      // Create a fresh user to start from zero
      const user2 = await db.createUser('burner@example.com', 'pass', 'Burner');

      // Mint 5, then burn 10
      await db.recordGrantInfo(makeGrant({ amount: 5, toUserId: user2.id, currency: 'test-coin' }));
      await db.recordGrantInfo(makeGrant({
        type: 'burn',
        amount: 10,
        fromUserId: user2.id,
        toUserId: undefined,
        currency: 'test-coin',
      }));

      const summary = await db.getUserGrantSummary(user2.id);
      expect(summary.totals['test-coin']).toBe(-5);
    });

    it('different currencies are tracked independently', async () => {
      const user = await db.createUser('multicurrency@example.com', 'pass', 'MC');

      await db.recordGrantInfo(makeGrant({ amount: 100, toUserId: user.id, currency: 'credit' }));
      await db.recordGrantInfo(makeGrant({ amount: 200, toUserId: user.id, currency: 'sonnet' }));
      await db.recordGrantInfo(makeGrant({ amount: 50, toUserId: user.id, currency: 'credit' }));

      const summary = await db.getUserGrantSummary(user.id);
      expect(summary.totals['credit']).toBe(150);
      expect(summary.totals['sonnet']).toBe(200);
    });

    it('grant summary reflects all currencies', async () => {
      const user = await db.createUser('allcurr@example.com', 'pass', 'AllC');

      await db.recordGrantInfo(makeGrant({ amount: 10, toUserId: user.id, currency: 'alpha' }));
      await db.recordGrantInfo(makeGrant({ amount: 20, toUserId: user.id, currency: 'beta' }));
      await db.recordGrantInfo(makeGrant({ amount: 30, toUserId: user.id, currency: 'gamma' }));

      const summary = await db.getUserGrantSummary(user.id);
      expect(Object.keys(summary.totals)).toContain('alpha');
      expect(Object.keys(summary.totals)).toContain('beta');
      expect(Object.keys(summary.totals)).toContain('gamma');
      expect(summary.totals['alpha']).toBe(10);
      expect(summary.totals['beta']).toBe(20);
      expect(summary.totals['gamma']).toBe(30);
    });

    it('zero-amount mint does not change the balance', async () => {
      const user = await db.createUser('zeroamt@example.com', 'pass', 'Zero');

      await db.recordGrantInfo(makeGrant({ amount: 100, toUserId: user.id, currency: 'credit' }));
      await db.recordGrantInfo(makeGrant({ amount: 0, toUserId: user.id, currency: 'credit' }));

      const summary = await db.getUserGrantSummary(user.id);
      expect(summary.totals['credit']).toBe(100);
    });

    it('send transfers from one user to another', async () => {
      const sender = await db.createUser('sender@example.com', 'pass', 'Sender');
      const receiver = await db.createUser('receiver@example.com', 'pass', 'Receiver');

      // Mint to sender first
      await db.recordGrantInfo(makeGrant({ amount: 200, toUserId: sender.id, currency: 'credit' }));

      // Send from sender to receiver
      await db.recordGrantInfo(makeGrant({
        type: 'send',
        amount: 75,
        fromUserId: sender.id,
        toUserId: receiver.id,
        currency: 'credit',
      }));

      const senderSummary = await db.getUserGrantSummary(sender.id);
      const receiverSummary = await db.getUserGrantSummary(receiver.id);

      expect(senderSummary.totals['credit']).toBe(125); // 200 - 75
      expect(receiverSummary.totals['credit']).toBe(75);
    });

    it('tally adds to the user balance', async () => {
      const user = await db.createUser('tally@example.com', 'pass', 'Tally');

      await db.recordGrantInfo(makeGrant({
        type: 'tally',
        amount: 42,
        toUserId: user.id,
        currency: 'credit',
      }));

      const summary = await db.getUserGrantSummary(user.id);
      expect(summary.totals['credit']).toBe(42);
    });

    it('grantInfos list contains all recorded grants for the user', async () => {
      const user = await db.createUser('infos@example.com', 'pass', 'Infos');

      await db.recordGrantInfo(makeGrant({ amount: 10, toUserId: user.id, reason: 'first' }));
      await db.recordGrantInfo(makeGrant({ amount: 20, toUserId: user.id, reason: 'second' }));

      const summary = await db.getUserGrantSummary(user.id);
      const reasons = summary.grantInfos.map(g => g.reason);
      expect(reasons).toContain('first');
      expect(reasons).toContain('second');
    });
  });

  describe('currency name migration', () => {
    it('opus is migrated to claude3opus', async () => {
      const user = await db.createUser('opus@example.com', 'pass', 'Opus');

      await db.recordGrantInfo(makeGrant({
        amount: 10,
        toUserId: user.id,
        currency: 'opus',
      }));

      const summary = await db.getUserGrantSummary(user.id);
      // Legacy 'opus' should be migrated to 'claude3opus'
      expect(summary.totals['claude3opus']).toBe(10);
      expect(summary.totals['opus']).toBeUndefined();
    });

    it('sonnets is migrated to old_sonnets', async () => {
      const user = await db.createUser('sonnets@example.com', 'pass', 'Sonnets');

      await db.recordGrantInfo(makeGrant({
        amount: 5,
        toUserId: user.id,
        currency: 'sonnets',
      }));

      const summary = await db.getUserGrantSummary(user.id);
      expect(summary.totals['old_sonnets']).toBe(5);
      expect(summary.totals['sonnets']).toBeUndefined();
    });

    it('non-legacy currencies are not migrated', async () => {
      const user = await db.createUser('nomigate@example.com', 'pass', 'NoMig');

      await db.recordGrantInfo(makeGrant({
        amount: 10,
        toUserId: user.id,
        currency: 'custom-coin',
      }));

      const summary = await db.getUserGrantSummary(user.id);
      expect(summary.totals['custom-coin']).toBe(10);
    });

    it('grants with undefined currency default to credit', async () => {
      const user = await db.createUser('nocurrency@example.com', 'pass', 'NoCurr');

      await db.recordGrantInfo({
        id: uuidv4(),
        time: new Date().toISOString(),
        type: 'mint',
        amount: 15,
        toUserId: user.id,
      });

      const summary = await db.getUserGrantSummary(user.id);
      expect(summary.totals['credit']).toBe(15);
    });
  });

  describe('recordGrantCapability + userHasActiveGrantCapability', () => {
    it('granting admin capability makes it active', async () => {
      const user = await db.createUser('admin@example.com', 'pass', 'Admin');

      await db.recordGrantCapability({
        id: uuidv4(),
        time: new Date().toISOString(),
        userId: user.id,
        action: 'granted',
        capability: 'admin',
        grantedByUserId: testUserId,
      });

      expect(await db.userHasActiveGrantCapability(user.id, 'admin')).toBe(true);
    });

    it('revoking a capability makes it inactive', async () => {
      const user = await db.createUser('revoked@example.com', 'pass', 'Revoked');

      await db.recordGrantCapability({
        id: uuidv4(),
        time: new Date(Date.now() - 2000).toISOString(),
        userId: user.id,
        action: 'granted',
        capability: 'mint',
        grantedByUserId: testUserId,
      });

      await db.recordGrantCapability({
        id: uuidv4(),
        time: new Date().toISOString(),
        userId: user.id,
        action: 'revoked',
        capability: 'mint',
        grantedByUserId: testUserId,
      });

      expect(await db.userHasActiveGrantCapability(user.id, 'mint')).toBe(false);
    });

    it('latest capability record wins (time-based)', async () => {
      const user = await db.createUser('latest@example.com', 'pass', 'Latest');

      // First revoked
      await db.recordGrantCapability({
        id: uuidv4(),
        time: new Date(Date.now() - 3000).toISOString(),
        userId: user.id,
        action: 'revoked',
        capability: 'send',
        grantedByUserId: testUserId,
      });

      // Then granted (newer)
      await db.recordGrantCapability({
        id: uuidv4(),
        time: new Date().toISOString(),
        userId: user.id,
        action: 'granted',
        capability: 'send',
        grantedByUserId: testUserId,
      });

      expect(await db.userHasActiveGrantCapability(user.id, 'send')).toBe(true);
    });

    it('user without any capabilities returns false', async () => {
      const user = await db.createUser('nocaps@example.com', 'pass', 'NoCaps');
      expect(await db.userHasActiveGrantCapability(user.id, 'admin')).toBe(false);
    });

    it('capabilities are reported in getUserGrantSummary', async () => {
      const user = await db.createUser('capsummary@example.com', 'pass', 'CS');

      await db.recordGrantCapability({
        id: uuidv4(),
        time: new Date().toISOString(),
        userId: user.id,
        action: 'granted',
        capability: 'researcher',
        grantedByUserId: testUserId,
      });

      const summary = await db.getUserGrantSummary(user.id);
      const caps = summary.grantCapabilities.map(c => c.capability);
      expect(caps).toContain('researcher');
    });

    it('expired capability returns false', async () => {
      const user = await db.createUser('expired@example.com', 'pass', 'Expired');

      await db.recordGrantCapability({
        id: uuidv4(),
        time: new Date(Date.now() - 10000).toISOString(),
        userId: user.id,
        action: 'granted',
        capability: 'overspend',
        grantedByUserId: testUserId,
        expiresAt: new Date(Date.now() - 5000).toISOString(), // already expired
      });

      expect(await db.userHasActiveGrantCapability(user.id, 'overspend')).toBe(false);
    });

    it('capability without expiry stays active indefinitely', async () => {
      const user = await db.createUser('noexpiry@example.com', 'pass', 'NoExp');

      await db.recordGrantCapability({
        id: uuidv4(),
        time: new Date(Date.now() - 100000).toISOString(),
        userId: user.id,
        action: 'granted',
        capability: 'admin',
        grantedByUserId: testUserId,
        // No expiresAt
      });

      expect(await db.userHasActiveGrantCapability(user.id, 'admin')).toBe(true);
    });
  });

  describe('invite system (grant distribution)', () => {
    it('creates and validates an invite', async () => {
      const invite = await db.createInvite('TESTCODE1', testUserId, 50, 'credit');
      expect(invite.code).toBe('TESTCODE1');
      expect(invite.amount).toBe(50);
      expect(invite.useCount).toBe(0);

      const validation = db.validateInvite('TESTCODE1');
      expect(validation.valid).toBe(true);
      expect(validation.invite).toBeDefined();
    });

    it('claiming an invite mints credits to the claimer', async () => {
      const claimer = await db.createUser('claimer@example.com', 'pass', 'Claimer');

      await db.createInvite('CLAIM1', testUserId, 100, 'credit');
      await db.claimInvite('CLAIM1', claimer.id);

      const summary = await db.getUserGrantSummary(claimer.id);
      expect(summary.totals['credit']).toBe(100);
    });

    it('invite with maxUses rejects after limit reached', async () => {
      const user1 = await db.createUser('invite1@example.com', 'pass', 'I1');
      const user2 = await db.createUser('invite2@example.com', 'pass', 'I2');

      await db.createInvite('LIMITED1', testUserId, 10, 'credit', undefined, 1);

      await db.claimInvite('LIMITED1', user1.id);

      // Second claim should fail
      await expect(db.claimInvite('LIMITED1', user2.id)).rejects.toThrow();
    });

    it('expired invite is rejected', async () => {
      await db.createInvite(
        'EXPIRED1',
        testUserId,
        10,
        'credit',
        new Date(Date.now() - 10000).toISOString() // already expired
      );

      const validation = db.validateInvite('EXPIRED1');
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('expired');
    });

    it('nonexistent invite code is rejected', () => {
      const validation = db.validateInvite('DOESNOTEXIST');
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('Invalid');
    });

    it('duplicate invite code throws', async () => {
      await db.createInvite('DUP1', testUserId, 10, 'credit');
      await expect(db.createInvite('DUP1', testUserId, 20, 'credit')).rejects.toThrow('Invite code already exists');
    });
  });

  describe('state survives event replay', () => {
    it('minted grants survive DB reload', async () => {
      const user = await db.createUser('replaygrant@example.com', 'pass', 'RG');

      await db.recordGrantInfo(makeGrant({ amount: 77, toUserId: user.id, currency: 'credit' }));

      const db2 = new Database();
      await db2.init();

      try {
        const summary = await db2.getUserGrantSummary(user.id);
        expect(summary.totals['credit']).toBe(77);
      } finally {
        await db2.close();
      }
    });

    it('capabilities survive DB reload', async () => {
      const user = await db.createUser('replaycap@example.com', 'pass', 'RC');

      await db.recordGrantCapability({
        id: uuidv4(),
        time: new Date().toISOString(),
        userId: user.id,
        action: 'granted',
        capability: 'admin',
        grantedByUserId: testUserId,
      });

      const db2 = new Database();
      await db2.init();

      try {
        expect(await db2.userHasActiveGrantCapability(user.id, 'admin')).toBe(true);
      } finally {
        await db2.close();
      }
    });

    it('burn balance change survives DB reload', async () => {
      const user = await db.createUser('replayburn@example.com', 'pass', 'RB');

      await db.recordGrantInfo(makeGrant({ amount: 100, toUserId: user.id, currency: 'credit' }));
      await db.recordGrantInfo(makeGrant({
        type: 'burn',
        amount: 30,
        fromUserId: user.id,
        toUserId: undefined,
        currency: 'credit',
      }));

      const db2 = new Database();
      await db2.init();

      try {
        const summary = await db2.getUserGrantSummary(user.id);
        expect(summary.totals['credit']).toBe(70);
      } finally {
        await db2.close();
      }
    });
  });

  describe('getUserGrantSummary for user with no grants', () => {
    it('returns empty totals and arrays for a fresh user', async () => {
      const user = await db.createUser('empty@example.com', 'pass', 'Empty');

      const summary = await db.getUserGrantSummary(user.id);
      expect(summary.totals).toEqual({});
      expect(summary.grantInfos).toEqual([]);
      expect(summary.grantCapabilities).toEqual([]);
    });
  });

  describe('grant details normalization', () => {
    it('normalizes grant details with numeric conversion', async () => {
      const user = await db.createUser('details@example.com', 'pass', 'Details');

      await db.recordGrantInfo({
        id: uuidv4(),
        time: new Date().toISOString(),
        type: 'burn',
        amount: 5,
        fromUserId: user.id,
        currency: 'credit',
        details: {
          input: { price: '0.01' as any, tokens: '100' as any, credits: '1' as any },
          output: { price: 0.03, tokens: 50, credits: 1.5 },
        },
      });

      const summary = await db.getUserGrantSummary(user.id);
      const lastGrant = summary.grantInfos[summary.grantInfos.length - 1];
      expect(lastGrant.details).toBeDefined();
      expect(lastGrant.details!.input!.price).toBe(0.01);
      expect(lastGrant.details!.input!.tokens).toBe(100);
      expect(lastGrant.details!.output!.price).toBe(0.03);
    });
  });
});
