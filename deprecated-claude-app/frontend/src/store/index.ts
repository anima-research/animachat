import { reactive, inject, InjectionKey, App } from 'vue';
import type { User, Conversation, Message, Model, OpenRouterModel, UserDefinedModel, CreateUserModel, UpdateUserModel, UserGrantSummary } from '@deprecated-claude/shared';
import { getValidatedModelDefaults } from '@deprecated-claude/shared';
import { api } from '../services/api';
import { WebSocketService } from '../services/websocket';

// Model availability info - which providers user can use
interface ModelAvailability {
  userProviders: string[];      // Providers where user has their own API key
  adminProviders: string[];     // Providers with admin-configured keys (subsidized)
  grantCurrencies: string[];    // Currencies where user has positive balance
  canOverspend: boolean;        // Whether user can use models without balance
  availableProviders: string[]; // Combined set of all usable providers
}

interface StoreState {
  user: User | null;
  conversations: Conversation[];
  currentConversation: Conversation | null;
  allMessages: Message[]; // Store all messages
  messagesVersion: number; // Increments when messages change, for reactivity
  models: Model[];
  openRouterModels: OpenRouterModel[];
  customModels: UserDefinedModel[];
  modelAvailability: ModelAvailability | null; // Which providers user can use
  isLoading: boolean;
  error: string | null;
  wsService: WebSocketService | null;
  lastMetricsUpdate: { conversationId: string; metrics: any } | null;
  grantSummary: UserGrantSummary | null;
  systemConfig: {
    features?: any;
    groupChatSuggestedModels?: string[];
    defaultModel?: string;
  } | null;
  // Detached branch mode - allows users to navigate branches independently
  isDetachedFromMainBranch: boolean;
  // Snapshot of shared activeBranchIds to restore when leaving detached mode
  sharedActiveBranchIds: Map<string, string>;
  // WebSocket connection state
  wsConnectionState: 'connected' | 'connecting' | 'disconnected' | 'reconnecting' | 'failed';
  // Branch activity notifications (ephemeral - not persisted)
  hiddenBranchActivities: Map<string, {
    messageId: string;
    branchId: string;
    content: string;
    participantId: string | null;
    role: 'user' | 'assistant' | 'system';
    model: string | null;
    createdAt: Date;
  }>;
  // Read tracking for unread notifications
  readBranchIds: Set<string>;  // Branches user has seen in current conversation
  unreadCounts: Map<string, number>;  // conversationId -> unread count for sidebar badges
  readPersistTimeout: ReturnType<typeof setTimeout> | null;  // Debounce timer for persisting reads
}

export interface Store {
  state: StoreState;
  
  // Getters
  isAuthenticated: boolean;
  currentModel: Model | null;
  messages: Message[]; // Computed property for visible messages
  token: string | null;
  lastMetricsUpdate: { conversationId: string; metrics: any } | null;
  
  // Actions
  loadUser(): Promise<void>;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, name: string, inviteCode?: string): Promise<{ requiresVerification?: boolean } | void>;
  logout(): void;
  
  loadConversations(): Promise<void>;
  loadConversation(id: string): Promise<void>;
  createConversation(model: string, title?: string, format?: 'standard' | 'prefill'): Promise<Conversation>;
  updateConversation(id: string, updates: Partial<Conversation>): Promise<void>;
  archiveConversation(id: string): Promise<void>;
  duplicateConversation(id: string): Promise<Conversation>;
  compactConversation(id: string): Promise<{ success: boolean; result: any; message: string }>;
  
  loadMessages(conversationId: string): Promise<void>;
  sendMessage(content: string, participantId?: string, responderId?: string, attachments?: Array<{ fileName: string; fileType: string; content: string; isImage?: boolean }>, explicitParentBranchId?: string, hiddenFromAi?: boolean, samplingBranches?: number): Promise<void>;
  continueGeneration(responderId?: string, explicitParentBranchId?: string, samplingBranches?: number): Promise<void>;
  regenerateMessage(messageId: string, branchId: string, parentBranchId?: string, samplingBranches?: number): Promise<void>;
  abortGeneration(): void;
  editMessage(messageId: string, branchId: string, content: string, responderId?: string, skipRegeneration?: boolean, samplingBranches?: number): Promise<void>;
  switchBranch(messageId: string, branchId: string): void;
  switchBranchesBatch(switches: Array<{ messageId: string; branchId: string }>): void;
  deleteMessage(messageId: string, branchId: string): Promise<void>;
  getVisibleMessages(): Message[];
  
  // Detached branch mode
  setDetachedMode(detached: boolean): void;

  // Read tracking
  markBranchesAsRead(branchIds: string[]): void;
  getUnreadCount(): number;  // Unread in current conversation
  fetchUnreadCounts(): Promise<void>;  // Load counts for all conversations

  loadModels(): Promise<void>;
  loadOpenRouterModels(): Promise<void>;
  loadCustomModels(): Promise<void>;
  createCustomModel(data: CreateUserModel): Promise<UserDefinedModel>;
  updateCustomModel(id: string, data: UpdateUserModel): Promise<UserDefinedModel>;
  deleteCustomModel(id: string): Promise<void>;
  testCustomModel(id: string): Promise<{ success: boolean; message?: string; error?: string; response?: string }>;
  loadSystemConfig(): Promise<void>;
  
  connectWebSocket(): void;
  disconnectWebSocket(): void;
}

const storeKey: InjectionKey<Store> = Symbol('store');

/**
 * Cache for sorted messages to avoid repeated topological sorts.
 * Invalidated when messages array changes.
 */
let sortedMessagesCache: {
  sourceArray: Message[] | null;
  sourceLength: number;
  sourceVersion: number;
  sorted: Message[];
} = {
  sourceArray: null,
  sourceLength: 0,
  sourceVersion: 0,
  sorted: []
};

// Version counter - increment this when messages change to invalidate cache
let messagesVersion = 0;

// Cache for visible messages to prevent recomputation on every access
let visibleMessagesCache: {
  sourceVersion: number;
  sourceLength: number;
  result: Message[];
} = {
  sourceVersion: 0,
  sourceLength: 0,
  result: []
};

/**
 * Invalidate the sorted messages cache.
 * Call this when messages are added, removed, or modified.
 */
function invalidateSortCache(): void {
  messagesVersion++;
}

/**
 * Topologically sort messages so parents come before children.
 * Uses caching to avoid repeated sorts when messages haven't changed.
 */
