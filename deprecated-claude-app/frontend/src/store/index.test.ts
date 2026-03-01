import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';

// ── Mocks ─────────────────────────────────────────────────────────────────

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Mock api service with RELATIVE import (not @/services/api)
const mockApi = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue({ data: null }),
  post: vi.fn().mockResolvedValue({ data: null }),
  patch: vi.fn().mockResolvedValue({ data: null }),
  delete: vi.fn().mockResolvedValue({ data: null }),
  defaults: { baseURL: 'http://localhost:3010/api' },
}));
vi.mock('../services/api', () => ({
  api: mockApi,
}));

// Mock WebSocketService
const mockWsInstance = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  sendMessage: vi.fn(),
  on: vi.fn(),
}));
vi.mock('../services/websocket', () => ({
  WebSocketService: class MockWebSocketService {
    connect = mockWsInstance.connect;
    disconnect = mockWsInstance.disconnect;
    sendMessage = mockWsInstance.sendMessage;
    on = mockWsInstance.on;
    constructor(..._args: any[]) {}
  },
}));

// Mock shared package
vi.mock('@deprecated-claude/shared', () => ({
  getValidatedModelDefaults: vi.fn().mockReturnValue({
    temperature: 0.7,
    maxTokens: 1024,
  }),
}));

// Import after mocks
import { createStore } from './index';

// ── Test Helpers ──────────────────────────────────────────────────────────

interface TestBranch {
  id: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  parentBranchId: string;
  createdAt?: Date;
  hiddenFromAi?: boolean;
  participantId?: string | null;
  model?: string | null;
}

interface TestMessage {
  id: string;
  conversationId: string;
  branches: TestBranch[];
  activeBranchId: string;
  order: number;
}

function makeBranch(
  content: string,
  role: 'user' | 'assistant' | 'system' = 'user',
  parentBranchId = 'root',
  opts: { id?: string; hiddenFromAi?: boolean; createdAt?: Date } = {}
): TestBranch {
  return {
    id: opts.id ?? randomUUID(),
    content,
    role,
    parentBranchId,
    createdAt: opts.createdAt ?? new Date(),
    hiddenFromAi: opts.hiddenFromAi,
    participantId: null,
    model: null,
  };
}

function makeMsg(
  branches: TestBranch[],
  opts: { id?: string; conversationId?: string; order?: number; activeBranchId?: string } = {}
): TestMessage {
  return {
    id: opts.id ?? randomUUID(),
    conversationId: opts.conversationId ?? 'conv-1',
    branches,
    activeBranchId: opts.activeBranchId ?? branches[0].id,
    order: opts.order ?? 0,
  };
}

