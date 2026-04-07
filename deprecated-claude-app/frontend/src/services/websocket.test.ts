import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketService } from './websocket';

// Mock WebSocket
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;

  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    // Auto-register in global list for test inspection
    mockWebSockets.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(_code?: number, _reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code: _code || 1000, reason: _reason || '' });
    }
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen({});
  }

  simulateMessage(data: any) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  simulateClose(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({ code, reason });
  }

  simulateError(error: any = {}) {
    if (this.onerror) this.onerror(error);
  }
}

let mockWebSockets: MockWebSocket[] = [];

// Store original globals
const originalWebSocket = globalThis.WebSocket;

describe('WebSocketService', () => {
  let service: WebSocketService;

  beforeEach(() => {
    mockWebSockets = [];

    // Mock WebSocket constructor
    (globalThis as any).WebSocket = MockWebSocket;

    // Mock window.location
    Object.defineProperty(window, 'location', {
      value: { href: 'http://localhost:3000/', protocol: 'http:' },
      writable: true,
      configurable: true
    });

    // Mock sessionStorage
    const storage: Record<string, string> = {};
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage[key] || null,
      setItem: (key: string, value: string) => { storage[key] = value; },
      removeItem: (key: string) => { delete storage[key]; },
    });

    // Mock import.meta.env
    vi.stubGlobal('import', { meta: { env: { DEV: false } } });

    // Use fake timers
    vi.useFakeTimers();

    service = new WebSocketService('test-token');
  });

  afterEach(() => {
    service.disconnect();
    vi.restoreAllMocks();
    vi.useRealTimers();
    (globalThis as any).WebSocket = originalWebSocket;
  });

  function getLatestWs(): MockWebSocket {
    return mockWebSockets[mockWebSockets.length - 1];
  }

  describe('event handler registration', () => {
    it('registers and triggers event handlers via on()', () => {
      const handler = vi.fn();
      service.on('test_event', handler);

      service.connect();
      const ws = getLatestWs();
      ws.simulateOpen();
      ws.simulateMessage({ type: 'test_event', payload: 'hello' });

      expect(handler).toHaveBeenCalledWith({ type: 'test_event', payload: 'hello' });
    });

    it('supports multiple handlers for the same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      service.on('test_event', handler1);
      service.on('test_event', handler2);

      service.connect();
      getLatestWs().simulateOpen();
      getLatestWs().simulateMessage({ type: 'test_event' });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('removes handlers via off()', () => {
      const handler = vi.fn();
      service.on('test_event', handler);
      service.off('test_event', handler);

      service.connect();
      getLatestWs().simulateOpen();
      getLatestWs().simulateMessage({ type: 'test_event' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('emits connection_state events', () => {
      const handler = vi.fn();
      service.on('connection_state', handler);

      service.connect();
      expect(handler).toHaveBeenCalledWith({ state: 'connecting' });

      getLatestWs().simulateOpen();
      expect(handler).toHaveBeenCalledWith({ state: 'connected' });
    });
  });

  describe('message queuing', () => {
    it('queues messages when not connected', () => {
      service.sendMessage({ type: 'test' } as any);
      expect(service.queuedMessageCount).toBe(1);
    });

    it('sends queued messages on connection open', () => {
      service.sendMessage({ type: 'queued_msg_1' } as any);
      service.sendMessage({ type: 'queued_msg_2' } as any);

      service.connect();
      const ws = getLatestWs();
      ws.simulateOpen();

      expect(ws.sent).toHaveLength(2);
      expect(JSON.parse(ws.sent[0]).type).toBe('queued_msg_1');
      expect(JSON.parse(ws.sent[1]).type).toBe('queued_msg_2');
      expect(service.queuedMessageCount).toBe(0);
    });

    it('sends immediately when connected', () => {
      service.connect();
      const ws = getLatestWs();
      ws.simulateOpen();

      service.sendMessage({ type: 'direct' } as any);
      expect(ws.sent).toHaveLength(1);
      expect(JSON.parse(ws.sent[0]).type).toBe('direct');
    });
  });

  describe('reconnection', () => {
    it('attempts reconnection on unexpected close', () => {
      const stateHandler = vi.fn();
      service.on('connection_state', stateHandler);

      service.connect();
      const ws = getLatestWs();
      ws.simulateOpen();

      // Simulate unexpected close
      ws.simulateClose(1006, 'Connection lost');

      expect(stateHandler).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'reconnecting', attempt: 1 })
      );
    });

    it('uses exponential backoff for reconnection delays', () => {
      service.connect();
      getLatestWs().simulateOpen();
      getLatestWs().simulateClose(1006);

      // First attempt: 1000ms
      expect(mockWebSockets).toHaveLength(1); // only initial
      vi.advanceTimersByTime(1000);
      expect(mockWebSockets).toHaveLength(2); // reconnect attempt

      // Close again to trigger second attempt — 1000ms should NOT be enough
      getLatestWs().simulateClose(1006);
      vi.advanceTimersByTime(1000);
      expect(mockWebSockets).toHaveLength(2); // still 2 — not enough time
      vi.advanceTimersByTime(1000); // total 2000ms
      expect(mockWebSockets).toHaveLength(3);

      // Close again for third attempt — needs 4000ms
      getLatestWs().simulateClose(1006);
      vi.advanceTimersByTime(2000);
      expect(mockWebSockets).toHaveLength(3); // still 3 — not enough time
      vi.advanceTimersByTime(2000); // total 4000ms
      expect(mockWebSockets).toHaveLength(4);
    });

    it('stops after max reconnect attempts', () => {
      const errorHandler = vi.fn();
      const stateHandler = vi.fn();
      service.on('error', errorHandler);
      service.on('connection_state', stateHandler);

      service.connect();
      getLatestWs().simulateOpen();

      // Trigger max attempts (5)
      for (let i = 0; i < 5; i++) {
        getLatestWs().simulateClose(1006);
        vi.advanceTimersByTime(20000); // Advance past any backoff
      }

      // 6th attempt should emit error
      getLatestWs().simulateClose(1006);
      expect(stateHandler).toHaveBeenCalledWith({ state: 'failed' });
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Failed to reconnect to server' })
      );
    });

    it('does not reconnect after intentional disconnect', () => {
      service.connect();
      getLatestWs().simulateOpen();

      service.disconnect();

      vi.advanceTimersByTime(30000);
      // Should only have the original connection
      expect(mockWebSockets).toHaveLength(1);
    });
  });

  describe('disconnect', () => {
    it('closes the WebSocket and clears state', () => {
      service.connect();
      const ws = getLatestWs();
      ws.simulateOpen();

      service.disconnect();
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
      expect(service.queuedMessageCount).toBe(0);
    });

    it('removes visibility change handler', () => {
      const removeSpy = vi.spyOn(document, 'removeEventListener');
      service.disconnect();
      expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });

    it('clears event handlers', () => {
      const handler = vi.fn();
      service.on('test', handler);
      service.disconnect();

      // Re-create and connect — old handler should not fire
      service = new WebSocketService('test-token');
      service.connect();
      getLatestWs().simulateOpen();
      getLatestWs().simulateMessage({ type: 'test' });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('room management', () => {
    it('sends join_room message', () => {
      service.connect();
      const ws = getLatestWs();
      ws.simulateOpen();

      service.joinRoom('conv-1');
      const lastSent = JSON.parse(ws.sent[ws.sent.length - 1]);
      expect(lastSent.type).toBe('join_room');
      expect(lastSent.conversationId).toBe('conv-1');
      expect(service.getCurrentRoom()).toBe('conv-1');
    });

    it('does not re-join same room', () => {
      service.connect();
      const ws = getLatestWs();
      ws.simulateOpen();

      service.joinRoom('conv-1');
      const countAfterJoin = ws.sent.length;
      service.joinRoom('conv-1');
      expect(ws.sent.length).toBe(countAfterJoin); // no new message
    });

    it('leaves previous room before joining new one', () => {
      service.connect();
      const ws = getLatestWs();
      ws.simulateOpen();

      service.joinRoom('conv-1');
      service.joinRoom('conv-2');

      // Should have: join conv-1, leave conv-1, join conv-2
      const messages = ws.sent.map(s => JSON.parse(s));
      expect(messages[0].type).toBe('join_room');
      expect(messages[1].type).toBe('leave_room');
      expect(messages[1].conversationId).toBe('conv-1');
      expect(messages[2].type).toBe('join_room');
      expect(messages[2].conversationId).toBe('conv-2');
    });

    it('sends leave_room message', () => {
      service.connect();
      const ws = getLatestWs();
      ws.simulateOpen();

      service.joinRoom('conv-1');
      service.leaveRoom('conv-1');

      const lastSent = JSON.parse(ws.sent[ws.sent.length - 1]);
      expect(lastSent.type).toBe('leave_room');
      expect(service.getCurrentRoom()).toBeNull();
    });

    it('leaveRoom does nothing if not in specified room', () => {
      service.connect();
      const ws = getLatestWs();
      ws.simulateOpen();

      service.joinRoom('conv-1');
      const countBefore = ws.sent.length;
      service.leaveRoom('conv-2'); // different room
      expect(ws.sent.length).toBe(countBefore);
    });

    it('sendTyping sends typing indicator', () => {
      service.connect();
      const ws = getLatestWs();
      ws.simulateOpen();

      service.sendTyping('conv-1', true);
      const sent = JSON.parse(ws.sent[ws.sent.length - 1]);
      expect(sent.type).toBe('typing');
      expect(sent.conversationId).toBe('conv-1');
      expect(sent.isTyping).toBe(true);
    });
  });

  describe('connection state properties', () => {
    it('isConnected returns false before connecting', () => {
      expect(service.isConnected).toBe(false);
    });

    it('isConnected returns true when open', () => {
      service.connect();
      getLatestWs().simulateOpen();
      expect(service.isConnected).toBe(true);
    });

    it('isConnecting returns true while connecting', () => {
      service.connect();
      expect(service.isConnecting).toBe(true);
    });

    it('connectionState reflects current state', () => {
      expect(service.connectionState).toBe('disconnected');

      service.connect();
      expect(service.connectionState).toBe('connecting');

      getLatestWs().simulateOpen();
      expect(service.connectionState).toBe('connected');

      getLatestWs().simulateClose(1006);
      expect(service.connectionState).toBe('reconnecting');
    });
  });

  describe('connect guards', () => {
    it('does not create duplicate connection when already open', () => {
      service.connect();
      getLatestWs().simulateOpen();

      service.connect(); // should no-op
      expect(mockWebSockets).toHaveLength(1);
    });

    it('does not create duplicate connection when connecting', () => {
      service.connect();
      // readyState is CONNECTING
      service.connect(); // should no-op
      expect(mockWebSockets).toHaveLength(1);
    });
  });

  describe('visibility handler', () => {
    it('reconnects when tab becomes visible and ws is closed', () => {
      service.connect();
      const ws = getLatestWs();
      ws.simulateOpen();

      // Simulate connection dying without close event (zombie)
      (ws as any).readyState = MockWebSocket.CLOSED;

      // Trigger visibility change
      document.dispatchEvent(new Event('visibilitychange'));
      // The visibility handler checks document.visibilityState
      // In happy-dom the default should work; force it:
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      // Should have created a new connection
      expect(mockWebSockets.length).toBeGreaterThan(1);
    });

    it('resets reconnect attempts when tab becomes visible', () => {
      service.connect();
      getLatestWs().simulateOpen();
      getLatestWs().simulateClose(1006);

      // Advance a bit (reconnect attempt 1)
      vi.advanceTimersByTime(1000);

      // Tab becomes visible — resets reconnect counter
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      // After reset, connectionState should be back to normal
      // (new connection was created)
    });
  });

  describe('keep-alive', () => {
    it('sends ping after 15 second interval', () => {
      service.connect();
      const ws = getLatestWs();
      ws.simulateOpen();

      ws.sent.length = 0; // clear any queued messages

      // Advance 15 seconds for keep-alive
      vi.advanceTimersByTime(15000);

      const pings = ws.sent.filter(s => JSON.parse(s).type === 'ping');
      expect(pings.length).toBeGreaterThanOrEqual(1);
    });

    it('closes connection when no server activity for 45+ seconds', () => {
      service.connect();
      const ws = getLatestWs();
      ws.simulateOpen();

      // Keep-alive fires every 15s. At 15s: pong age = 15s (ok).
      // At 30s: pong age = 30s (ok). At 45s: pong age = 45s (ok).
      // At 60s: pong age = 60s (> 45s), so it closes.
      // But the 15s ping also triggers send which doesn't update lastPongTime
      // (only server messages update it). So we need to advance past 45s
      // to a keep-alive tick where timeSinceLastPong > 45000.
      vi.advanceTimersByTime(60001);

      // The connection should have been closed due to staleness
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });
  });

  describe('connection timeout', () => {
    it('closes and retries if connection takes too long', () => {
      service.connect();
      const ws = getLatestWs();
      // Don't simulate open - stays in CONNECTING state

      // Advance 20 seconds for connection timeout
      vi.advanceTimersByTime(20000);

      // Should have triggered attemptReconnect
      // Advance the reconnection delay
      vi.advanceTimersByTime(1000);
      expect(mockWebSockets.length).toBeGreaterThan(1);
    });
  });

  describe('message parsing', () => {
    it('parses JSON messages and emits by type', () => {
      const handler = vi.fn();
      service.on('chat_message', handler);

      service.connect();
      getLatestWs().simulateOpen();
      getLatestWs().simulateMessage({ type: 'chat_message', text: 'hello' });

      expect(handler).toHaveBeenCalledWith({ type: 'chat_message', text: 'hello' });
    });

    it('handles malformed JSON without crashing', () => {
      service.connect();
      const ws = getLatestWs();
      ws.simulateOpen();

      // Manually trigger onmessage with invalid JSON
      expect(() => {
        if (ws.onmessage) {
          ws.onmessage({ data: 'not json{' });
        }
      }).not.toThrow();
    });
  });
});
