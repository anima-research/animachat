import { reactive, inject, InjectionKey, App } from 'vue';
import type { User, Conversation, Message, Model, OpenRouterModel, UserDefinedModel, CreateUserModel, UpdateUserModel, UserGrantSummary } from '@deprecated-claude/shared';
import { getValidatedModelDefaults } from '@deprecated-claude/shared';
import { api } from '../services/api';
import { WebSocketService } from '../services/websocket';

interface StoreState {
  user: User | null;
  conversations: Conversation[];
  currentConversation: Conversation | null;
  allMessages: Message[]; // Store all messages
  messagesVersion: number; // Increments when messages change, for reactivity
  models: Model[];
  openRouterModels: OpenRouterModel[];
  customModels: UserDefinedModel[];
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
  localBranchSelections: Map<string, string>; // messageId -> branchId
  // WebSocket connection state
  wsConnectionState: 'connected' | 'connecting' | 'disconnected' | 'reconnecting' | 'failed';
  // Track messages where we expect activeBranchId to change (user-initiated actions)
  pendingBranchUpdates: Set<string>; // messageIds where next message_edited should update activeBranchId
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
  
  loadMessages(conversationId: string): Promise<void>;
  sendMessage(content: string, participantId?: string, responderId?: string, attachments?: Array<{ fileName: string; fileType: string; content: string; isImage?: boolean }>, explicitParentBranchId?: string, hiddenFromAi?: boolean, samplingBranches?: number): Promise<void>;
  continueGeneration(responderId?: string, explicitParentBranchId?: string, samplingBranches?: number): Promise<void>;
  regenerateMessage(messageId: string, branchId: string, parentBranchId?: string): Promise<void>;
  abortGeneration(): void;
  editMessage(messageId: string, branchId: string, content: string, responderId?: string, skipRegeneration?: boolean): Promise<void>;
  switchBranch(messageId: string, branchId: string): void;
  deleteMessage(messageId: string, branchId: string): Promise<void>;
  getVisibleMessages(): Message[];
  
  // Detached branch mode
  setDetachedMode(detached: boolean): void;
  setLocalBranchSelection(messageId: string, branchId: string): void;
  getEffectiveBranchId(message: Message): string; // Returns local selection if detached, else activeBranchId
  clearLocalBranchSelections(): void;
  
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
    isLoading: false,
    error: null,
    wsService: null,
    lastMetricsUpdate: null,
    grantSummary: null,
    systemConfig: null,
    // Detached branch mode
    isDetachedFromMainBranch: false,
    localBranchSelections: new Map(),
    // WebSocket connection state
    wsConnectionState: 'disconnected',
    // Track messages expecting activeBranchId updates from user actions
    pendingBranchUpdates: new Set()
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
    
    async register(email: string, password: string, name: string, inviteCode?: string) {
      try {
        state.isLoading = true;
        const response = await api.post('/auth/register', { email, password, name, inviteCode });
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
      } catch (error) {
        console.error('Failed to load conversations:', error);
        throw error;
      }
    },
    