function getStore() {
  const plugin = createStore();
  let store: any;
  const mockApp = {
    provide: (_key: any, value: any) => { store = value; },
  };
  plugin.install(mockApp as any);
  return store;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Frontend Store', () => {
  let store: any;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    // Restore default mock return values
    mockApi.get.mockResolvedValue({ data: null });
    mockApi.post.mockResolvedValue({ data: null });
    mockApi.patch.mockResolvedValue({ data: null });
    mockApi.delete.mockResolvedValue({ data: null });
    store = getStore();
  });

  afterEach(() => {
    // Clear any pending read persist timeouts from previous test
    if (store?.state?.readPersistTimeout) {
      clearTimeout(store.state.readPersistTimeout);
      store.state.readPersistTimeout = null;
    }
    vi.useRealTimers();
  });

  // ── Authentication ──────────────────────────────────────────────────

  describe('authentication', () => {
    it('is not authenticated initially', () => {
      expect(store.isAuthenticated).toBe(false);
      expect(store.state.user).toBeNull();
      expect(store.token).toBeNull();
    });

    it('login sets user, token, and connects websocket', async () => {
      mockApi.post.mockResolvedValueOnce({
        data: { user: { id: 'u1', email: 'test@test.com' }, token: 'jwt-123' },
      });

      await store.login('test@test.com', 'password');

      expect(store.state.user).toEqual({ id: 'u1', email: 'test@test.com' });
      expect(localStorageMock.setItem).toHaveBeenCalledWith('token', 'jwt-123');
      expect(store.isAuthenticated).toBe(true);
    });

    it('login sets error on failure', async () => {
      mockApi.post.mockRejectedValueOnce({
        response: { data: { error: 'Invalid credentials' } },
      });

      await expect(store.login('bad@test.com', 'wrong')).rejects.toBeTruthy();
      expect(store.state.error).toBe('Invalid credentials');
    });

    it('login sets loading state', async () => {
      let resolveLogin: any;
      mockApi.post.mockReturnValueOnce(new Promise(r => { resolveLogin = r; }));

      const loginPromise = store.login('test@test.com', 'pw');
      expect(store.state.isLoading).toBe(true);

      resolveLogin({ data: { user: { id: 'u1' }, token: 'tok' } });
      await loginPromise;
      expect(store.state.isLoading).toBe(false);
    });

    it('logout clears user, token, and conversations', async () => {
      // Setup logged-in state
      store.state.user = { id: 'u1', email: 'test@test.com' };
      localStorageMock.setItem('token', 'jwt-123');
      store.state.conversations = [{ id: 'c1' }];
      store.state.currentConversation = { id: 'c1' };

      store.logout();

      expect(store.state.user).toBeNull();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('token');
      expect(store.state.conversations).toEqual([]);
      expect(store.state.currentConversation).toBeNull();
      expect(store.isAuthenticated).toBe(false);
    });

    it('loadUser fetches user and grant summary', async () => {
      mockApi.get
        .mockResolvedValueOnce({ data: { id: 'u1', email: 'test@test.com' } })
        .mockResolvedValueOnce({ data: { totals: { sonnets: 5 } } });

      await store.loadUser();

      expect(store.state.user).toEqual({ id: 'u1', email: 'test@test.com' });
      expect(store.state.grantSummary).toEqual({ totals: { sonnets: 5 } });
      expect(mockApi.get).toHaveBeenCalledWith('/auth/me');
      expect(mockApi.get).toHaveBeenCalledWith('/auth/grants');
    });

    it('loadUser succeeds even if grants fail', async () => {
      mockApi.get
        .mockResolvedValueOnce({ data: { id: 'u1', email: 'a@b.com' } })
        .mockRejectedValueOnce(new Error('grants error'));

      await store.loadUser();

      expect(store.state.user).toEqual({ id: 'u1', email: 'a@b.com' });
      expect(store.state.grantSummary).toBeNull();
    });

    it('register with requiresVerification returns early', async () => {
      mockApi.post.mockResolvedValueOnce({
        data: { requiresVerification: true },
      });

      const result = await store.register('a@b.com', 'pw', 'Name');
      expect(result).toEqual({ requiresVerification: true });
      expect(store.state.user).toBeNull(); // Should not set user
    });

    it('register sets user and token on success', async () => {
      mockApi.post.mockResolvedValueOnce({
        data: { user: { id: 'u1' }, token: 'tok' },
      });

      await store.register('a@b.com', 'pw', 'Name');
      expect(store.state.user).toEqual({ id: 'u1' });
      expect(localStorageMock.setItem).toHaveBeenCalledWith('token', 'tok');
    });
  });

  // ── Message Visibility (getVisibleMessages) ─────────────────────────

  describe('getVisibleMessages', () => {
    it('returns empty array when no messages', () => {
      expect(store.getVisibleMessages()).toEqual([]);
    });

    it('returns single root message', () => {
      const b = makeBranch('hello', 'user', 'root');
      const m = makeMsg([b]);
      store.state.allMessages = [m];
      store.state.messagesVersion++;

      const visible = store.getVisibleMessages();
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe(m.id);
    });

    it('follows active branch path through message chain', () => {
      const b1 = makeBranch('msg1', 'user', 'root');
      const m1 = makeMsg([b1], { order: 0 });

      const b2 = makeBranch('msg2', 'assistant', b1.id);
      const m2 = makeMsg([b2], { order: 1 });

      const b3 = makeBranch('msg3', 'user', b2.id);
      const m3 = makeMsg([b3], { order: 2 });

      store.state.allMessages = [m1, m2, m3];
      store.state.messagesVersion++;

      const visible = store.getVisibleMessages();
      expect(visible).toHaveLength(3);
      expect(visible.map((m: any) => m.id)).toEqual([m1.id, m2.id, m3.id]);
    });

    it('excludes messages on inactive branches', () => {
      const b1 = makeBranch('msg1', 'user', 'root');
      const m1 = makeMsg([b1], { order: 0 });

      // Two branches from m1
      const b2a = makeBranch('active reply', 'assistant', b1.id);
      const b2b = makeBranch('inactive reply', 'assistant', b1.id);
      const m2 = makeMsg([b2a, b2b], { order: 1, activeBranchId: b2a.id });

      // Child of inactive branch — should NOT be visible
      const b3 = makeBranch('orphan', 'user', b2b.id);
      const m3 = makeMsg([b3], { order: 2 });

      // Child of active branch — should be visible
      const b4 = makeBranch('visible child', 'user', b2a.id);
      const m4 = makeMsg([b4], { order: 3 });

      store.state.allMessages = [m1, m2, m3, m4];
      store.state.messagesVersion++;

      const visible = store.getVisibleMessages();
      expect(visible).toHaveLength(3);
      expect(visible.map((m: any) => m.id)).toEqual([m1.id, m2.id, m4.id]);
    });

    it('caches results and returns same array on repeat calls', () => {
      const b = makeBranch('cached', 'user', 'root');
      store.state.allMessages = [makeMsg([b])];
      store.state.messagesVersion++;

      const first = store.getVisibleMessages();
      const second = store.getVisibleMessages();
      expect(first).toBe(second); // Same reference — cache hit
    });

    it('invalidates cache when messagesVersion changes', () => {
      const b = makeBranch('first', 'user', 'root');
      const m = makeMsg([b]);
      store.state.allMessages = [m];
      store.state.messagesVersion++;

      const first = store.getVisibleMessages();
      expect(first).toHaveLength(1);

      // Add another message
      const b2 = makeBranch('second', 'assistant', b.id);
      const m2 = makeMsg([b2]);
      store.state.allMessages.push(m2);
      store.state.messagesVersion++;

      const second = store.getVisibleMessages();
      expect(second).toHaveLength(2);
      expect(first).not.toBe(second); // Different reference — cache miss
    });
  });

  // ── Branch Switching ────────────────────────────────────────────────

  describe('switchBranch', () => {
    it('updates activeBranchId for target message', () => {
      const b1 = makeBranch('branch A', 'assistant', 'root');
      const b2 = makeBranch('branch B', 'assistant', 'root');
      const m = makeMsg([b1, b2], { activeBranchId: b1.id });

      store.state.allMessages = [m];
      store.state.currentConversation = { id: 'conv-1' };
      store.state.messagesVersion++;

      store.switchBranch(m.id, b2.id);

      expect(m.activeBranchId).toBe(b2.id);
    });

    it('persists branch switch via API', () => {
      const b1 = makeBranch('A', 'user', 'root');
      const b2 = makeBranch('B', 'user', 'root');
      const m = makeMsg([b1, b2], { activeBranchId: b1.id });

      store.state.allMessages = [m];
      store.state.currentConversation = { id: 'conv-1' };

      store.switchBranch(m.id, b2.id);

      expect(mockApi.post).toHaveBeenCalledWith('/conversations/conv-1/set-active-branch', {
        messageId: m.id,
        branchId: b2.id,
      });
    });

    it('persists to ui-state in detached mode', () => {
      const b1 = makeBranch('A', 'user', 'root');
      const b2 = makeBranch('B', 'user', 'root');
      const m = makeMsg([b1, b2], { activeBranchId: b1.id });

      store.state.allMessages = [m];
      store.state.currentConversation = { id: 'conv-1' };
      store.state.isDetachedFromMainBranch = true;

      store.switchBranch(m.id, b2.id);

      expect(mockApi.patch).toHaveBeenCalledWith('/conversations/conv-1/ui-state', {
        detachedBranch: { messageId: m.id, branchId: b2.id },
      });
    });

    it('no-ops when already on target branch', () => {
      const b1 = makeBranch('A', 'user', 'root');
      const m = makeMsg([b1]);

      store.state.allMessages = [m];
      store.state.currentConversation = { id: 'conv-1' };

      store.switchBranch(m.id, b1.id);

      // Should not call API since branch didn't change
      expect(mockApi.post).not.toHaveBeenCalled();
    });

    it('cascades to child messages after switch', () => {
      const b1a = makeBranch('root-A', 'user', 'root');
      const b1b = makeBranch('root-B', 'user', 'root');
      const m1 = makeMsg([b1a, b1b], { order: 0, activeBranchId: b1a.id });

      const b2a = makeBranch('child-of-A', 'assistant', b1a.id);
      const m2 = makeMsg([b2a], { order: 1 });

      const b2b = makeBranch('child-of-B', 'assistant', b1b.id);
      const m3 = makeMsg([b2b], { order: 2 });

      store.state.allMessages = [m1, m2, m3];
      store.state.currentConversation = { id: 'conv-1' };
      store.state.messagesVersion++;

      // Switch to branch B — m3 (child of B) should now be visible, m2 (child of A) hidden
      store.switchBranch(m1.id, b1b.id);

      const visible = store.getVisibleMessages();
      // m1 + m3 visible (m2 is child of inactive branchA)
      expect(visible.some((v: any) => v.id === m1.id)).toBe(true);
      expect(visible.some((v: any) => v.id === m3.id)).toBe(true);
      expect(visible.some((v: any) => v.id === m2.id)).toBe(false);
    });

    it('no-ops when message not found', () => {
      store.state.allMessages = [];
      store.state.currentConversation = { id: 'conv-1' };

      // Should not throw
      store.switchBranch('nonexistent', 'branch-id');
      expect(mockApi.post).not.toHaveBeenCalled();
    });
  });

  // ── Batch Branch Switching ──────────────────────────────────────────

  describe('switchBranchesBatch', () => {
    it('no-ops on empty switches array', () => {
      store.switchBranchesBatch([]);
      expect(mockApi.post).not.toHaveBeenCalled();
    });

    it('applies multiple switches and persists', () => {
      const b1a = makeBranch('A', 'user', 'root');
      const b1b = makeBranch('B', 'user', 'root');
      const m1 = makeMsg([b1a, b1b], { order: 0, activeBranchId: b1a.id });

      const b2a = makeBranch('child-A', 'assistant', b1a.id);
      const b2b = makeBranch('child-B', 'assistant', b1b.id);
      const m2 = makeMsg([b2a, b2b], { order: 1, activeBranchId: b2a.id });

      store.state.allMessages = [m1, m2];
      store.state.currentConversation = { id: 'conv-1' };
      store.state.messagesVersion++;

      store.switchBranchesBatch([
        { messageId: m1.id, branchId: b1b.id },
        { messageId: m2.id, branchId: b2b.id },
      ]);

      expect(m1.activeBranchId).toBe(b1b.id);
      expect(m2.activeBranchId).toBe(b2b.id);
    });

    it('skips switches where branch already active', () => {
      const b = makeBranch('A', 'user', 'root');
      const m = makeMsg([b]);

      store.state.allMessages = [m];
      store.state.currentConversation = { id: 'conv-1' };

      store.switchBranchesBatch([{ messageId: m.id, branchId: b.id }]);

      // No change, so no API calls
      expect(mockApi.post).not.toHaveBeenCalled();
    });
  });

  // ── Detached Mode ───────────────────────────────────────────────────

  describe('setDetachedMode', () => {
    it('entering detached mode snapshots current branch state', () => {
      const b1 = makeBranch('msg', 'user', 'root');
      const m1 = makeMsg([b1]);

      store.state.allMessages = [m1];

      store.setDetachedMode(true);

      expect(store.state.isDetachedFromMainBranch).toBe(true);
      expect(store.state.sharedActiveBranchIds.get(m1.id)).toBe(b1.id);
    });

    it('leaving detached mode restores original branch state', () => {
      const b1 = makeBranch('original', 'user', 'root');
      const b2 = makeBranch('alternate', 'user', 'root');
      const m = makeMsg([b1, b2], { activeBranchId: b1.id });

      store.state.allMessages = [m];

      // Enter detached mode (snapshot b1 as active)
      store.setDetachedMode(true);
      expect(store.state.sharedActiveBranchIds.get(m.id)).toBe(b1.id);

      // Simulate user switching to b2 while detached
      m.activeBranchId = b2.id;

      // Exit detached mode — should restore to b1
      store.setDetachedMode(false);
      expect(m.activeBranchId).toBe(b1.id);
      expect(store.state.isDetachedFromMainBranch).toBe(false);
    });

    it('no-ops when entering while already detached', () => {
      store.state.isDetachedFromMainBranch = true;
      store.state.allMessages = [];

      store.setDetachedMode(true);
      // Should not throw, sharedActiveBranchIds stays empty (no snapshot taken)
      expect(store.state.isDetachedFromMainBranch).toBe(true);
    });

    it('no-ops when exiting while not detached', () => {
      store.state.isDetachedFromMainBranch = false;
      const b = makeBranch('msg', 'user', 'root');
      const m = makeMsg([b]);
      store.state.allMessages = [m];

      store.setDetachedMode(false);
      // activeBranchId unchanged
      expect(m.activeBranchId).toBe(b.id);
    });
  });

  // ── Read Tracking ───────────────────────────────────────────────────

  describe('read tracking', () => {
    it('getUnreadCount returns 0 (stubbed)', () => {
      expect(store.getUnreadCount()).toBe(0);
    });

    it('markBranchesAsRead adds to readBranchIds', () => {
      store.state.currentConversation = { id: 'conv-1' };
      const branchId = randomUUID();

      store.markBranchesAsRead([branchId]);

      expect(store.state.readBranchIds.has(branchId)).toBe(true);
    });

    it('markBranchesAsRead no-ops for empty array', () => {
      store.state.currentConversation = { id: 'conv-1' };
      const sizeBefore = store.state.readBranchIds.size;

      store.markBranchesAsRead([]);
      expect(store.state.readBranchIds.size).toBe(sizeBefore);
    });

    it('markBranchesAsRead no-ops when all already read', () => {
      const branchId = randomUUID();
      store.state.currentConversation = { id: 'conv-1' };
      store.state.readBranchIds = new Set([branchId]);

      store.markBranchesAsRead([branchId]);
      // Should not set a new timeout since nothing changed
    });

    it('markBranchesAsRead debounces persist to backend', async () => {
      vi.useFakeTimers();
      store.state.currentConversation = { id: 'conv-1' };
      mockApi.post.mockResolvedValue({ data: null });

      store.markBranchesAsRead([randomUUID()]);
      store.markBranchesAsRead([randomUUID()]);

      // Before timer fires — no API call yet
      expect(mockApi.post).not.toHaveBeenCalledWith(
        expect.stringContaining('mark-read'),
        expect.anything()
      );

      // Advance past debounce
      await vi.advanceTimersByTimeAsync(2100);

      expect(mockApi.post).toHaveBeenCalledWith(
        '/conversations/conv-1/mark-read',
        expect.objectContaining({ branchIds: expect.any(Array) })
      );

      vi.useRealTimers();
    });

    it('fetchUnreadCounts loads counts from API', async () => {
      mockApi.get.mockResolvedValueOnce({
        data: { 'conv-1': 3, 'conv-2': 0 },
      });

      await store.fetchUnreadCounts();

      expect(store.state.unreadCounts.get('conv-1')).toBe(3);
      expect(store.state.unreadCounts.get('conv-2')).toBe(0);
    });

    it('fetchUnreadCounts handles errors gracefully', async () => {
      mockApi.get.mockRejectedValueOnce(new Error('network'));

      // Should not throw
      await store.fetchUnreadCounts();
      expect(store.state.unreadCounts.size).toBe(0);
    });
  });

  // ── Model Management ────────────────────────────────────────────────

  describe('model management', () => {
    it('loadModels fetches models and availability in parallel', async () => {
      mockApi.get
        .mockResolvedValueOnce({ data: [{ id: 'm1', name: 'Model 1' }] })
        .mockResolvedValueOnce({ data: { userProviders: ['anthropic'], availableProviders: ['anthropic'] } });

      await store.loadModels();

      expect(store.state.models).toEqual([{ id: 'm1', name: 'Model 1' }]);
      expect(store.state.modelAvailability).toEqual({
        userProviders: ['anthropic'],
        availableProviders: ['anthropic'],
      });
    });

    it('loadModels handles availability failure gracefully', async () => {
      mockApi.get
        .mockResolvedValueOnce({ data: [{ id: 'm1' }] })
        .mockRejectedValueOnce(new Error('unavailable'));

      await store.loadModels();

      expect(store.state.models).toEqual([{ id: 'm1' }]);
      expect(store.state.modelAvailability).toBeNull();
    });

    it('currentModel returns matching model for current conversation', () => {
      store.state.models = [{ id: 'm1', name: 'Model 1' }, { id: 'm2', name: 'Model 2' }];
      store.state.currentConversation = { id: 'c1', model: 'm2' };

      expect(store.currentModel).toEqual({ id: 'm2', name: 'Model 2' });
    });

    it('currentModel returns null when no current conversation', () => {
      store.state.currentConversation = null;
      expect(store.currentModel).toBeNull();
    });

    it('currentModel returns null when model not in list', () => {
      store.state.models = [{ id: 'm1' }];
      store.state.currentConversation = { id: 'c1', model: 'nonexistent' };

      expect(store.currentModel).toBeNull();
    });

    it('loadOpenRouterModels sets models from response', async () => {
      mockApi.get.mockResolvedValueOnce({
        data: { models: [{ id: 'or1', name: 'OR Model' }], cached: false },
      });

      await store.loadOpenRouterModels();
      expect(store.state.openRouterModels).toEqual([{ id: 'or1', name: 'OR Model' }]);
    });

    it('loadOpenRouterModels handles error gracefully', async () => {
      mockApi.get.mockRejectedValueOnce(new Error('fail'));

      await store.loadOpenRouterModels();
      expect(store.state.openRouterModels).toEqual([]);
    });

    it('loadCustomModels sets custom models', async () => {
      mockApi.get.mockResolvedValueOnce({ data: [{ id: 'cm1' }] });

      await store.loadCustomModels();
      expect(store.state.customModels).toEqual([{ id: 'cm1' }]);
    });

    it('loadCustomModels handles error gracefully', async () => {
      mockApi.get.mockRejectedValueOnce(new Error('fail'));

      await store.loadCustomModels();
      expect(store.state.customModels).toEqual([]);
    });
  });

  // ── Grant Summary ───────────────────────────────────────────────────

  describe('grant summary', () => {
    it('starts null', () => {
      expect(store.state.grantSummary).toBeNull();
    });

    it('loadUser populates grant summary', async () => {
      mockApi.get
        .mockResolvedValueOnce({ data: { id: 'u1' } })
        .mockResolvedValueOnce({ data: { totals: { opus: 10, sonnets: 50 } } });

      await store.loadUser();
      expect(store.state.grantSummary).toEqual({ totals: { opus: 10, sonnets: 50 } });
    });
  });

  // ── Conversation Management ─────────────────────────────────────────

  describe('conversation management', () => {
    it('loadConversations fetches and stores conversations', async () => {
      mockApi.get
        .mockResolvedValueOnce({ data: [{ id: 'c1' }, { id: 'c2' }] })
        .mockResolvedValueOnce({ data: {} }); // unread counts

      await store.loadConversations();

      expect(store.state.conversations).toEqual([{ id: 'c1' }, { id: 'c2' }]);
    });

    it('createConversation posts and prepends to list', async () => {
      const newConv = { id: 'new-1', model: 'm1', title: 'New', format: 'standard' };
      mockApi.post.mockResolvedValueOnce({ data: newConv });
      store.state.conversations = [{ id: 'old-1' }];

      const result = await store.createConversation('m1', 'New');

      expect(result).toEqual(newConv);
      expect(store.state.conversations[0]).toEqual(newConv);
    });

    it('archiveConversation removes from list', async () => {
      store.state.conversations = [{ id: 'c1' }, { id: 'c2' }];
      mockApi.post.mockResolvedValueOnce({ data: null });

      await store.archiveConversation('c1');

      expect(store.state.conversations).toEqual([{ id: 'c2' }]);
    });

    it('updateConversation patches and updates local state', async () => {
      store.state.currentConversation = { id: 'c1', title: 'Old' };
      mockApi.patch.mockResolvedValueOnce({ data: { id: 'c1', title: 'New' } });

      await store.updateConversation('c1', { title: 'New' });

      expect(mockApi.patch).toHaveBeenCalledWith('/conversations/c1', { title: 'New' });
    });
  });

  // ── System Config ───────────────────────────────────────────────────

  describe('system config', () => {
    it('loadSystemConfig fetches and stores config', async () => {
      mockApi.get.mockResolvedValueOnce({
        data: { features: { grants: true }, defaultModel: 'claude-3' },
      });

      await store.loadSystemConfig();
      expect(store.state.systemConfig).toEqual({
        features: { grants: true },
        defaultModel: 'claude-3',
      });
    });

    it('loadSystemConfig uses defaults on error', async () => {
      mockApi.get.mockRejectedValueOnce(new Error('fail'));

      await store.loadSystemConfig();
      expect(store.state.systemConfig).toEqual({
        features: {},
        groupChatSuggestedModels: [],
        defaultModel: 'claude-3-5-sonnet-20241022',
      });
    });
  });

  // ── WebSocket ───────────────────────────────────────────────────────

  describe('websocket', () => {
    it('connectWebSocket skips when no token', () => {
      localStorageMock.getItem.mockReturnValue(null);

      store.connectWebSocket();

      expect(store.state.wsService).toBeNull();
    });

    it('disconnectWebSocket clears service', () => {
      store.state.wsService = mockWsInstance;

      store.disconnectWebSocket();

      expect(mockWsInstance.disconnect).toHaveBeenCalled();
      expect(store.state.wsService).toBeNull();
    });
  });

  // ── Custom Model CRUD ──────────────────────────────────────────────

  describe('custom model CRUD', () => {
    it('createCustomModel posts and reloads models', async () => {
      const newModel = { id: 'cm1', name: 'Custom' };
      mockApi.post.mockResolvedValueOnce({ data: newModel });
      // loadModels calls
      mockApi.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: null });

      const result = await store.createCustomModel({ name: 'Custom' });
      expect(result).toEqual(newModel);
      expect(store.state.customModels).toContainEqual(newModel);
    });

    it('updateCustomModel patches and reloads', async () => {
      store.state.customModels = [{ id: 'cm1', name: 'Old' }];
      mockApi.patch.mockResolvedValueOnce({ data: { id: 'cm1', name: 'Updated' } });
      mockApi.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: null });

      const result = await store.updateCustomModel('cm1', { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });

    it('deleteCustomModel removes and reloads', async () => {
      store.state.customModels = [{ id: 'cm1' }, { id: 'cm2' }];
      mockApi.delete.mockResolvedValueOnce({ data: null });
      mockApi.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: null });

      await store.deleteCustomModel('cm1');
      expect(store.state.customModels.find((m: any) => m.id === 'cm1')).toBeUndefined();
    });

    it('testCustomModel returns result on success', async () => {
      mockApi.post.mockResolvedValueOnce({ data: { success: true, response: 'Hello!' } });

      const result = await store.testCustomModel('cm1');
      expect(result).toEqual({ success: true, response: 'Hello!' });
    });

    it('testCustomModel returns error on failure', async () => {
      mockApi.post.mockRejectedValueOnce({ response: { data: { error: 'bad key' } } });

      const result = await store.testCustomModel('cm1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('bad key');
    });
  });

  // ── Messages getter ─────────────────────────────────────────────────

  describe('messages getter', () => {
    it('returns visible messages through getter', () => {
      const b = makeBranch('test', 'user', 'root');
      const m = makeMsg([b]);
      store.state.allMessages = [m];
      store.state.messagesVersion++;

      // Access through getter (which calls getVisibleMessages internally)
      expect(store.messages).toHaveLength(1);
    });
  });

  // ── Send/Continue/Regenerate/Edit/Delete (WebSocket integration) ────

  describe('message operations', () => {
    beforeEach(() => {
      store.state.wsService = mockWsInstance;
      store.state.currentConversation = { id: 'conv-1', model: 'test-model' };
    });

    it('sendMessage sends chat via websocket', async () => {
      const b = makeBranch('last msg', 'user', 'root');
      const m = makeMsg([b]);
      store.state.allMessages = [m];
      store.state.messagesVersion++;

      await store.sendMessage('hello');

      expect(mockWsInstance.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'chat',
          content: 'hello',
          conversationId: 'conv-1',
        })
      );
    });

    it('continueGeneration sends continue message', async () => {
      const b = makeBranch('last', 'assistant', 'root');
      const m = makeMsg([b]);
      store.state.allMessages = [m];
      store.state.messagesVersion++;

      await store.continueGeneration();

      expect(mockWsInstance.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'continue',
          conversationId: 'conv-1',
        })
      );
    });

    it('regenerateMessage sends regenerate message', async () => {
      await store.regenerateMessage('msg-1', 'branch-1');

      expect(mockWsInstance.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'regenerate',
          messageId: 'msg-1',
          branchId: 'branch-1',
        })
      );
    });

    it('editMessage sends edit message', async () => {
      await store.editMessage('msg-1', 'branch-1', 'new content');

      expect(mockWsInstance.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'edit',
          messageId: 'msg-1',
          branchId: 'branch-1',
          content: 'new content',
        })
      );
    });

    it('deleteMessage sends delete via websocket', async () => {
      await store.deleteMessage('msg-1', 'branch-1');

      expect(mockWsInstance.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'delete',
          messageId: 'msg-1',
          branchId: 'branch-1',
        })
      );
    });

    it('abortGeneration sends abort message', () => {
      store.abortGeneration();

      expect(mockWsInstance.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'abort',
          conversationId: 'conv-1',
        })
      );
    });
  });

  // ── WebSocket Connection Paths ─────────────────────────────────────

  describe('connectWebSocket deeper paths', () => {
    it('skips when wsService already connected', () => {
      localStorageMock.getItem.mockReturnValue('test-token');
      const existingWs: any = {
        connect: vi.fn(), disconnect: vi.fn(), sendMessage: vi.fn(), on: vi.fn(),
        isConnected: true, isConnecting: false,
      };
      store.state.wsService = existingWs;

      store.connectWebSocket();

      expect(existingWs.connect).not.toHaveBeenCalled();
      expect(existingWs.on).not.toHaveBeenCalled();
    });

    it('skips when wsService is connecting', () => {
      localStorageMock.getItem.mockReturnValue('test-token');
      const existingWs: any = {
        connect: vi.fn(), disconnect: vi.fn(), sendMessage: vi.fn(), on: vi.fn(),
        isConnected: false, isConnecting: true,
      };
      store.state.wsService = existingWs;

      store.connectWebSocket();

      expect(existingWs.connect).not.toHaveBeenCalled();
      expect(existingWs.on).not.toHaveBeenCalled();
    });

    it('reconnects when wsService exists but disconnected', () => {
      localStorageMock.getItem.mockReturnValue('test-token');
      const existingWs: any = {
        connect: vi.fn(), disconnect: vi.fn(), sendMessage: vi.fn(), on: vi.fn(),
        isConnected: false, isConnecting: false,
      };
      store.state.wsService = existingWs;

      store.connectWebSocket();

      expect(existingWs.connect).toHaveBeenCalled();
      expect(existingWs.on).not.toHaveBeenCalled();
    });

    it('creates new service and registers all event handlers', () => {
      localStorageMock.getItem.mockReturnValue('test-token');

      store.connectWebSocket();

      const eventNames = mockWsInstance.on.mock.calls.map((c: any) => c[0]);
      expect(eventNames).toContain('connection_state');
      expect(eventNames).toContain('message_created');
      expect(eventNames).toContain('stream');
      expect(eventNames).toContain('metrics_update');
      expect(eventNames).toContain('message_edited');
      expect(eventNames).toContain('message_deleted');
      expect(eventNames).toContain('message_restored');
      expect(eventNames).toContain('message_branch_restored');
      expect(eventNames).toContain('message_split');
      expect(eventNames).toContain('branch_visibility_changed');
      expect(eventNames).toContain('generation_aborted');
      expect(mockWsInstance.connect).toHaveBeenCalled();
    });
  });

  // ── WebSocket Event Handlers ───────────────────────────────────────

  describe('WebSocket event handlers', () => {
    let handlers: Record<string, Function>;

    beforeEach(() => {
      localStorageMock.getItem.mockReturnValue('test-token');
      store.connectWebSocket();
      handlers = {};
      for (const call of mockWsInstance.on.mock.calls) {
        handlers[call[0]] = call[1];
      }
    });

    it('connection_state updates wsConnectionState', () => {
      handlers.connection_state({ state: 'connected' });
      expect(store.state.wsConnectionState).toBe('connected');
    });

    it('message_created adds new message', () => {
      const msg = {
        id: 'new-msg',
        branches: [{ id: 'b1', parentBranchId: 'root', content: 'hello', role: 'system' }],
        activeBranchId: 'b1',
      };
      store.state.allMessages = [];

      handlers.message_created({ message: msg });

      expect(store.state.allMessages).toHaveLength(1);
      expect(store.state.allMessages[0].id).toBe('new-msg');
    });

    it('message_created updates existing message with new branch', () => {
      const existing = {
        id: 'msg-1',
        branches: [{ id: 'b1', parentBranchId: 'root', content: 'old', role: 'system' }],
        activeBranchId: 'b1',
      };
      store.state.allMessages = [existing];

      const updated = {
        id: 'msg-1',
        branches: [
          { id: 'b1', parentBranchId: 'root', content: 'old', role: 'system' },
          { id: 'b2', parentBranchId: 'root', content: 'new', role: 'system' },
        ],
        activeBranchId: 'b1',
      };

      handlers.message_created({ message: updated });

      expect(store.state.allMessages).toHaveLength(1);
      expect(store.state.allMessages[0].branches).toHaveLength(2);
    });

    it('message_created sets hidden branch notification', () => {
      const rootBranch = makeBranch('root msg', 'user', 'root', { id: 'visible-b1' });
      const rootMsg = makeMsg([rootBranch], { id: 'msg-1', order: 0 });
      store.state.allMessages = [rootMsg];
      store.state.messagesVersion++;

      const hiddenBranch = {
        id: 'hidden-b2', parentBranchId: 'non-visible-parent',
        content: 'hidden content', role: 'assistant',
        participantId: null, model: 'test-model', createdAt: new Date().toISOString(),
      };
      const newMsg = {
        id: 'msg-2',
        branches: [hiddenBranch],
        activeBranchId: 'hidden-b2',
      };

      handlers.message_created({ message: newMsg });

      expect(store.state.hiddenBranchActivities.has('hidden-b2')).toBe(true);
      const notification = store.state.hiddenBranchActivities.get('hidden-b2');
      expect(notification.content).toBe('hidden content');
    });

    it('message_created marks visible branch as read', () => {
      const rootBranch = makeBranch('root', 'user', 'root', { id: 'root-b' });
      const rootMsg = makeMsg([rootBranch], { id: 'msg-1', order: 0 });
      store.state.allMessages = [rootMsg];
      store.state.currentConversation = { id: 'conv-1' };
      store.state.messagesVersion++;

      const visibleBranch = {
        id: 'new-b', parentBranchId: 'root-b',
        content: 'reply', role: 'assistant',
        participantId: null, model: null, createdAt: new Date().toISOString(),
      };
      const newMsg = {
        id: 'msg-2',
        branches: [visibleBranch],
        activeBranchId: 'new-b',
      };

      handlers.message_created({ message: newMsg });

      expect(store.state.hiddenBranchActivities.has('new-b')).toBe(false);
      expect(store.state.readBranchIds.has('new-b')).toBe(true);
    });

    it('stream appends content to branch', () => {
      store.state.allMessages = [{
        id: 'msg-1',
        branches: [{ id: 'b1', content: 'hello', role: 'assistant' }],
        activeBranchId: 'b1',
      }];

      handlers.stream({ messageId: 'msg-1', branchId: 'b1', content: ' world' });

      expect(store.state.allMessages[0].branches[0].content).toBe('hello world');
    });

    it('stream updates contentBlocks and increments version', () => {
      store.state.allMessages = [{
        id: 'msg-1',
        branches: [{ id: 'b1', content: '', role: 'assistant' }],
        activeBranchId: 'b1',
      }];
      const versionBefore = store.state.messagesVersion;

      handlers.stream({
        messageId: 'msg-1', branchId: 'b1', content: '',
        contentBlocks: [{ type: 'thinking', thinking: 'hmm' }],
      });

      expect(store.state.allMessages[0].branches[0].contentBlocks).toEqual(
        [{ type: 'thinking', thinking: 'hmm' }]
      );
      expect(store.state.messagesVersion).toBeGreaterThan(versionBefore);
    });

    it('stream updates hidden notification content', () => {
      store.state.allMessages = [{
        id: 'msg-1',
        branches: [{ id: 'b1', content: 'short', role: 'assistant' }],
        activeBranchId: 'b1',
      }];
      store.state.hiddenBranchActivities.set('b1', {
        messageId: 'msg-1', branchId: 'b1', content: 'short',
        participantId: null, role: 'assistant', model: null, createdAt: new Date(),
      });

      handlers.stream({ messageId: 'msg-1', branchId: 'b1', content: ' addition' });

      expect(store.state.hiddenBranchActivities.get('b1').content).toBe('short addition');
    });

    it('stream no-ops for unknown message', () => {
      store.state.allMessages = [];
      handlers.stream({ messageId: 'missing', branchId: 'b1', content: 'test' });
      // Should not throw
    });

    it('metrics_update sets lastMetricsUpdate', () => {
      handlers.metrics_update({
        conversationId: 'conv-1',
        metrics: { tokensIn: 100, tokensOut: 50 },
      });

      expect(store.state.lastMetricsUpdate).toEqual({
        conversationId: 'conv-1',
        metrics: { tokensIn: 100, tokensOut: 50 },
      });
    });

    it('message_edited updates message in place', () => {
      store.state.allMessages = [{
        id: 'msg-1',
        branches: [{ id: 'b1', content: 'old', role: 'user' }],
        activeBranchId: 'b1',
      }];

      handlers.message_edited({
        message: {
          id: 'msg-1',
          branches: [
            { id: 'b1', content: 'old', role: 'user' },
            { id: 'b2', content: 'edited', role: 'user' },
          ],
          activeBranchId: 'b2',
        },
      });

      expect(store.state.allMessages[0].branches).toHaveLength(2);
      expect(store.state.allMessages[0].activeBranchId).toBe('b2');
    });

    it('message_edited creates notification for hidden new branches', () => {
      const rootBranch = makeBranch('root', 'user', 'root', { id: 'root-b' });
      const rootMsg = makeMsg([rootBranch], { id: 'msg-0', order: 0 });
      store.state.allMessages = [rootMsg, {
        id: 'msg-1',
        branches: [{ id: 'b1', content: 'old', role: 'assistant', parentBranchId: 'root-b' }],
        activeBranchId: 'b1',
      }];
      store.state.messagesVersion++;

      handlers.message_edited({
        message: {
          id: 'msg-1',
          branches: [
            { id: 'b1', content: 'old', role: 'assistant', parentBranchId: 'root-b' },
            {
              id: 'b-hidden', content: 'hidden edit', role: 'assistant',
              parentBranchId: 'non-visible-parent', model: null,
              participantId: null, createdAt: new Date().toISOString(),
            },
          ],
          activeBranchId: 'b1',
        },
      });

      expect(store.state.hiddenBranchActivities.has('b-hidden')).toBe(true);
    });

    it('message_deleted cascade removes multiple messages', () => {
      store.state.allMessages = [
        { id: 'msg-1', branches: [], activeBranchId: '' },
        { id: 'msg-2', branches: [], activeBranchId: '' },
        { id: 'msg-3', branches: [], activeBranchId: '' },
      ];

      handlers.message_deleted({
        messageId: 'msg-1', branchId: 'b1',
        deletedMessages: ['msg-1', 'msg-2'],
      });

      expect(store.state.allMessages).toHaveLength(1);
      expect(store.state.allMessages[0].id).toBe('msg-3');
    });

    it('message_deleted removes branch from multi-branch message', () => {
      store.state.allMessages = [{
        id: 'msg-1',
        branches: [
          { id: 'b1', content: 'A', role: 'user' },
          { id: 'b2', content: 'B', role: 'user' },
        ],
        activeBranchId: 'b1',
      }];

      handlers.message_deleted({ messageId: 'msg-1', branchId: 'b2' });

      expect(store.state.allMessages[0].branches).toHaveLength(1);
      expect(store.state.allMessages[0].branches[0].id).toBe('b1');
    });

    it('message_deleted removes entire message when single branch', () => {
      store.state.allMessages = [{
        id: 'msg-1',
        branches: [{ id: 'b1', content: 'only', role: 'user' }],
        activeBranchId: 'b1',
      }];

      handlers.message_deleted({ messageId: 'msg-1', branchId: 'b1' });

      expect(store.state.allMessages).toHaveLength(0);
    });

    it('message_deleted switches activeBranchId when active branch deleted', () => {
      store.state.allMessages = [{
        id: 'msg-1',
        branches: [
          { id: 'b1', content: 'A', role: 'user' },
          { id: 'b2', content: 'B', role: 'user' },
        ],
        activeBranchId: 'b2',
      }];

      handlers.message_deleted({ messageId: 'msg-1', branchId: 'b2' });

      expect(store.state.allMessages[0].activeBranchId).toBe('b1');
    });

    it('message_restored adds new message', () => {
      store.state.allMessages = [
        { id: 'msg-1', branches: [], activeBranchId: '', order: 0 },
      ];

      handlers.message_restored({
        message: { id: 'msg-2', branches: [{ id: 'b1' }], activeBranchId: 'b1', order: 1 },
      });

      expect(store.state.allMessages).toHaveLength(2);
    });

    it('message_restored updates existing message', () => {
      store.state.allMessages = [
        { id: 'msg-1', branches: [{ id: 'b1', content: 'old' }], activeBranchId: 'b1' },
      ];

      handlers.message_restored({
        message: { id: 'msg-1', branches: [{ id: 'b1', content: 'restored' }], activeBranchId: 'b1' },
      });

      expect(store.state.allMessages).toHaveLength(1);
      expect(store.state.allMessages[0].branches[0].content).toBe('restored');
    });

    it('message_branch_restored updates existing message', () => {
      store.state.allMessages = [
        { id: 'msg-1', branches: [{ id: 'b1' }], activeBranchId: 'b1' },
      ];

      handlers.message_branch_restored({
        message: { id: 'msg-1', branches: [{ id: 'b1' }, { id: 'b2' }], activeBranchId: 'b1' },
      });

      expect(store.state.allMessages[0].branches).toHaveLength(2);
    });

    it('message_branch_restored inserts if message does not exist', () => {
      store.state.allMessages = [];

      handlers.message_branch_restored({
        message: { id: 'msg-new', branches: [{ id: 'b1' }], activeBranchId: 'b1', order: 0 },
      });

      expect(store.state.allMessages).toHaveLength(1);
      expect(store.state.allMessages[0].id).toBe('msg-new');
    });

    it('message_split updates original and adds new message', () => {
      store.state.allMessages = [
        { id: 'msg-1', branches: [{ id: 'b1', content: 'original full' }], activeBranchId: 'b1' },
      ];

      handlers.message_split({
        originalMessage: { id: 'msg-1', branches: [{ id: 'b1', content: 'first half' }], activeBranchId: 'b1' },
        newMessage: { id: 'msg-2', branches: [{ id: 'b2', content: 'second half' }], activeBranchId: 'b2', order: 1 },
      });

      expect(store.state.allMessages).toHaveLength(2);
      expect(store.state.allMessages[0].branches[0].content).toBe('first half');
    });

    it('branch_visibility_changed removes branch private to other user', () => {
      store.state.user = { id: 'user-1' } as any;
      store.state.allMessages = [{
        id: 'msg-1',
        branches: [
          { id: 'b1', content: 'public', role: 'user' },
          { id: 'b2', content: 'private', role: 'assistant' },
        ],
        activeBranchId: 'b1',
      }];

      handlers.branch_visibility_changed({
        messageId: 'msg-1', branchId: 'b2', privateToUserId: 'other-user',
      });

      expect(store.state.allMessages[0].branches).toHaveLength(1);
      expect(store.state.allMessages[0].branches[0].id).toBe('b1');
    });

    it('branch_visibility_changed updates privacy for own branch', () => {
      store.state.user = { id: 'user-1' } as any;
      store.state.allMessages = [{
        id: 'msg-1',
        branches: [{ id: 'b1', content: 'mine', role: 'user' }],
        activeBranchId: 'b1',
      }];

      handlers.branch_visibility_changed({
        messageId: 'msg-1', branchId: 'b1', privateToUserId: 'user-1',
      });

      expect(store.state.allMessages[0].branches[0].privateToUserId).toBe('user-1');
    });

    it('branch_visibility_changed fetches subtree when message not found', async () => {
      store.state.user = { id: 'user-1' } as any;
      store.state.currentConversation = { id: 'conv-1' };
      store.state.allMessages = [];

      mockApi.get.mockResolvedValueOnce({
        data: { messages: [{ id: 'new-msg', branches: [{ id: 'b1' }] }] },
      });

      await handlers.branch_visibility_changed({
        messageId: 'unknown-msg', branchId: 'b1', privateToUserId: null,
      });

      expect(mockApi.get).toHaveBeenCalledWith('/conversations/conv-1/subtree/b1');
      expect(store.state.allMessages).toHaveLength(1);
    });

    it('generation_aborted handler runs without error', () => {
      handlers.generation_aborted({ conversationId: 'conv-1' });
      // No state change expected - handler is a no-op
    });
  });

  // ── loadConversation ───────────────────────────────────────────────

  describe('loadConversation', () => {
    it('loads conversation, messages, and UI state', async () => {
      const b1 = makeBranch('hello', 'user', 'root', { id: 'b1' });
      const msg1 = makeMsg([b1], { id: 'msg-1', order: 0 });

      mockApi.get
        .mockResolvedValueOnce({ data: { id: 'c1', model: 'm1' } })
        .mockResolvedValueOnce({ data: [msg1] })
        .mockResolvedValueOnce({ data: { readBranchIds: ['b1'], isDetached: false } });

      await store.loadConversation('c1');

      expect(store.state.currentConversation).toEqual({ id: 'c1', model: 'm1' });
      expect(store.state.allMessages).toHaveLength(1);
      expect(store.state.readBranchIds.has('b1')).toBe(true);
      expect(store.state.sharedActiveBranchIds.size).toBeGreaterThan(0);
    });

    it('applies detached mode from UI state', async () => {
      const b1 = makeBranch('A', 'user', 'root', { id: 'b1' });
      const b2 = makeBranch('B', 'user', 'root', { id: 'b2' });
      const msg1 = makeMsg([b1, b2], { id: 'msg-1', order: 0, activeBranchId: 'b1' });

      mockApi.get
        .mockResolvedValueOnce({ data: { id: 'c1', model: 'm1' } })
        .mockResolvedValueOnce({ data: [msg1] })
        .mockResolvedValueOnce({
          data: {
            readBranchIds: [],
            isDetached: true,
            detachedBranches: { 'msg-1': 'b2' },
          },
        });

      await store.loadConversation('c1');

      expect(store.state.isDetachedFromMainBranch).toBe(true);
      expect(store.state.allMessages[0].activeBranchId).toBe('b2');
      expect(store.state.sharedActiveBranchIds.get('msg-1')).toBe('b1');
    });

    it('flushes pending read state before switching', async () => {
      store.state.currentConversation = { id: 'old-conv' } as any;
      store.state.readBranchIds = new Set(['old-b1', 'old-b2']);
      store.state.readPersistTimeout = setTimeout(() => {}, 10000);

      mockApi.post.mockResolvedValueOnce({ data: null });
      mockApi.get
        .mockResolvedValueOnce({ data: { id: 'new-conv', model: 'm1' } })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: { readBranchIds: [], isDetached: false } });

      await store.loadConversation('new-conv');

      expect(mockApi.post).toHaveBeenCalledWith('/conversations/old-conv/mark-read', {
        branchIds: expect.arrayContaining(['old-b1', 'old-b2']),
      });
    });

    it('throws on non-retryable error', async () => {
      mockApi.get.mockRejectedValueOnce(new Error('Not Found'));

      await expect(store.loadConversation('bad-id')).rejects.toThrow('Not Found');
    });

    it('clears hidden branch activities on load', async () => {
      store.state.hiddenBranchActivities.set('b1', {
        messageId: 'msg-1', branchId: 'b1', content: 'old',
        participantId: null, role: 'user', model: null, createdAt: new Date(),
      });

      mockApi.get
        .mockResolvedValueOnce({ data: { id: 'c1', model: 'm1' } })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: { readBranchIds: [], isDetached: false } });

      await store.loadConversation('c1');

      expect(store.state.hiddenBranchActivities.size).toBe(0);
    });
  });

  // ── loadMessages ───────────────────────────────────────────────────

  describe('loadMessages', () => {
    it('loads and sets allMessages', async () => {
      const msg = { id: 'msg-1', branches: [{ id: 'b1' }], activeBranchId: 'b1' };
      mockApi.get.mockResolvedValueOnce({ data: [msg] });

      await store.loadMessages('c1');

      expect(store.state.allMessages).toHaveLength(1);
      expect(store.state.allMessages[0].id).toBe('msg-1');
      expect(mockApi.get).toHaveBeenCalledWith('/conversations/c1/messages');
    });

    it('handles null response data gracefully', async () => {
      mockApi.get.mockResolvedValueOnce({ data: null });

      await store.loadMessages('c1');

      expect(store.state.allMessages).toEqual([]);
    });

    it('throws on non-retryable error', async () => {
      mockApi.get.mockRejectedValueOnce(new Error('Server Error'));

      await expect(store.loadMessages('c1')).rejects.toThrow('Server Error');
    });
  });

  // ── sendMessage deeper paths ───────────────────────────────────────

  describe('sendMessage deeper paths', () => {
    beforeEach(() => {
      store.state.wsService = mockWsInstance;
      store.state.currentConversation = { id: 'conv-1', model: 'test-model' };
    });

    it('uses explicitParentBranchId when provided', async () => {
      await store.sendMessage('hello', undefined, undefined, undefined, 'explicit-branch');

      expect(mockWsInstance.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ parentBranchId: 'explicit-branch' })
      );
    });

    it('passes hiddenFromAi flag', async () => {
      const b = makeBranch('msg', 'user', 'root');
      store.state.allMessages = [makeMsg([b])];
      store.state.messagesVersion++;

      await store.sendMessage('secret', undefined, undefined, undefined, undefined, true);

      expect(mockWsInstance.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ hiddenFromAi: true })
      );
    });

    it('passes samplingBranches when > 1', async () => {
      const b = makeBranch('msg', 'user', 'root');
      store.state.allMessages = [makeMsg([b])];
      store.state.messagesVersion++;

      await store.sendMessage('test', undefined, undefined, undefined, undefined, undefined, 3);

      expect(mockWsInstance.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ samplingBranches: 3 })
      );
    });

    it('returns early when no wsService', async () => {
      store.state.wsService = null;
      await store.sendMessage('hello');
      expect(mockWsInstance.sendMessage).not.toHaveBeenCalled();
    });

    it('returns early when no currentConversation', async () => {
      store.state.currentConversation = null;
      await store.sendMessage('hello');
      expect(mockWsInstance.sendMessage).not.toHaveBeenCalled();
    });

    it('updates conversation updatedAt timestamp', async () => {
      const conv = { id: 'conv-1', model: 'm1', updatedAt: new Date('2024-01-01') } as any;
      store.state.currentConversation = conv;
      store.state.conversations = [conv];
      const b = makeBranch('msg', 'user', 'root');
      store.state.allMessages = [makeMsg([b])];
      store.state.messagesVersion++;

      await store.sendMessage('test');

      expect(conv.updatedAt.getTime()).toBeGreaterThan(new Date('2024-01-01').getTime());
    });

    it('determines parentBranchId from last visible message', async () => {
      const b1 = makeBranch('first', 'user', 'root', { id: 'branch-1' });
      const m1 = makeMsg([b1], { order: 0 });
      const b2 = makeBranch('second', 'assistant', b1.id, { id: 'branch-2' });
      const m2 = makeMsg([b2], { order: 1 });

      store.state.allMessages = [m1, m2];
      store.state.messagesVersion++;

      await store.sendMessage('reply');

      expect(mockWsInstance.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ parentBranchId: 'branch-2' })
      );
    });
  });

  // ── continueGeneration deeper paths ────────────────────────────────

  describe('continueGeneration deeper paths', () => {
    beforeEach(() => {
      store.state.wsService = mockWsInstance;
      store.state.currentConversation = { id: 'conv-1', model: 'test-model' };
    });

    it('uses explicitParentBranchId', async () => {
      await store.continueGeneration(undefined, 'explicit-branch');

      expect(mockWsInstance.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ parentBranchId: 'explicit-branch' })
      );
    });

    it('returns early when no wsService', async () => {
      store.state.wsService = null;
      await store.continueGeneration();
      expect(mockWsInstance.sendMessage).not.toHaveBeenCalled();
    });

    it('passes samplingBranches when > 1', async () => {
      const b = makeBranch('msg', 'assistant', 'root');
      store.state.allMessages = [makeMsg([b])];
      store.state.messagesVersion++;

      await store.continueGeneration(undefined, undefined, 3);

      expect(mockWsInstance.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ samplingBranches: 3 })
      );
    });

    it('updates conversation updatedAt', async () => {
      const conv = { id: 'conv-1', model: 'm1', updatedAt: new Date('2024-01-01') } as any;
      store.state.currentConversation = conv;
      store.state.conversations = [conv];
      const b = makeBranch('msg', 'assistant', 'root');
      store.state.allMessages = [makeMsg([b])];
      store.state.messagesVersion++;

      await store.continueGeneration();

      expect(conv.updatedAt.getTime()).toBeGreaterThan(new Date('2024-01-01').getTime());
    });
  });

  // ── Additional Conversation Operations ─────────────────────────────

  describe('additional conversation operations', () => {
    it('duplicateConversation posts and prepends', async () => {
      const dup = { id: 'dup-1', model: 'm1' };
      mockApi.post.mockResolvedValueOnce({ data: dup });
      store.state.conversations = [{ id: 'c1' }] as any[];

      const result = await store.duplicateConversation('c1');

      expect(result).toEqual(dup);
      expect(store.state.conversations[0]).toEqual(dup);
      expect(mockApi.post).toHaveBeenCalledWith('/conversations/c1/duplicate');
    });

    it('compactConversation posts with options', async () => {
      mockApi.post.mockResolvedValueOnce({ data: { success: true } });

      const result = await store.compactConversation('c1');

      expect(result).toEqual({ success: true });
      expect(mockApi.post).toHaveBeenCalledWith('/conversations/c1/compact', expect.objectContaining({
        stripDebugData: true,
      }));
    });

    it('archiveConversation clears current when archiving current', async () => {
      store.state.conversations = [{ id: 'c1' }, { id: 'c2' }] as any[];
      store.state.currentConversation = { id: 'c1' } as any;
      store.state.allMessages = [{ id: 'msg-1' }] as any[];
      mockApi.post.mockResolvedValueOnce({ data: null });

      await store.archiveConversation('c1');

      expect(store.state.currentConversation).toBeNull();
      expect(store.state.allMessages).toEqual([]);
      expect(store.state.conversations).toHaveLength(1);
      expect(store.state.conversations[0].id).toBe('c2');
    });

    it('createConversation uses model defaults from found model', async () => {
      store.state.models = [{ id: 'm1', name: 'Model 1' }] as any[];
      const conv = { id: 'new-1', model: 'm1' };
      mockApi.post.mockResolvedValueOnce({ data: conv });

      await store.createConversation('m1', 'My Chat');

      expect(mockApi.post).toHaveBeenCalledWith('/conversations', expect.objectContaining({
        model: 'm1',
        title: 'My Chat',
        format: 'standard',
        settings: { temperature: 0.7, maxTokens: 1024 },
      }));
    });

    it('createConversation uses fallback for unknown model', async () => {
      store.state.models = [];
      mockApi.post.mockResolvedValueOnce({ data: { id: 'new-1' } });

      await store.createConversation('unknown-model');

      expect(mockApi.post).toHaveBeenCalledWith('/conversations', expect.objectContaining({
        settings: { temperature: 1.0, maxTokens: 4096 },
      }));
    });

    it('updateConversation updates in list and current', async () => {
      store.state.conversations = [{ id: 'c1', title: 'Old' }] as any[];
      store.state.currentConversation = { id: 'c1', title: 'Old' } as any;
      mockApi.patch.mockResolvedValueOnce({ data: { id: 'c1', title: 'New' } });

      await store.updateConversation('c1', { title: 'New' } as any);

      expect(store.state.conversations[0].title).toBe('New');
      expect(store.state.currentConversation.title).toBe('New');
    });

    it('register throws and sets error on failure', async () => {
      mockApi.post.mockRejectedValueOnce({
        response: { data: { error: 'Email taken' } },
      });

      await expect(store.register('a@b.com', 'pw', 'Name')).rejects.toBeTruthy();
      expect(store.state.error).toBe('Email taken');
    });

    it('regenerateMessage returns early when no wsService', async () => {
      store.state.wsService = null;
      store.state.currentConversation = { id: 'c1' } as any;
      await store.regenerateMessage('msg-1', 'b1');
      expect(mockWsInstance.sendMessage).not.toHaveBeenCalled();
    });

    it('editMessage returns early when no wsService', async () => {
      store.state.wsService = null;
      store.state.currentConversation = { id: 'c1' } as any;
      await store.editMessage('msg-1', 'b1', 'new content');
      expect(mockWsInstance.sendMessage).not.toHaveBeenCalled();
    });

    it('deleteMessage returns early when no wsService', async () => {
      store.state.wsService = null;
      store.state.currentConversation = { id: 'c1' } as any;
      await store.deleteMessage('msg-1', 'b1');
      expect(mockWsInstance.sendMessage).not.toHaveBeenCalled();
    });

    it('abortGeneration returns early when no wsService', () => {
      store.state.wsService = null;
      store.state.currentConversation = { id: 'c1' } as any;
      store.abortGeneration();
      expect(mockWsInstance.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ── Mutation Tests ──────────────────────────────────────────────────

  describe('mutation tests', () => {
    describe('getVisibleMessages mutations', () => {
      it('M1: only root with root parentBranchId is visible', () => {
        const rootBranch = makeBranch('root', 'user', 'root');
        const nonRootBranch = makeBranch('child', 'assistant', rootBranch.id);
        const m1 = makeMsg([rootBranch], { order: 0 });
        const m2 = makeMsg([nonRootBranch], { order: 1 });

        store.state.allMessages = [m1, m2];
        store.state.messagesVersion++;

        const visible = store.getVisibleMessages();
        // Both should be visible — m2 is child of m1's branch
        expect(visible).toHaveLength(2);
        // Mutating root check (allowing non-root as root) would break this
      });

      it('M2: switching active branch changes visible path', () => {
        const root = makeBranch('root', 'user', 'root');
        const m1 = makeMsg([root], { order: 0 });

        const childA = makeBranch('A', 'assistant', root.id);
        const childB = makeBranch('B', 'assistant', root.id);
        const m2 = makeMsg([childA, childB], { order: 1, activeBranchId: childA.id });

        const grandchildA = makeBranch('AA', 'user', childA.id);
        const m3 = makeMsg([grandchildA], { order: 2 });

        const grandchildB = makeBranch('BB', 'user', childB.id);
        const m4 = makeMsg([grandchildB], { order: 3 });

        store.state.allMessages = [m1, m2, m3, m4];
        store.state.currentConversation = { id: 'conv-1' };
        store.state.messagesVersion++;

        // With childA active → m3 visible, m4 hidden
        let visible = store.getVisibleMessages();
        expect(visible.some((m: any) => m.id === m3.id)).toBe(true);
        expect(visible.some((m: any) => m.id === m4.id)).toBe(false);

        // Use store's switchBranch to properly invalidate caches
        store.switchBranch(m2.id, childB.id);

        visible = store.getVisibleMessages();
        expect(visible.some((m: any) => m.id === m4.id)).toBe(true);
        expect(visible.some((m: any) => m.id === m3.id)).toBe(false);
      });
    });

    describe('switchBranch mutations', () => {
      it('M3: switchBranch updates activeBranchId and cascades correctly', () => {
        const root = makeBranch('root', 'user', 'root');
        const m1 = makeMsg([root], { order: 0 });

        const branchA = makeBranch('A', 'assistant', root.id);
        const branchB = makeBranch('B', 'assistant', root.id);
        const m2 = makeMsg([branchA, branchB], { order: 1, activeBranchId: branchA.id });

        store.state.allMessages = [m1, m2];
        store.state.currentConversation = { id: 'conv-1' };

        // Verify initial state
        expect(m2.activeBranchId).toBe(branchA.id);

        // Switch m2 to branchB
        store.switchBranch(m2.id, branchB.id);

        // Verify mutation: activeBranchId should now be branchB
        // If mutated to not update, it would still be branchA
        expect(m2.activeBranchId).toBe(branchB.id);
        // Verify API was called with correct data
        expect(mockApi.post).toHaveBeenCalledWith(
          '/conversations/conv-1/set-active-branch',
          { messageId: m2.id, branchId: branchB.id }
        );
      });
    });

    describe('setDetachedMode mutations', () => {
      it('M4: snapshot correctly captures activeBranchIds', () => {
        const b1 = makeBranch('A', 'user', 'root');
        const b2 = makeBranch('B', 'user', 'root');
        const m = makeMsg([b1, b2], { activeBranchId: b1.id });

        store.state.allMessages = [m];

        store.setDetachedMode(true);

        // Snapshot should have b1 (the active branch at time of snapshot)
        expect(store.state.sharedActiveBranchIds.get(m.id)).toBe(b1.id);

        // Change branch while detached
        m.activeBranchId = b2.id;

        // Exit detached — should restore to b1, not keep b2
        store.setDetachedMode(false);
        expect(m.activeBranchId).toBe(b1.id);
      });
    });
  });
});