function sortMessagesByTreeOrder(messages: Message[]): Message[] {
  if (messages.length === 0) return [];
  
  // Check if cache is valid
  if (sortedMessagesCache.sourceArray === messages && 
      sortedMessagesCache.sourceLength === messages.length &&
      sortedMessagesCache.sourceVersion === messagesVersion) {
    return sortedMessagesCache.sorted;
  }
  
  // Build a map of branch ID -> message index
  const branchToMsgIndex = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    for (const branch of messages[i].branches) {
      branchToMsgIndex.set(branch.id, i);
    }
  }
  
  // Topological sort
  const sortedIndices: number[] = [];
  const visited = new Set<number>();
  const visiting = new Set<number>();
  
  function visit(msgIndex: number): void {
    if (visited.has(msgIndex)) return;
    if (visiting.has(msgIndex)) return; // Cycle detected, skip
    
    visiting.add(msgIndex);
    const msg = messages[msgIndex];
    
    // Visit all parents first
    for (const branch of msg.branches) {
      if (branch.parentBranchId && branch.parentBranchId !== 'root') {
        const parentMsgIndex = branchToMsgIndex.get(branch.parentBranchId);
        if (parentMsgIndex !== undefined && parentMsgIndex !== msgIndex) {
          visit(parentMsgIndex);
        }
      }
    }
    
    visiting.delete(msgIndex);
    visited.add(msgIndex);
    sortedIndices.push(msgIndex);
  }
  
  // Visit all messages
  for (let i = 0; i < messages.length; i++) {
    visit(i);
  }
  
  // Cache the result
  const sorted = sortedIndices.map(i => messages[i]);
  sortedMessagesCache = {
    sourceArray: messages,
    sourceLength: messages.length,
    sourceVersion: messagesVersion,
    sorted
  };
  
  return sorted;
}