    async loadConversation(id: string, retryCount = 0) {
      const maxRetries = 3;
      const retryDelay = 1000;
      const startTime = Date.now();
      
      try {
        console.log(`[loadConversation] Loading ${id}... (attempt ${retryCount + 1}/${maxRetries})`);
        console.log(`[loadConversation] API base URL: ${api.defaults.baseURL}`);
        
        const response = await api.get(`/conversations/${id}`);
        const fetchTime = Date.now() - startTime;
        console.log(`[loadConversation] Conversation data received in ${fetchTime}ms`);
        console.log(`[loadConversation] Response status: ${response.status}, has data: ${!!response.data}`);
        
        state.currentConversation = response.data;
        console.log(`[loadConversation] Set currentConversation, now loading messages...`);
        
        await this.loadMessages(id);
        
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
    
    async regenerateMessage(messageId: string, branchId: string, parentBranchId?: string) {
      if (!state.currentConversation || !state.wsService) return;
      
      // Mark that we expect this message's activeBranchId to change
      state.pendingBranchUpdates.add(messageId);
      
      state.wsService.sendMessage({
        type: 'regenerate',
        conversationId: state.currentConversation.id,
        messageId,
        branchId,
        parentBranchId // Current visible parent, for correct branch parenting after switches
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
    
    async editMessage(messageId: string, branchId: string, content: string, responderId?: string, skipRegeneration?: boolean) {
      if (!state.currentConversation || !state.wsService) return;
      
      // Mark that we expect this message's activeBranchId to change
      state.pendingBranchUpdates.add(messageId);
      
      // If regenerating, also mark the NEXT message (assistant response) as expecting update
      // This handles the case where the assistant response already exists and gets a new branch
      if (!skipRegeneration) {
        const sortedMessages = sortMessagesByTreeOrder(state.allMessages);
        const messageIndex = sortedMessages.findIndex(m => m.id === messageId);
        if (messageIndex !== -1 && messageIndex < sortedMessages.length - 1) {
          const nextMessage = sortedMessages[messageIndex + 1];
          // Only mark assistant messages as expecting update
          const activeBranch = nextMessage.branches.find(b => b.id === nextMessage.activeBranchId);
          if (activeBranch?.role === 'assistant') {
            state.pendingBranchUpdates.add(nextMessage.id);
            console.log('Also expecting update for next message:', nextMessage.id.slice(0, 8));
          }
        }
      }
      
      state.wsService.sendMessage({
        type: 'edit' as const,
        conversationId: state.currentConversation.id,
        messageId,
        branchId,
        content,
        responderId, // Pass the currently selected responder
        skipRegeneration // If true, don't generate AI response after edit
      } as any);
      
      // Update the conversation's updatedAt timestamp locally for immediate sorting
      const conv = state.conversations.find(c => c.id === state.currentConversation!.id);
      if (conv) {
        conv.updatedAt = new Date();
      }
    },
    
        switchBranch(messageId: string, branchId: string) {
      console.log('=== SWITCH BRANCH CALLED ===');
      console.log('Params:', { messageId, branchId });
      console.log('Detached mode:', state.isDetachedFromMainBranch);
      
      const message = state.allMessages.find(m => m.id === messageId);
      if (!message) {
        console.error('switchBranch: Message not found:', messageId);
        return;
      }
      
      // Get effective current branch
      const currentBranchId = this.getEffectiveBranchId(message);
      
      // Skip if already on this branch
      if (currentBranchId === branchId) {
        console.log('Already on branch:', branchId);
        return;
      }
      
      console.log('=== SWITCHING BRANCH ===');
      console.log('Message:', messageId, 'from branch:', currentBranchId, 'to branch:', branchId);
      
      if (state.isDetachedFromMainBranch) {
        // Detached mode: only update local selection, don't affect main branch
        this.setLocalBranchSelection(messageId, branchId);
        console.log('Branch switch saved locally (detached mode)');
      } else {
        // Attached mode: update local state AND persist to backend
        message.activeBranchId = branchId;
        
        if (state.currentConversation) {
          api.post(`/conversations/${state.currentConversation.id}/set-active-branch`, {
            messageId,
            branchId
          }).then(() => {
            console.log('Branch switch persisted to backend');
          }).catch(error => {
            console.error('Failed to persist branch switch:', error);
          });
        }
      }
      
      // Sort messages by tree order to handle out-of-order children
      const sortedMessages = sortMessagesByTreeOrder(state.allMessages);
      const sortedMessageIndex = sortedMessages.findIndex(m => m.id === messageId);
      
      // Build path up to and including the switched message (in tree order)
      const branchPath: string[] = [];
      for (let i = 0; i <= sortedMessageIndex; i++) {
        const msg = sortedMessages[i];
        const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId);
        if (activeBranch) {
          branchPath.push(activeBranch.id);
        }
      }
      
      console.log('Branch path after switch:', [...branchPath]);
      
      // Update subsequent messages (in tree order) to follow the correct path
      for (let i = sortedMessageIndex + 1; i < sortedMessages.length; i++) {
        const msg = sortedMessages[i];
        
        // Find which branch of this message continues from our path
        for (const branch of msg.branches) {
          if (branch.parentBranchId && branchPath.includes(branch.parentBranchId)) {
            if (msg.activeBranchId !== branch.id) {
              console.log(`Updating message activeBranchId from ${msg.activeBranchId} to ${branch.id}`);
              msg.activeBranchId = branch.id;
              
              // Also persist this change to backend (non-blocking)
              if (state.currentConversation) {
                api.post(`/conversations/${state.currentConversation.id}/set-active-branch`, {
                  messageId: msg.id,
                  branchId: branch.id
                }).catch(error => {
                  console.error('Failed to persist downstream branch switch:', error);
                });
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
      
      // Force recompute visible messages after branch switch
      const newVisible = this.getVisibleMessages();
      console.log('After switch, visible messages:', newVisible.length);
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
      // Sort messages by tree order to ensure parents come before children
      // This handles cases where order numbers don't reflect tree structure
      const sortedMessages = sortMessagesByTreeOrder(state.allMessages);
      
      const visibleMessages: Message[] = [];
      const branchPath: string[] = []; // Track the current conversation path (branch IDs)
      
      for (let i = 0; i < sortedMessages.length; i++) {
        const message = sortedMessages[i];
        // Use effective branch ID (local selection if detached, else server's activeBranchId)
        const effectiveBranchId = this.getEffectiveBranchId(message);
        const activeBranch = message.branches.find(b => b.id === effectiveBranchId);
        
        // console.log(`Message ${i}:`, message.id, 'activeBranchId:', message.activeBranchId, 
        //             'branches:', message.branches.length, 
        //             'activeBranch parentBranchId:', activeBranch?.parentBranchId);
        
        // Case 1: Active branch exists and is a root message
        if (activeBranch && (!activeBranch.parentBranchId || activeBranch.parentBranchId === 'root')) {
          visibleMessages.push(message);
          branchPath.push(activeBranch.id);
          // console.log('Added root message:', message.id);
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

        // Case 3: Active branch is missing (deleted) or doesn't continue from our path
        // Look for ANY branch that continues from our path
        const validBranches = message.branches.filter(branch => 
          branch.parentBranchId && branchPath.includes(branch.parentBranchId)
        );
        
        if (validBranches.length === 0) {
          // No branch continues from current path - skip this message
          if (!activeBranch) {
            console.log('No active branch found for message:', message.id, '(activeBranchId points to deleted branch)');
          }
          continue;
        }
        
        // Pick the best branch:
        // 1. Prefer the effective branchId if it's valid and in validBranches
        // 2. Otherwise pick the chronologically newest (by createdAt)
        let selectedBranch = validBranches.find(b => b.id === effectiveBranchId);
        
        if (!selectedBranch) {
          // Sort by createdAt descending (newest first) and pick the first
          selectedBranch = [...validBranches].sort((a, b) => {
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeB - timeA; // Newest first
          })[0];
          
          if (!activeBranch) {
            console.log('Recovered message with deleted active branch:', message.id, 
                        'using branch:', selectedBranch.id.slice(0, 8));
          }
        }
        
        // Create a deep copy with the selected branch as active
              const messageCopy = { 
                ...message, 
          activeBranchId: selectedBranch.id,
          branches: [...message.branches]
              };
              visibleMessages.push(messageCopy);
              
        const parentIndex = branchPath.indexOf(selectedBranch.parentBranchId!);
              branchPath.length = parentIndex + 1;
        branchPath.push(selectedBranch.id);
      }
      
       console.log('=== GET_VISIBLE_MESSAGES RESULT ===');
        console.log('Total:', state.allMessages.length, '-> Visible:', visibleMessages.length);
        console.log('Branch path:', branchPath.map(b => b.slice(0, 8)));
        if (visibleMessages.length > 0) {
          const last = visibleMessages[visibleMessages.length - 1];
          console.log('Last visible:', last.id.slice(0, 8), 'activeBranch:', last.activeBranchId?.slice(0, 8));
        }
      return visibleMessages;
    },
    
    // Detached branch mode methods
    setDetachedMode(detached: boolean) {
      state.isDetachedFromMainBranch = detached;
      if (!detached) {
        // When re-attaching, clear local selections
        state.localBranchSelections.clear();
      }
      // Trigger reactivity
      state.messagesVersion++;
      invalidateSortCache();
      console.log('[Store] Detached mode:', detached);
    },
    
    setLocalBranchSelection(messageId: string, branchId: string) {
      state.localBranchSelections.set(messageId, branchId);
      // Trigger reactivity
      state.messagesVersion++;
      invalidateSortCache();
      console.log('[Store] Local branch selection:', messageId.slice(0, 8), '->', branchId.slice(0, 8));
    },
    
    getEffectiveBranchId(message: Message): string {
      // If detached, use local selection if available
      if (state.isDetachedFromMainBranch) {
        const localSelection = state.localBranchSelections.get(message.id);
        if (localSelection) {
          return localSelection;
        }
      }
      // Fall back to server's activeBranchId
      return message.activeBranchId;
    },
    
    clearLocalBranchSelections() {
      state.localBranchSelections.clear();
      state.messagesVersion++;
      invalidateSortCache();
    },
    
    // Model actions
    async loadModels() {
      try {
        const response = await api.get('/models');
        state.models = response.data;
        // console.log('Frontend loaded models:', state.models.map(m => ({
        //   id: m.id,
        //   name: m.name,
        //   displayName: m.displayName,
        //   provider: m.provider
        // })));
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
        console.log('=== MESSAGE_EDITED RECEIVED ===');
        console.log('Message ID:', data.message.id.slice(0, 8));
        console.log('Server activeBranchId:', data.message.activeBranchId?.slice(0, 8));
        console.log('Branches:', data.message.branches.map((b: any) => ({
          id: b.id.slice(0, 8),
          parent: b.parentBranchId?.slice(0, 8) || 'root',
          contentLen: b.content?.length || 0
        })));
        
        const index = state.allMessages.findIndex(m => m.id === data.message.id);
        if (index !== -1) {
          const existingMessage = state.allMessages[index];
          console.log('Found at index:', index, '- updating');
          console.log('Current frontend activeBranchId:', existingMessage.activeBranchId?.slice(0, 8));
          
          // Check if this message was expecting an activeBranchId update (user action like edit/regenerate)
          const expectingUpdate = state.pendingBranchUpdates.has(data.message.id);
          console.log('Expecting activeBranchId update:', expectingUpdate);
          
          if (expectingUpdate) {
            // User action - allow the new activeBranchId from server
            state.pendingBranchUpdates.delete(data.message.id);
            state.allMessages[index] = data.message;
            console.log('Updated activeBranchId to:', data.message.activeBranchId?.slice(0, 8));
          } else {
            // Parallel generation update - preserve the frontend's activeBranchId
            const preservedActiveBranchId = existingMessage.activeBranchId;
            state.allMessages[index] = {
              ...data.message,
              activeBranchId: preservedActiveBranchId
            };
            console.log('Preserved activeBranchId:', preservedActiveBranchId?.slice(0, 8));
          }
          
          state.messagesVersion++;
          invalidateSortCache();
          console.log('messagesVersion now:', state.messagesVersion);
        } else {
          console.log('NOT FOUND in allMessages!');
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
