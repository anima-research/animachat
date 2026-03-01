import { describe, it, expect, vi } from 'vitest';
import { migrateDatabase } from './migration.js';
import type { Event } from './persistence.js';

/**
 * Migration characterization tests.
 *
 * The migrateDatabase function categorizes events and routes them to the
 * appropriate store (main, user, or conversation). We provide mock stores
 * and real Maps for conversations/participants/messages to verify routing.
 */

function makeEvent(type: string, data: any = {}): Event {
  return { timestamp: new Date(), type, data };
}

function makeMockStores() {
  const mainAppend = vi.fn();
  const userAppend = vi.fn();
  const conversationAppend = vi.fn();

  return {
    mainEventStore: { appendEvent: mainAppend } as any,
    userEventStore: { appendEvent: userAppend } as any,
    conversationEventStore: { appendEvent: conversationAppend } as any,
    mainAppend,
    userAppend,
    conversationAppend,
  };
}

describe('migrateDatabase', () => {
  describe('main event routing', () => {
    it('routes user_created to main store', async () => {
      const stores = makeMockStores();
      const events = [makeEvent('user_created', { id: 'u1', email: 'a@b.com' })];

      await migrateDatabase(
        events, new Map(), new Map(), new Map(),
        stores.mainEventStore, stores.userEventStore, stores.conversationEventStore
      );

      expect(stores.mainAppend).toHaveBeenCalledTimes(1);
      expect(stores.userAppend).not.toHaveBeenCalled();
      expect(stores.conversationAppend).not.toHaveBeenCalled();
    });

    it('routes api_key_created to main store', async () => {
      const stores = makeMockStores();
      const events = [makeEvent('api_key_created', { userId: 'u1' })];

      await migrateDatabase(
        events, new Map(), new Map(), new Map(),
        stores.mainEventStore, stores.userEventStore, stores.conversationEventStore
      );

      expect(stores.mainAppend).toHaveBeenCalledTimes(1);
    });

    it('routes share events to main store', async () => {
      const stores = makeMockStores();
      const events = [
        makeEvent('share_created', { id: 's1' }),
        makeEvent('share_deleted', { id: 's1' }),
        makeEvent('share_viewed', { id: 's1' }),
      ];

      await migrateDatabase(
        events, new Map(), new Map(), new Map(),
        stores.mainEventStore, stores.userEventStore, stores.conversationEventStore
      );

      expect(stores.mainAppend).toHaveBeenCalledTimes(3);
    });
  });

  describe('user event routing', () => {
    it('routes conversation_created to user store', async () => {
      const stores = makeMockStores();
      const conversations = new Map();
      const events = [
        makeEvent('conversation_created', {
          id: 'c1',
          userId: 'u1',
          title: 'Test',
        }),
      ];

      await migrateDatabase(
        events, conversations, new Map(), new Map(),
        stores.mainEventStore, stores.userEventStore, stores.conversationEventStore
      );

      expect(stores.userAppend).toHaveBeenCalledTimes(1);
      expect(stores.userAppend).toHaveBeenCalledWith('u1', events[0]);
      // Should also cache the conversation in the map
      expect(conversations.has('c1')).toBe(true);
    });

    it('routes conversation_updated to user store', async () => {
      const stores = makeMockStores();
      const conversations = new Map([
        ['c1', { id: 'c1', userId: 'u1' }],
      ]);
      const events = [makeEvent('conversation_updated', { id: 'c1', title: 'New Title' })];

      await migrateDatabase(
        events, conversations as any, new Map(), new Map(),
        stores.mainEventStore, stores.userEventStore, stores.conversationEventStore
      );

      expect(stores.userAppend).toHaveBeenCalledWith('u1', events[0]);
    });

    it('routes conversation_archived to user store', async () => {
      const stores = makeMockStores();
      const conversations = new Map([
        ['c1', { id: 'c1', userId: 'u1' }],
      ]);
      const events = [makeEvent('conversation_archived', { id: 'c1' })];

      await migrateDatabase(
        events, conversations as any, new Map(), new Map(),
        stores.mainEventStore, stores.userEventStore, stores.conversationEventStore
      );

      expect(stores.userAppend).toHaveBeenCalledWith('u1', events[0]);
    });

    it('routes participant_created to user store', async () => {
      const stores = makeMockStores();
      const conversations = new Map([
        ['c1', { id: 'c1', userId: 'u1' }],
      ]);
      const participants = new Map();
      const events = [
        makeEvent('participant_created', {
          participant: { id: 'p1', conversationId: 'c1', type: 'assistant' },
        }),
      ];

      await migrateDatabase(
        events, conversations as any, participants as any, new Map(),
        stores.mainEventStore, stores.userEventStore, stores.conversationEventStore
      );

      expect(stores.userAppend).toHaveBeenCalledWith('u1', events[0]);
      // Should cache participant
      expect(participants.has('p1')).toBe(true);
    });

    it('routes participant_updated to user store using cached participant', async () => {
      const stores = makeMockStores();
      const conversations = new Map([
        ['c1', { id: 'c1', userId: 'u1' }],
      ]);
      const participants = new Map([
        ['p1', { id: 'p1', conversationId: 'c1' }],
      ]);
      const events = [
        makeEvent('participant_updated', { participantId: 'p1', name: 'Updated' }),
      ];

      await migrateDatabase(
        events, conversations as any, participants as any, new Map(),
        stores.mainEventStore, stores.userEventStore, stores.conversationEventStore
      );

      expect(stores.userAppend).toHaveBeenCalledWith('u1', events[0]);
    });

    it('routes metrics_added to user store', async () => {
      const stores = makeMockStores();
      const conversations = new Map([
        ['c1', { id: 'c1', userId: 'u1' }],
      ]);
      const events = [makeEvent('metrics_added', { conversationId: 'c1' })];

      await migrateDatabase(
        events, conversations as any, new Map(), new Map(),
        stores.mainEventStore, stores.userEventStore, stores.conversationEventStore
      );

      expect(stores.userAppend).toHaveBeenCalledWith('u1', events[0]);
    });
  });

  describe('conversation event routing', () => {
    it('routes message_created to conversation store', async () => {
      const stores = makeMockStores();
      const messages = new Map();
      const events = [
        makeEvent('message_created', {
          id: 'msg1',
          conversationId: 'c1',
          content: 'hello',
        }),
      ];

      await migrateDatabase(
        events, new Map(), new Map(), messages,
        stores.mainEventStore, stores.userEventStore, stores.conversationEventStore
      );

      expect(stores.conversationAppend).toHaveBeenCalledWith('c1', events[0]);
      expect(messages.has('msg1')).toBe(true);
    });

    it('routes message_branch_added to conversation store using cached message', async () => {
      const stores = makeMockStores();
      const messages = new Map([
        ['msg1', { id: 'msg1', conversationId: 'c1' }],
      ]);
      const events = [
        makeEvent('message_branch_added', { messageId: 'msg1', branchId: 'b2' }),
      ];

      await migrateDatabase(
        events, new Map(), new Map(), messages as any,
        stores.mainEventStore, stores.userEventStore, stores.conversationEventStore
      );

      expect(stores.conversationAppend).toHaveBeenCalledWith('c1', events[0]);
    });

    it('routes active_branch_changed to conversation store', async () => {
      const stores = makeMockStores();
      const messages = new Map([
        ['msg1', { id: 'msg1', conversationId: 'c1' }],
      ]);
      const events = [
        makeEvent('active_branch_changed', { messageId: 'msg1', branchId: 'b2' }),
      ];

      await migrateDatabase(
        events, new Map(), new Map(), messages as any,
        stores.mainEventStore, stores.userEventStore, stores.conversationEventStore
      );

      expect(stores.conversationAppend).toHaveBeenCalledWith('c1', events[0]);
    });
  });

  describe('edge cases', () => {
    it('falls back to main store for unknown event types', async () => {
      const stores = makeMockStores();
      const events = [makeEvent('unknown_event_type', { foo: 'bar' })];

      await migrateDatabase(
        events, new Map(), new Map(), new Map(),
        stores.mainEventStore, stores.userEventStore, stores.conversationEventStore
      );

      expect(stores.mainAppend).toHaveBeenCalledTimes(1);
    });

    it('falls back to main store when conversation not found for user event', async () => {
      const stores = makeMockStores();
      // conversation_updated with ID that doesn't exist in conversations map
      const events = [makeEvent('conversation_updated', { id: 'nonexistent' })];

      await migrateDatabase(
        events, new Map(), new Map(), new Map(),
        stores.mainEventStore, stores.userEventStore, stores.conversationEventStore
      );

      // Should fall back to main
      expect(stores.mainAppend).toHaveBeenCalledTimes(1);
    });

    it('falls back for message events with unknown message and no conversationId', async () => {
      const stores = makeMockStores();
      const events = [
        makeEvent('message_branch_added', { messageId: 'unknown-msg' }),
      ];

      await migrateDatabase(
        events, new Map(), new Map(), new Map(),
        stores.mainEventStore, stores.userEventStore, stores.conversationEventStore
      );

      // Should fall back to main because message not found and no conversationId fallback
      expect(stores.mainAppend).toHaveBeenCalledTimes(1);
    });

    it('uses conversationId fallback for message events when message is deleted', async () => {
      const stores = makeMockStores();
      const events = [
        makeEvent('message_deleted', {
          messageId: 'deleted-msg',
          conversationId: 'c1', // Fallback
        }),
      ];

      await migrateDatabase(
        events, new Map(), new Map(), new Map(),
        stores.mainEventStore, stores.userEventStore, stores.conversationEventStore
      );

      expect(stores.conversationAppend).toHaveBeenCalledWith('c1', events[0]);
    });

    it('uses conversationId fallback for participant events when participant not found', async () => {
      const stores = makeMockStores();
      const conversations = new Map([
        ['c1', { id: 'c1', userId: 'u1' }],
      ]);
      const events = [
        makeEvent('participant_deleted', {
          participantId: 'unknown-p',
          conversationId: 'c1',
        }),
      ];

      await migrateDatabase(
        events, conversations as any, new Map(), new Map(),
        stores.mainEventStore, stores.userEventStore, stores.conversationEventStore
      );

      expect(stores.userAppend).toHaveBeenCalledWith('u1', events[0]);
    });
  });
});