export function createStore(): {
  install(app: App): void;
} {
  const state = reactive<StoreState>({
    user: null,
    conversations: [],
    currentConversation: null,
    allMessages: [], // Store all messages
    messagesVersion: 0, // For reactivity - increment when messages change
    models: [],
    openRouterModels: [],
    customModels: [],
    modelAvailability: null,
    isLoading: false,
    error: null,
    wsService: null,
    lastMetricsUpdate: null,
    grantSummary: null,
    systemConfig: null,
    // Detached branch mode
    isDetachedFromMainBranch: false,
    sharedActiveBranchIds: new Map(),
    // WebSocket connection state
    wsConnectionState: 'disconnected',
    // Branch activity notifications
    hiddenBranchActivities: new Map(),
    // Read tracking
    readBranchIds: new Set(),
    unreadCounts: new Map(),
    readPersistTimeout: null
  });

  const store: Store = {
    state,
    
    // Getters
    get isAuthenticated() {
      return !!state.user && !!localStorage.getItem('token');
    },
    
    get currentModel() {
      if (!state.currentConversation) return null;
      return state.models.find(m => m.id === state.currentConversation?.model) || null;
    },

    get messages() {
      // Read messagesVersion to create reactive dependency
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      state.messagesVersion;
      return this.getVisibleMessages();
    },
    
    get token() {
      return localStorage.getItem('token');
    },
    
    get lastMetricsUpdate() {
      return state.lastMetricsUpdate;
    },
    
    // User actions
    async loadUser() {
      try {
        const response = await api.get('/auth/me');
        state.user = response.data;
        
        // Also load grant summary for capability checks
        try {
          const grantsResponse = await api.get('/auth/grants');
          state.grantSummary = grantsResponse.data;
        } catch (grantsError) {
          console.error('Failed to load grants:', grantsError);
          // Don't fail user load if grants fail
        }
      } catch (error) {
        console.error('Failed to load user:', error);
        throw error;
      }
    },
    
    async login(email: string, password: string) {
      try {
        state.isLoading = true;
        const response = await api.post('/auth/login', { email, password });
        const { user, token } = response.data;
        
        localStorage.setItem('token', token);
        state.user = user;
        
        // Connect WebSocket after login
        this.connectWebSocket();
      } catch (error: any) {
        state.error = error.response?.data?.error || 'Login failed';
        throw error;
      } finally {
        state.isLoading = false;
      }
    },
    
    async register(
      email: string, 
      password: string, 
      name: string, 
      inviteCode?: string,
      tosAgreed?: boolean,
      ageVerified?: boolean
    ) {
      try {
        state.isLoading = true;
        const response = await api.post('/auth/register', { 
          email, 
          password, 
          name, 
          inviteCode,
          tosAgreed,
          ageVerified
        });
        const { user, token, requiresVerification } = response.data;
        
        // If email verification is required, return early without logging in
        if (requiresVerification) {
          return { requiresVerification: true };
        }
        
        localStorage.setItem('token', token);
        state.user = user;
        
        // Connect WebSocket after registration
        this.connectWebSocket();
        
        return {};
      } catch (error: any) {
        state.error = error.response?.data?.error || 'Registration failed';
        throw error;
      } finally {
        state.isLoading = false;
      }
    },
    
    logout() {
      localStorage.removeItem('token');
      state.user = null;
      state.conversations = [];
      state.currentConversation = null;
      state.messages = [];
      this.disconnectWebSocket();
    },
    
    // Conversation actions
    async loadConversations() {
      try {
        const response = await api.get('/conversations');
        state.conversations = response.data;
        // Fetch unread counts in parallel (don't block)
        this.fetchUnreadCounts();
      } catch (error) {
        console.error('Failed to load conversations:', error);
        throw error;
      }
    },
    
    async loadConversation(id: string, retryCount = 0) {
      const maxRetries = 3;
      const retryDelay = 1000;
      const startTime = Date.now();

      // Clear branch notifications when switching conversations
      state.hiddenBranchActivities.clear();
      // Note: Don't clear readBranchIds here - we'll set it atomically after loading
      // to avoid a flash of "all unread" while the new read state loads

      // Flush any pending read state persist and WAIT for it (don't just fire-and-forget)
      // This ensures the backend has the updated read state before we load the new conversation
      if (state.readPersistTimeout && state.currentConversation) {
        clearTimeout(state.readPersistTimeout);
        state.readPersistTimeout = null;
        const currentId = state.currentConversation.id;
        try {
          await api.post(`/conversations/${currentId}/mark-read`, {
            branchIds: Array.from(state.readBranchIds)
          });
        } catch (err) {
          console.warn('Failed to persist read state on switch:', err);
        }
      }

      try {
        console.log(`[loadConversation] Loading ${id}... (attempt ${retryCount + 1}/${maxRetries})`);
        console.log(`[loadConversation] API base URL: ${api.defaults.baseURL}`);
        
        const response = await api.get(`/conversations/${id}`);
        const fetchTime = Date.now() - startTime;
        console.log(`[loadConversation] Conversation data received in ${fetchTime}ms`);
        console.log(`[loadConversation] Response status: ${response.status}, has data: ${!!response.data}`);
        
        state.currentConversation = response.data;
        console.log(`[loadConversation] Set currentConversation, now loading messages and read state...`);

        // Load messages and read state in parallel to avoid flash of unread
        const [, uiStateResult] = await Promise.all([
          this.loadMessages(id),
          api.get(`/conversations/${id}/ui-state`).catch(err => {
            console.warn(`[loadConversation] Failed to load read state:`, err);
            return { data: { readBranchIds: [] } };
          })
        ]);

        // Set read state (do this before any tree rendering can happen)
        const readBranchIds = uiStateResult.data?.readBranchIds || [];
        state.readBranchIds = new Set(readBranchIds);
        console.log(`[loadConversation] Loaded ${readBranchIds.length} read branch IDs`);

        // Capture shared state BEFORE applying detached branches
        // This snapshot is used to restore when leaving detached mode
        state.sharedActiveBranchIds = new Map();
        for (const message of state.allMessages) {
          state.sharedActiveBranchIds.set(message.id, message.activeBranchId);
        }

        // Apply detached mode state BEFORE computing visible messages
        // In detached mode, apply user's saved branch selections directly to activeBranchId
        const isDetached = uiStateResult.data?.isDetached || false;
        const detachedBranches = uiStateResult.data?.detachedBranches || {};
        if (isDetached) {
          state.isDetachedFromMainBranch = true;
          for (const [messageId, branchId] of Object.entries(detachedBranches)) {
            const message = state.allMessages.find(m => m.id === messageId);
            if (message) {
              message.activeBranchId = branchId as string;
            }
          }
          // Invalidate cache so getVisibleMessages() uses the updated activeBranchIds
          state.messagesVersion++;
          invalidateSortCache();
        }

        // Mark current visible path as read
        const visibleBranchIds = this.getVisibleMessages().map(m => m.activeBranchId);
        this.markBranchesAsRead(visibleBranchIds);

        // STUBBED: Unread count calculation disabled pending architecture review
        // See .workshop/proposal-realtime-notifications.md
        // The local calculation has migration issues (everything shows as unread for existing users)
        // Will be re-enabled when backend provides proper unread tracking

        const totalTime = Date.now() - startTime;
        console.log(`[loadConversation] ✓ Successfully loaded conversation ${id} in ${totalTime}ms`);
      } catch (error: any) {
        const elapsed = Date.now() - startTime;
        console.error(`[loadConversation] ✗ Failed after ${elapsed}ms (attempt ${retryCount + 1}/${maxRetries})`);
        console.error(`[loadConversation] Error code: ${error?.code}`);
        console.error(`[loadConversation] Error message: ${error?.message}`);
        console.error(`[loadConversation] Error response status: ${error?.response?.status}`);
        console.error(`[loadConversation] Error response data:`, error?.response?.data);
        console.error(`[loadConversation] Full error:`, error);
        
        // Retry on network errors
        if (retryCount < maxRetries - 1 && (
          error?.code === 'ERR_NETWORK' || 
          error?.code === 'ECONNABORTED' ||
          error?.message?.includes('timeout') ||
          error?.message?.includes('Network Error')
        )) {
          const delay = retryDelay * (retryCount + 1);
          console.log(`[loadConversation] Will retry in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.loadConversation(id, retryCount + 1);
        }
        
        console.error(`[loadConversation] No more retries, giving up`);
        throw error;
      }
    },
    
    async createConversation(model: string, title?: string, format: 'standard' | 'prefill' = 'standard') {
      try {
        // Look up model to get validated defaults
        const modelObj = state.models.find(m => m.id === model);
        const settings = modelObj 
          ? getValidatedModelDefaults(modelObj)
          : { temperature: 1.0, maxTokens: 4096 }; // Fallback for unknown models
        
        const response = await api.post('/conversations', {
          model,
          title: title || 'New Conversation',
          format,
          settings
        });
        
        const conversation = response.data;
        state.conversations.unshift(conversation);
        state.currentConversation = conversation;
        state.allMessages = [];
        state.messagesVersion++;
        invalidateSortCache();
        
        return conversation;
      } catch (error) {
        console.error('Failed to create conversation:', error);
        throw error;
      }
    },
    
    async updateConversation(id: string, updates: Partial<Conversation>) {
      try {
        console.log('[Store] Updating conversation:', id, 'with updates:', updates);
        const response = await api.patch(`/conversations/${id}`, updates);
        const updated = response.data;
        console.log('[Store] API response:', response);
        console.log('[Store] Updated conversation:', updated);
        console.log('[Store] New settings:', JSON.stringify(updated?.settings, null, 2));
        
        // Update in list
        const index = state.conversations.findIndex(c => c.id === id);
        if (index !== -1) {
          state.conversations[index] = updated;
        }
        
        // Update current if it's the same
        if (state.currentConversation?.id === id) {
          state.currentConversation = updated;
        }
      } catch (error) {
        console.error('Failed to update conversation:', error);
        throw error;
      }
    },
    
    async archiveConversation(id: string) {
      try {
        await api.post(`/conversations/${id}/archive`);
        
        // Remove from list
        state.conversations = state.conversations.filter(c => c.id !== id);
        
        // Clear current if it's the same
        if (state.currentConversation?.id === id) {
          state.currentConversation = null;
          state.allMessages = [];
          state.messagesVersion++;
          invalidateSortCache();
        }
      } catch (error) {
        console.error('Failed to archive conversation:', error);
        throw error;
      }
    },
    
    async duplicateConversation(id: string) {
      try {
        const response = await api.post(`/conversations/${id}/duplicate`);
        const duplicate = response.data;
        
        state.conversations.unshift(duplicate);
        return duplicate;
      } catch (error) {
        console.error('Failed to duplicate conversation:', error);
        throw error;
      }
    },
    
    async compactConversation(id: string) {
      try {
        const response = await api.post(`/conversations/${id}/compact`, {
          stripDebugData: true,
          moveDebugToBlobs: false, // Just strip for now, faster
        });
        return response.data;
      } catch (error) {
        console.error('Failed to compact conversation:', error);
        throw error;
      }
    },
    
    // Message actions
    async loadMessages(conversationId: string, retryCount = 0) {
      const maxRetries = 3;
      const retryDelay = 1000;
      const startTime = Date.now();
      
      try {
        console.log(`[loadMessages] Loading messages for ${conversationId}... (attempt ${retryCount + 1}/${maxRetries})`);
        
        const response = await api.get(`/conversations/${conversationId}/messages`);
        const fetchTime = Date.now() - startTime;
        
        console.log(`[loadMessages] Response received in ${fetchTime}ms`);
        console.log(`[loadMessages] Response status: ${response.status}`);
        console.log(`[loadMessages] Response data is array: ${Array.isArray(response.data)}, length: ${response.data?.length || 0}`);
        
        if (!response.data) {
          console.warn(`[loadMessages] ⚠ Response data is null/undefined!`);
        }
        
        state.allMessages = response.data || [];
        state.messagesVersion++;
        invalidateSortCache();
        
        console.log(`[loadMessages] ✓ Loaded ${state.allMessages.length} messages, messagesVersion: ${state.messagesVersion}`);
        
        // Log branch info for debugging
        const totalBranches = state.allMessages.reduce((acc, m) => acc + (m.branches?.length || 0), 0);
        console.log(`[loadMessages] Total branches across all messages: ${totalBranches}`);
        
        // Log if this is multi-participant
        if (state.currentConversation?.format !== 'standard') {
          console.log(`[loadMessages] Multi-participant conversation format: ${state.currentConversation?.format}`);
        }
      } catch (error: any) {
        const elapsed = Date.now() - startTime;
        console.error(`[loadMessages] ✗ Failed after ${elapsed}ms (attempt ${retryCount + 1}/${maxRetries})`);
        console.error(`[loadMessages] Error code: ${error?.code}`);
        console.error(`[loadMessages] Error message: ${error?.message}`);
        console.error(`[loadMessages] Error response status: ${error?.response?.status}`);
        console.error(`[loadMessages] Error response data:`, error?.response?.data);
        console.error(`[loadMessages] Full error:`, error);
        
        // Retry on network errors or timeouts
        if (retryCount < maxRetries - 1 && (
          error?.code === 'ERR_NETWORK' || 
          error?.code === 'ECONNABORTED' ||
          error?.message?.includes('timeout') ||
          error?.message?.includes('Network Error')
        )) {
          const delay = retryDelay * (retryCount + 1);
          console.log(`[loadMessages] Will retry in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.loadMessages(conversationId, retryCount + 1);
        }
        
        console.error(`[loadMessages] No more retries, giving up`);
        throw error;
      }
    },
    
    async sendMessage(content: string, participantId?: string, responderId?: string, attachments?: Array<{ fileName: string; fileType: string; content: string; isImage?: boolean }>, explicitParentBranchId?: string, hiddenFromAi?: boolean, samplingBranches?: number) {
      if (!state.currentConversation || !state.wsService) return;
      
      let parentBranchId: string | undefined;
      
      if (explicitParentBranchId) {
        // User has selected a specific branch to branch from
        parentBranchId = explicitParentBranchId;
        console.log('Using explicit parent branch:', parentBranchId);
      } else {
        // Default behavior: get the last visible message to determine the parent branch
        const visibleMessages = this.messages;
        
        if (visibleMessages.length > 0) {
          const lastMessage = visibleMessages[visibleMessages.length - 1];
          const activeBranch = lastMessage.branches.find(b => b.id === lastMessage.activeBranchId);
          parentBranchId = activeBranch?.id;
        }
      }
      
      const messageData = {
        type: 'chat' as const,
        conversationId: state.currentConversation.id,
        messageId: crypto.randomUUID(),
        content,
        parentBranchId,
        participantId,
        responderId,
        attachments,
        hiddenFromAi, // If true, message is visible to humans but excluded from AI context
        samplingBranches: samplingBranches && samplingBranches > 1 ? samplingBranches : undefined
      };
      
      console.log('Sending message with attachments:', attachments?.length || 0);
      // if (attachments && attachments.length > 0) {
      //   console.log('Attachment details:', attachments.map(a => ({ fileName: a.fileName, size: a.content?.length })));
      // }
      
      state.wsService.sendMessage(messageData);
      
      // Update the conversation's updatedAt timestamp locally for immediate sorting
      const conv = state.conversations.find(c => c.id === state.currentConversation!.id);
      if (conv) {
        conv.updatedAt = new Date();
        console.log(`[Store] Updated conversation ${conv.id} timestamp for sorting`);
      }
    },
    
    async continueGeneration(responderId?: string, explicitParentBranchId?: string, samplingBranches?: number) {
      if (!state.currentConversation || !state.wsService) return;
      
      let parentBranchId: string | undefined;
      
      if (explicitParentBranchId) {
        // User has selected a specific branch to continue from
        parentBranchId = explicitParentBranchId;
        console.log('Using explicit parent branch for continue:', parentBranchId);
      } else {
        // Default behavior: get the last visible message to determine the parent branch
        const visibleMessages = this.messages;
        
        if (visibleMessages.length > 0) {
          const lastMessage = visibleMessages[visibleMessages.length - 1];
          const activeBranch = lastMessage.branches.find(b => b.id === lastMessage.activeBranchId);
          parentBranchId = activeBranch?.id;
        }
      }
      
      state.wsService.sendMessage({
        type: 'continue',
        conversationId: state.currentConversation.id,
        messageId: crypto.randomUUID(),
        parentBranchId,
        responderId,
        samplingBranches: samplingBranches && samplingBranches > 1 ? samplingBranches : undefined
      } as any);
      
      // Update the conversation's updatedAt timestamp locally for immediate sorting
      const conv = state.conversations.find(c => c.id === state.currentConversation!.id);
      if (conv) {
        conv.updatedAt = new Date();
        console.log(`[Store] Updated conversation ${conv.id} timestamp for continue generation`);
      }
    },
    
    async regenerateMessage(messageId: string, branchId: string, parentBranchId?: string, samplingBranches?: number) {
      if (!state.currentConversation || !state.wsService) return;
      
      state.wsService.sendMessage({
        type: 'regenerate',
        conversationId: state.currentConversation.id,
        messageId,
        branchId,
        parentBranchId, // Current visible parent, for correct branch parenting after switches
        samplingBranches // Number of parallel response branches to generate
      });
      
      // Update the conversation's updatedAt timestamp locally for immediate sorting
      const conv = state.conversations.find(c => c.id === state.currentConversation!.id);
      if (conv) {
        conv.updatedAt = new Date();
      }
    },
    
    abortGeneration() {
      if (!state.currentConversation || !state.wsService) return;
      
      state.wsService.sendMessage({
        type: 'abort',
        conversationId: state.currentConversation.id
      });
    },
    
    async editMessage(messageId: string, branchId: string, content: string, responderId?: string, skipRegeneration?: boolean, samplingBranches?: number) {
      if (!state.currentConversation || !state.wsService) return;
      
      state.wsService.sendMessage({
        type: 'edit' as const,
        conversationId: state.currentConversation.id,
        messageId,
        branchId,
        content,
        responderId, // Pass the currently selected responder
        skipRegeneration, // If true, don't generate AI response after edit
        samplingBranches // Number of parallel response branches to generate
      } as any);
      
      // Update the conversation's updatedAt timestamp locally for immediate sorting
      const conv = state.conversations.find(c => c.id === state.currentConversation!.id);
      if (conv) {
        conv.updatedAt = new Date();
      }
    },
    
        switchBranch(messageId: string, branchId: string) {
      const message = state.allMessages.find(m => m.id === messageId);
      if (!message) {
        console.error('switchBranch: Message not found:', messageId);
        return;
      }

      // Skip if already on this branch
      if (message.activeBranchId === branchId) {
        return;
      }

      // Update activeBranchId locally
      message.activeBranchId = branchId;

      // Persist to appropriate endpoint based on mode
      if (state.currentConversation) {
        if (state.isDetachedFromMainBranch) {
          api.patch(`/conversations/${state.currentConversation.id}/ui-state`, {
            detachedBranch: { messageId, branchId }
          }).catch(error => {
            console.error('Failed to persist detached branch:', error);
          });
        } else {
          api.post(`/conversations/${state.currentConversation.id}/set-active-branch`, {
            messageId,
            branchId
          }).catch(error => {
            console.error('Failed to persist branch switch:', error);
          });
        }
      }

      // Sort messages by tree order to handle out-of-order children
      const sortedMessages = sortMessagesByTreeOrder(state.allMessages);
      const sortedMessageIndex = sortedMessages.findIndex(m => m.id === messageId);

      // Build path up to and including the switched message
      const branchPath: string[] = [];
      for (let i = 0; i <= sortedMessageIndex; i++) {
        const msg = sortedMessages[i];
        const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId);
        if (activeBranch) {
          branchPath.push(activeBranch.id);
        }
      }

      // Update subsequent messages to follow the correct path
      for (let i = sortedMessageIndex + 1; i < sortedMessages.length; i++) {
        const msg = sortedMessages[i];

        // Find which branch of this message continues from our path
        for (const branch of msg.branches) {
          if (branch.parentBranchId && branchPath.includes(branch.parentBranchId)) {
            if (msg.activeBranchId !== branch.id) {
              msg.activeBranchId = branch.id;

              // Persist cascade to appropriate endpoint
              if (state.currentConversation) {
                if (state.isDetachedFromMainBranch) {
                  api.patch(`/conversations/${state.currentConversation.id}/ui-state`, {
                    detachedBranch: { messageId: msg.id, branchId: branch.id }
                  }).catch(error => {
                    console.error('Failed to persist downstream detached branch:', error);
                  });
                } else {
                  api.post(`/conversations/${state.currentConversation.id}/set-active-branch`, {
                    messageId: msg.id,
                    branchId: branch.id
                  }).catch(error => {
                    console.error('Failed to persist downstream branch switch:', error);
                  });
                }
              }
            }

            // Add this branch to the path for checking further messages
            const parentIndex = branchPath.indexOf(branch.parentBranchId);
            branchPath.length = parentIndex + 1;
            branchPath.push(branch.id);
            break;
          }
        }
      }

      // Invalidate cache and force recompute visible messages after branch switch
      state.messagesVersion++;
      invalidateSortCache();
      const newVisible = this.getVisibleMessages();

      // Clear notifications for now-visible branches and mark them as read
      const newVisibleBranchIds = Array.from(
        new Set(newVisible.map(m => m.activeBranchId))
      );
      for (const branchId of state.hiddenBranchActivities.keys()) {
        if (newVisibleBranchIds.includes(branchId)) {
          state.hiddenBranchActivities.delete(branchId);
        }
      }
      this.markBranchesAsRead(newVisibleBranchIds);
    },

    // Batch switch multiple branches at once - much faster for tree navigation
    // Does all the expensive work once instead of per-branch
    switchBranchesBatch(switches: Array<{ messageId: string; branchId: string }>) {
      if (switches.length === 0) return;

      // Apply all local state changes first
      const changedMessages = new Map<string, string>(); // messageId -> branchId
      for (const { messageId, branchId } of switches) {
        const message = state.allMessages.find(m => m.id === messageId);
        if (!message) continue;

        if (message.activeBranchId !== branchId) {
          message.activeBranchId = branchId;
          changedMessages.set(messageId, branchId);
        }
      }

      if (changedMessages.size === 0) {
        return;
      }

      // Build the branch path by following parentBranchId from the deepest switch
      const sortedMessages = sortMessagesByTreeOrder(state.allMessages);

      // Find the deepest switch (furthest from root in the tree)
      let deepestSwitchBranchId: string | null = null;
      let deepestIndex = -1;

      for (const { messageId, branchId } of switches) {
        const idx = sortedMessages.findIndex(m => m.id === messageId);
        if (idx > deepestIndex) {
          deepestIndex = idx;
          deepestSwitchBranchId = branchId;
        }
      }

      if (!deepestSwitchBranchId) {
        console.warn('No valid switch found');
        return;
      }

      // Build the branch path by tracing from deepest switch back to root
      const branchPath: string[] = [];
      let currentBranchId: string | null = deepestSwitchBranchId;

      while (currentBranchId && currentBranchId !== 'root') {
        branchPath.unshift(currentBranchId);
        const msg = state.allMessages.find(m => m.branches.some(b => b.id === currentBranchId));
        if (!msg) break;
        const branch = msg.branches.find(b => b.id === currentBranchId);
        currentBranchId = branch?.parentBranchId || null;
      }

      // Update all messages to follow this path
      for (const msg of sortedMessages) {
        for (const branch of msg.branches) {
          const parentInPath = branch.parentBranchId === 'root' || branchPath.includes(branch.parentBranchId!);
          const branchInPath = branchPath.includes(branch.id);

          if (parentInPath && branchInPath && msg.activeBranchId !== branch.id) {
            msg.activeBranchId = branch.id;
            changedMessages.set(msg.id, branch.id);
            break;
          }
        }
      }

      // Persist to appropriate endpoint based on mode
      if (state.currentConversation) {
        for (const [msgId, branchId] of changedMessages) {
          if (state.isDetachedFromMainBranch) {
            api.patch(`/conversations/${state.currentConversation.id}/ui-state`, {
              detachedBranch: { messageId: msgId, branchId }
            }).catch(error => {
              console.error('Failed to persist detached branch:', error);
            });
          } else {
            api.post(`/conversations/${state.currentConversation.id}/set-active-branch`, {
              messageId: msgId,
              branchId
            }).catch(error => {
              console.error('Failed to persist branch switch:', error);
            });
          }
        }
      }

      // Invalidate cache and recompute
      state.messagesVersion++;
      invalidateSortCache();
      const newVisible = this.getVisibleMessages();

      // Clear notifications for now-visible branches and mark them as read
      const newVisibleBranchIds = Array.from(
        new Set(newVisible.map(m => m.activeBranchId))
      );
      for (const branchId of state.hiddenBranchActivities.keys()) {
        if (newVisibleBranchIds.includes(branchId)) {
          state.hiddenBranchActivities.delete(branchId);
        }
      }
      this.markBranchesAsRead(newVisibleBranchIds);
    },

    async deleteMessage(messageId: string, branchId: string) {
      if (!state.currentConversation || !state.wsService) return;
      
      state.wsService.sendMessage({
        type: 'delete',
        conversationId: state.currentConversation.id,
        messageId,
        branchId
      });
    },

    // Helper method to get visible messages based on current branch selections
    getVisibleMessages(): Message[] {
      // Check cache first to avoid expensive recomputation
      if (visibleMessagesCache.sourceVersion === messagesVersion &&
          visibleMessagesCache.sourceLength === state.allMessages.length) {
        return visibleMessagesCache.result;
      }
      
      // Sort messages by tree order to ensure parents come before children
      // This handles cases where order numbers don't reflect tree structure
      const sortedMessages = sortMessagesByTreeOrder(state.allMessages);
      
      // For multi-root conversations (from looming/branching), find the canonical root
      // Canonical root is the one whose subtree has the most recent activity
      const rootMessages = sortedMessages.filter(msg => {
        const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId);
        return activeBranch && (!activeBranch.parentBranchId || activeBranch.parentBranchId === 'root');
      });
      
      let canonicalRootId: string | null = null;
      if (rootMessages.length > 1) {
        // Multiple roots - pick the one with most recent activity in its subtree
        // Build parent->children map
        const parentToChildren = new Map<string, Message[]>();
        for (const msg of sortedMessages) {
          for (const branch of msg.branches) {
            const parentId = branch.parentBranchId || 'root';
            if (!parentToChildren.has(parentId)) {
              parentToChildren.set(parentId, []);
            }
            parentToChildren.get(parentId)!.push(msg);
          }
        }
        
        // Find latest timestamp in each root's subtree
        let latestTime = 0;
        for (const root of rootMessages) {
          const rootTime = findLatestInSubtree(root, parentToChildren);
          if (rootTime > latestTime) {
            latestTime = rootTime;
            canonicalRootId = root.id;
          }
        }
        console.log(`[getVisibleMessages] Multiple roots (${rootMessages.length}), canonical root: ${canonicalRootId?.slice(0, 8)}`);
      } else if (rootMessages.length === 1) {
        canonicalRootId = rootMessages[0].id;
      }
      
      // Helper function to find latest timestamp in a subtree
      function findLatestInSubtree(root: Message, parentToChildren: Map<string, Message[]>): number {
        let latest = 0;
        const visited = new Set<string>();
        
        function visit(msg: Message) {
          if (visited.has(msg.id)) return;
          visited.add(msg.id);
          
          for (const branch of msg.branches) {
            if (branch.createdAt) {
              const time = new Date(branch.createdAt).getTime();
              if (time > latest) latest = time;
            }
            // Visit children of this branch
            const children = parentToChildren.get(branch.id) || [];
            for (const child of children) visit(child);
          }
        }
        
        visit(root);
        return latest;
      }
      
      const visibleMessages: Message[] = [];
      const branchPath: string[] = []; // Track the current conversation path (branch IDs)
      
      for (let i = 0; i < sortedMessages.length; i++) {
        const message = sortedMessages[i];
        const activeBranch = message.branches.find(b => b.id === message.activeBranchId);
        
        // console.log(`Message ${i}:`, message.id, 'activeBranchId:', message.activeBranchId, 
        //             'branches:', message.branches.length, 
        //             'activeBranch parentBranchId:', activeBranch?.parentBranchId);
        
        // Case 1: Active branch exists and is a root message
        // Only accept the canonical root - skip others (handles multi-root conversations from looming)
        if (activeBranch && (!activeBranch.parentBranchId || activeBranch.parentBranchId === 'root')) {
          // Only accept if this is the canonical root (or if no canonical was determined)
          if (branchPath.length === 0 && (!canonicalRootId || message.id === canonicalRootId)) {
            visibleMessages.push(message);
            branchPath.push(activeBranch.id);
            // console.log('Added canonical root message:', message.id);
          }
          // Skip other roots - they're from different conversation branches
          continue;
        }

        // Case 2: Active branch exists and continues from our current path
        if (activeBranch && branchPath.includes(activeBranch.parentBranchId!)) {
          // This message is a valid continuation
          visibleMessages.push(message);
          
          // Find where in the path this branches from
          const parentIndex = branchPath.indexOf(activeBranch.parentBranchId!);
          
          // Truncate the path after the parent and add this branch
          branchPath.length = parentIndex + 1;
          branchPath.push(activeBranch.id);
          
          // console.log('Message continues from branch at index', parentIndex, 'added branch:', activeBranch.id, 'branchPath now:', [...branchPath]);
          continue;
        }

        // Case 3: Active branch doesn't exist or doesn't connect to our path
        // Be strict: skip this message. Don't try to recover via other branches,
        // as that can accidentally include orphaned/deleted branches from other roots.
        // (This mirrors the import preview logic which is strict about following activeBranchId only)
        if (!activeBranch) {
          console.log('Skipping message with deleted active branch:', message.id);
        }
        // Message is from a different conversation path - skip it
      }
      
      // Update cache before returning
      visibleMessagesCache = {
        sourceVersion: messagesVersion,
        sourceLength: state.allMessages.length,
        result: visibleMessages
      };
      
      console.log('[getVisibleMessages] Cache miss - computed', visibleMessages.length, 'visible from', state.allMessages.length, 'total');
      return visibleMessages;
    },

    // Read tracking methods
    markBranchesAsRead(branchIds: string[]) {
      if (branchIds.length === 0) return;

      // Check if any are new
      let changed = false;
      for (const id of branchIds) {
        if (!state.readBranchIds.has(id)) {
          changed = true;
          break;
        }
      }

      if (!changed || !state.currentConversation) return;

      // Create a new Set to trigger Vue reactivity (mutating Set doesn't trigger watchers)
      const newSet = new Set(state.readBranchIds);
      for (const id of branchIds) {
        newSet.add(id);
      }
      state.readBranchIds = newSet;

      // STUBBED: Unread count update disabled pending architecture review
      // See .workshop/proposal-realtime-notifications.md

      // Debounced persist to backend (don't call on every switch)
      if (state.readPersistTimeout) {
        clearTimeout(state.readPersistTimeout);
      }
      state.readPersistTimeout = setTimeout(async () => {
        try {
          await api.post(`/conversations/${conversationId}/mark-read`, {
            branchIds: Array.from(state.readBranchIds)
          });
        } catch (err) {
          console.warn('Failed to persist read state:', err);
        }
        state.readPersistTimeout = null;
      }, 2000); // 2 second debounce
    },

    // STUBBED: Unread count disabled pending architecture review
    getUnreadCount(): number {
      return 0;
    },

    async fetchUnreadCounts() {
      try {
        const response = await api.get('/conversations/unread-counts');
        state.unreadCounts = new Map(Object.entries(response.data));
        console.log(`[fetchUnreadCounts] Loaded counts for ${state.unreadCounts.size} conversations`);
      } catch (err) {
        console.warn('Failed to fetch unread counts:', err);
      }
    },

    // Detached branch mode
    setDetachedMode(detached: boolean) {
      if (detached && !state.isDetachedFromMainBranch) {
        // Entering detached mode: capture shared state snapshot
        state.sharedActiveBranchIds = new Map();
        for (const message of state.allMessages) {
          state.sharedActiveBranchIds.set(message.id, message.activeBranchId);
        }
        console.log('[Store] Captured shared state before detaching:', state.sharedActiveBranchIds.size, 'branches');
      } else if (!detached && state.isDetachedFromMainBranch) {
        // Leaving detached mode: restore shared state
        for (const [messageId, branchId] of state.sharedActiveBranchIds) {
          const message = state.allMessages.find(m => m.id === messageId);
          if (message && message.activeBranchId !== branchId) {
            message.activeBranchId = branchId;
          }
        }
        console.log('[Store] Restored shared state after re-attaching:', state.sharedActiveBranchIds.size, 'branches');
      }

      state.isDetachedFromMainBranch = detached;
      state.messagesVersion++;
      invalidateSortCache();
      console.log('[Store] Detached mode:', detached);
    },
    
    // Model actions
    async loadModels() {
      try {
        // Fetch models and availability in parallel
        const [modelsResponse, availabilityResponse] = await Promise.all([
          api.get('/models'),
          api.get('/models/availability').catch(() => ({ data: null }))
        ]);
        
        state.models = modelsResponse.data;
        state.modelAvailability = availabilityResponse.data;
        
        // console.log('Frontend loaded models:', state.models.map(m => ({
        //   id: m.id,
        //   name: m.name,
        //   displayName: m.displayName,
        //   provider: m.provider
        // })));
        // console.log('Model availability:', state.modelAvailability);
      } catch (error) {
        console.error('Failed to load models:', error);
        throw error;
      }
    },
    
    async loadOpenRouterModels() {
      try {
        const response = await api.get('/models/openrouter/available');
        state.openRouterModels = response.data.models || [];
        console.log(`Loaded ${state.openRouterModels.length} OpenRouter models ${response.data.cached ? '(cached)' : '(fresh)'}`);
      } catch (error) {
        console.error('Failed to load OpenRouter models:', error);
        // Don't throw - this is not critical
        state.openRouterModels = [];
      }
    },
    
    async loadCustomModels() {
      try {
        const response = await api.get('/models/custom');
        state.customModels = response.data;
        console.log(`Loaded ${state.customModels.length} custom models`);
      } catch (error) {
        console.error('Failed to load custom models:', error);
        state.customModels = [];
      }
    },
    
    async createCustomModel(data: CreateUserModel): Promise<UserDefinedModel> {
      try {
        const response = await api.post('/models/custom', data);
        const newModel = response.data;
        state.customModels.push(newModel);
        
        // Reload all models to include the new custom model
        await store.loadModels();
        
        return newModel;
      } catch (error: any) {
        console.error('Failed to create custom model:', error);
        throw new Error(error.response?.data?.error || 'Failed to create custom model');
      }
    },
    
    async updateCustomModel(id: string, data: UpdateUserModel): Promise<UserDefinedModel> {
      try {
        const response = await api.patch(`/models/custom/${id}`, data);
        const updatedModel = response.data;
        
        const index = state.customModels.findIndex(m => m.id === id);
        if (index !== -1) {
          state.customModels[index] = updatedModel;
        }
        
        // Reload all models to update the merged list
        await store.loadModels();
        
        return updatedModel;
      } catch (error: any) {
        console.error('Failed to update custom model:', error);
        throw new Error(error.response?.data?.error || 'Failed to update custom model');
      }
    },
    
    async deleteCustomModel(id: string): Promise<void> {
      try {
        await api.delete(`/models/custom/${id}`);
        
        const index = state.customModels.findIndex(m => m.id === id);
        if (index !== -1) {
          state.customModels.splice(index, 1);
        }
        
        // Reload all models to update the merged list
        await store.loadModels();
      } catch (error: any) {
        console.error('Failed to delete custom model:', error);
        throw new Error(error.response?.data?.error || 'Failed to delete custom model');
      }
    },
    
    async testCustomModel(id: string): Promise<{ success: boolean; message?: string; error?: string; response?: string }> {
      try {
        const response = await api.post(`/models/custom/${id}/test`);
        return response.data;
      } catch (error: any) {
        console.error('Failed to test custom model:', error);
        return {
          success: false,
          error: error.response?.data?.error || error.message || 'Failed to test model'
        };
      }
    },
    
    // System config actions
    async loadSystemConfig() {
      try {
        const response = await api.get('/system/config');
        state.systemConfig = response.data;
      } catch (error) {
        console.error('Failed to load system config:', error);
        // Don't throw, just use defaults
        state.systemConfig = {
          features: {},
          groupChatSuggestedModels: [],
          defaultModel: 'claude-3-5-sonnet-20241022'
        };
      }
    },
    
    // WebSocket actions
    connectWebSocket() {
      console.log(`[Store] connectWebSocket called`);
      const token = localStorage.getItem('token');
      if (!token) {
        console.warn(`[Store] No token found, skipping WebSocket connection`);
        return;
      }
      
      console.log(`[Store] Creating WebSocketService...`);
      state.wsService = new WebSocketService(token);
      console.log(`[Store] WebSocketService created, setting up handlers...`);
      
      // Track connection state
      state.wsService.on('connection_state', (data: any) => {
        console.log(`[Store] WebSocket connection state: ${data.state}`);
        state.wsConnectionState = data.state;
      });
      state.wsConnectionState = 'connecting';
      
      state.wsService.on('message_created', (data: any) => {
        // console.log('Store handling message_created:', data);
        // Check if this message already exists (branch was added to existing message)
        const existingIndex = state.allMessages.findIndex(m => m.id === data.message.id);
        if (existingIndex !== -1) {
          // Update existing message (new branch was added)
          state.allMessages[existingIndex] = data.message;
        } else {
          // Add new message
          state.allMessages.push(data.message);
        }
        state.messagesVersion++;
        invalidateSortCache();

        // Check if this message is hidden from current view (for branch notifications)
        const newBranch = data.message.branches[data.message.branches.length - 1];
        if (newBranch && newBranch.role !== 'system') {
          // Get current visible branch path
          const visibleMessages = store.getVisibleMessages();
          const visibleBranchIds = new Set<string>();
          for (const msg of visibleMessages) {
            visibleBranchIds.add(msg.activeBranchId);
          }

          // Check if the new branch's parent is NOT in our visible path
          const parentBranchId = newBranch.parentBranchId;
          const isHidden = parentBranchId &&
                          parentBranchId !== 'root' &&
                          !visibleBranchIds.has(parentBranchId);

          if (isHidden) {
            state.hiddenBranchActivities.set(newBranch.id, {
              messageId: data.message.id,
              branchId: newBranch.id,
              content: (newBranch.content || '').slice(0, 100),
              participantId: newBranch.participantId || null,
              role: newBranch.role,
              model: newBranch.model || null,
              createdAt: new Date(newBranch.createdAt || Date.now())
            });
          } else {
            // Branch is visible (user is watching it stream) - mark as read immediately
            store.markBranchesAsRead([newBranch.id]);
          }
        }
      });

      state.wsService.on('stream', (data: any) => {
        // console.log('Store handling stream:', data);
        const message = state.allMessages.find(m => m.id === data.messageId);
        if (message) {
          const branch = message.branches.find(b => b.id === data.branchId);
          if (branch) {
            branch.content += data.content;
            // Update content blocks if provided
            if (data.contentBlocks) {
              branch.contentBlocks = data.contentBlocks;
              // Force Vue reactivity for contentBlocks updates (especially during thinking)
              // Without this, empty content chunks with only contentBlocks won't trigger re-renders
              state.messagesVersion++;
            }

            // Update notification preview if this is a hidden branch
            const notification = state.hiddenBranchActivities.get(data.branchId);
            if (notification) {
              notification.content = (branch.content || '').slice(0, 100);
            }
          }
        }
      });
      
      state.wsService.on('metrics_update', (data: any) => {
        // console.log('Store handling metrics_update:', data);
        state.lastMetricsUpdate = {
          conversationId: data.conversationId,
          metrics: data.metrics
        };
      });
      
      state.wsService.on('message_edited', (data: any) => {
        // Simply accept the server's message including its activeBranchId
        // The server handles preserveActiveBranch logic for parallel generation
        const index = state.allMessages.findIndex(m => m.id === data.message.id);
        if (index !== -1) {
          // Check for new branches before updating (for notifications)
          const oldMessage = state.allMessages[index];
          const oldBranchIds = new Set(oldMessage.branches.map(b => b.id));
          const newBranches = data.message.branches.filter((b: any) => !oldBranchIds.has(b.id));

          state.allMessages[index] = data.message;
          state.messagesVersion++;
          invalidateSortCache();

          // Check if any new branches are hidden from current view (for notifications)
          for (const newBranch of newBranches) {
            if (newBranch.role === 'system') continue;

            // Get current visible branch path
            const visibleMessages = store.getVisibleMessages();
            const visibleBranchIds = new Set<string>();
            for (const msg of visibleMessages) {
              visibleBranchIds.add(msg.activeBranchId);
            }

            // Check if the new branch's parent is NOT in our visible path
            const parentBranchId = newBranch.parentBranchId;
            const isHidden = parentBranchId &&
                            parentBranchId !== 'root' &&
                            !visibleBranchIds.has(parentBranchId);

            if (isHidden) {
              state.hiddenBranchActivities.set(newBranch.id, {
                messageId: data.message.id,
                branchId: newBranch.id,
                content: (newBranch.content || '').slice(0, 100),
                participantId: newBranch.participantId || null,
                role: newBranch.role,
                model: newBranch.model || null,
                createdAt: new Date(newBranch.createdAt || Date.now())
              });
            } else {
              // Branch is visible (user is watching it) - mark as read immediately
              store.markBranchesAsRead([newBranch.id]);
            }
          }
        }
      });

      state.wsService.on('message_deleted', (data: any) => {
        // console.log('Store handling message_deleted:', data);
        const { messageId, branchId, deletedMessages } = data;
        
        // If multiple messages were deleted (cascade delete)
        if (deletedMessages && deletedMessages.length > 0) {
          state.allMessages = state.allMessages.filter(m => !deletedMessages.includes(m.id));
          state.messagesVersion++;
          invalidateSortCache();
        } else {
          // Single branch deletion
          const index = state.allMessages.findIndex(m => m.id === messageId);
          if (index !== -1) {
            const message = state.allMessages[index];
            if (message.branches.length > 1) {
              // Remove the branch
              const updatedBranches = message.branches.filter(b => b.id !== branchId);
              state.allMessages[index] = {
                ...message,
                branches: updatedBranches,
                activeBranchId: message.activeBranchId === branchId ? updatedBranches[0].id : message.activeBranchId
              };
            } else {
              // Remove the entire message
              state.allMessages.splice(index, 1);
            }
            state.messagesVersion++;
            invalidateSortCache();
          }
        }
      });
      
      state.wsService.on('message_restored', (data: any) => {
        console.log('Store handling message_restored:', data);
        const { message } = data;
        if (message) {
          // Add the restored message back to allMessages
          const existingIndex = state.allMessages.findIndex(m => m.id === message.id);
          if (existingIndex === -1) {
            // Insert at proper order position
            const insertIndex = message.order !== undefined && message.order < state.allMessages.length
              ? message.order
              : state.allMessages.length;
            state.allMessages.splice(insertIndex, 0, message);
          } else {
            // Update existing message
            state.allMessages[existingIndex] = message;
          }
          state.messagesVersion++;
          invalidateSortCache();
        }
      });
      
      state.wsService.on('message_branch_restored', (data: any) => {
        console.log('Store handling message_branch_restored:', data);
        const { message } = data;
        if (message) {
          // Update the message with restored branch
          const index = state.allMessages.findIndex(m => m.id === message.id);
          if (index !== -1) {
            state.allMessages[index] = message;
          } else {
            // Message was also restored (was deleted when only branch was deleted)
            const insertIndex = message.order !== undefined && message.order < state.allMessages.length
              ? message.order
              : state.allMessages.length;
            state.allMessages.splice(insertIndex, 0, message);
          }
          state.messagesVersion++;
          invalidateSortCache();
        }
      });
      
      state.wsService.on('message_split', (data: any) => {
        console.log('Store handling message_split:', data);
        const { originalMessage, newMessage } = data;
        
        // Update the original message
        if (originalMessage) {
          const index = state.allMessages.findIndex(m => m.id === originalMessage.id);
          if (index !== -1) {
            state.allMessages[index] = originalMessage;
          }
        }
        
        // Add the new message
        if (newMessage) {
          const existingIndex = state.allMessages.findIndex(m => m.id === newMessage.id);
          if (existingIndex === -1) {
            // Insert at correct position based on order
            const insertIndex = newMessage.order !== undefined && newMessage.order < state.allMessages.length
              ? newMessage.order
              : state.allMessages.length;
            state.allMessages.splice(insertIndex, 0, newMessage);
          }
        }
        
        state.messagesVersion++;
        invalidateSortCache();
      });
      
      state.wsService.on('branch_visibility_changed', async (data: any) => {
        console.log('Store handling branch_visibility_changed:', data);
        const { messageId, branchId, privateToUserId } = data;
        
        // Update the branch's privateToUserId
        const message = state.allMessages.find(m => m.id === messageId);
        if (message) {
          const branch = message.branches.find((b: any) => b.id === branchId);
          if (branch) {
            if (privateToUserId && privateToUserId !== state.user?.id) {
              // Branch is now private to someone else - remove it from our view
              message.branches = message.branches.filter((b: any) => b.id !== branchId);
              console.log(`Branch ${branchId} is now private to another user, removed from view`);
            } else {
              // Update the privacy field
              branch.privateToUserId = privateToUserId || undefined;
            }
          }
        }
        
        // If branch became visible to us (was private to us or became public), we might need to fetch subtree
        if (!privateToUserId || privateToUserId === state.user?.id) {
          // The branch is now visible - check if we need to fetch its subtree
          if (!message) {
            // We don't have this message at all, need to fetch subtree
            console.log(`Fetching newly visible subtree from branch ${branchId}`);
            try {
              const response = await api.get(`/conversations/${state.currentConversation?.id}/subtree/${branchId}`);
              if (response.data.messages) {
                for (const newMsg of response.data.messages) {
                  const existingIndex = state.allMessages.findIndex(m => m.id === newMsg.id);
                  if (existingIndex === -1) {
                    state.allMessages.push(newMsg);
                  } else {
                    state.allMessages[existingIndex] = newMsg;
                  }
                }
              }
            } catch (error) {
              console.error('Failed to fetch subtree:', error);
            }
          }
        }
        
        state.messagesVersion++;
        invalidateSortCache();
      });
      
      state.wsService.on('generation_aborted', (data: any) => {
        console.log('Store handling generation_aborted:', data);
        // The ConversationView will handle resetting isStreaming via the stream event with aborted flag
      });
      
      console.log(`[Store] All WebSocket handlers set up, calling connect()...`);
      state.wsService.connect();
      console.log(`[Store] WebSocket connect() called`);
    },
    
    disconnectWebSocket() {
      if (state.wsService) {
        state.wsService.disconnect();
        state.wsService = null;
      }
    }
  };

  return {
    install(app: App) {
      app.provide(storeKey, store);
    }
  };
}

export function useStore(): Store {
  const store = inject(storeKey);
  if (!store) {
    throw new Error('Store not provided');
  }
  return store;
}
