import { reactive, inject, InjectionKey, App } from 'vue';
import type { User, Conversation, Message, Model, OpenRouterModel, UserDefinedModel, CreateUserModel, UpdateUserModel } from '@deprecated-claude/shared';
import { api } from '../services/api';
import { WebSocketService } from '../services/websocket';

interface StoreState {
  user: User | null;
  conversations: Conversation[];
  currentConversation: Conversation | null;
  allMessages: Message[]; // Store all messages
  models: Model[];
  openRouterModels: OpenRouterModel[];
  customModels: UserDefinedModel[];
  isLoading: boolean;
  error: string | null;
  wsService: WebSocketService | null;
  lastMetricsUpdate: { conversationId: string; metrics: any } | null;
  systemConfig: {
    features?: any;
    groupChatSuggestedModels?: string[];
    defaultModel?: string;
  } | null;
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
  register(email: string, password: string, name: string): Promise<void>;
  logout(): void;
  
  loadConversations(): Promise<void>;
  loadConversation(id: string): Promise<void>;
  createConversation(model: string, title?: string, format?: 'standard' | 'prefill'): Promise<Conversation>;
  updateConversation(id: string, updates: Partial<Conversation>): Promise<void>;
  archiveConversation(id: string): Promise<void>;
  duplicateConversation(id: string): Promise<Conversation>;
  
  loadMessages(conversationId: string): Promise<void>;
  sendMessage(content: string, participantId?: string, responderId?: string, attachments?: Array<{ fileName: string; fileType: string; content: string; isImage?: boolean }>, explicitParentBranchId?: string): Promise<void>;
  continueGeneration(responderId?: string, explicitParentBranchId?: string): Promise<void>;
  regenerateMessage(messageId: string, branchId: string): Promise<void>;
  abortGeneration(): void;
  editMessage(messageId: string, branchId: string, content: string, responderId?: string): Promise<void>;
  switchBranch(messageId: string, branchId: string): void;
  deleteMessage(messageId: string, branchId: string): Promise<void>;
  getVisibleMessages(): Message[];
  
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
    models: [],
    openRouterModels: [],
    customModels: [],
    isLoading: false,
    error: null,
    wsService: null,
    lastMetricsUpdate: null,
    systemConfig: null
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
        const { user, token } = response.data;
        
        localStorage.setItem('token', token);
        state.user = user;
        
        // Connect WebSocket after registration
        this.connectWebSocket();
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
    
    async loadConversation(id: string) {
      try {
        const response = await api.get(`/conversations/${id}`);
        state.currentConversation = response.data;
        await this.loadMessages(id);
      } catch (error) {
        console.error('Failed to load conversation:', error);
        throw error;
      }
    },
    
    async createConversation(model: string, title?: string, format: 'standard' | 'prefill' = 'standard') {
      try {
        const response = await api.post('/conversations', {
          model,
          title: title || 'New Conversation',
          format,
          settings: {
            temperature: 1.0,
            maxTokens: 4096 // Safe default for all models
            // topP and topK are intentionally omitted to use API defaults
          }
        });
        
        const conversation = response.data;
        state.conversations.unshift(conversation);
        state.currentConversation = conversation;
        state.allMessages = [];
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
    async loadMessages(conversationId: string) {
      try {
        const response = await api.get(`/conversations/${conversationId}/messages`);
        state.allMessages = response.data;
        invalidateSortCache();
        console.log(`Loaded ${state.allMessages.length} messages for conversation ${conversationId}`);
        
        // Log if this is multi-participant
        if (state.currentConversation?.format !== 'standard') {
          console.log('Multi-participant conversation format:', state.currentConversation?.format);
        }
      } catch (error) {
        console.error('Failed to load messages:', error);
        throw error;
      }
    },
    
    async sendMessage(content: string, participantId?: string, responderId?: string, attachments?: Array<{ fileName: string; fileType: string; content: string; isImage?: boolean }>, explicitParentBranchId?: string) {
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
        attachments
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
    
    async continueGeneration(responderId?: string, explicitParentBranchId?: string) {
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
        responderId
      });
      
      // Update the conversation's updatedAt timestamp locally for immediate sorting
      const conv = state.conversations.find(c => c.id === state.currentConversation!.id);
      if (conv) {
        conv.updatedAt = new Date();
        console.log(`[Store] Updated conversation ${conv.id} timestamp for continue generation`);
      }
    },
    
    async regenerateMessage(messageId: string, branchId: string) {
      if (!state.currentConversation || !state.wsService) return;
      
      state.wsService.sendMessage({
        type: 'regenerate',
        conversationId: state.currentConversation.id,
        messageId,
        branchId
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
    
    async editMessage(messageId: string, branchId: string, content: string, responderId?: string) {
      if (!state.currentConversation || !state.wsService) return;
      
      state.wsService.sendMessage({
        type: 'edit' as const,
        conversationId: state.currentConversation.id,
        messageId,
        branchId,
        content,
        responderId // Pass the currently selected responder
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
      console.log('All messages count:', state.allMessages.length);
      
      const message = state.allMessages.find(m => m.id === messageId);
      if (!message) {
        console.error('switchBranch: Message not found:', messageId);
        console.log('Available message IDs:', state.allMessages.map(m => m.id));
        return;
      }
      
      console.log('Message branches:', message.branches.map(b => ({ id: b.id, parentBranchId: b.parentBranchId })));
      
      // Skip if already on this branch
      if (message.activeBranchId === branchId) {
        console.log('Already on branch:', branchId);
        return;
      }
      
      console.log('=== SWITCHING BRANCH ===');
      console.log('Message:', messageId, 'from branch:', message.activeBranchId, 'to branch:', branchId);
      
      // First, update the local state
      message.activeBranchId = branchId;
      
      // Persist to backend immediately (but don't block on it)
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
        const activeBranch = message.branches.find(b => b.id === message.activeBranchId);
        
        // console.log(`Message ${i}:`, message.id, 'activeBranchId:', message.activeBranchId, 
        //             'branches:', message.branches.length, 
        //             'activeBranch parentBranchId:', activeBranch?.parentBranchId);
        
        if (!activeBranch) {
          console.log('No active branch found for message:', message.id);
          continue;
        }

        // First message (parent is 'root' or null)
        if (!activeBranch.parentBranchId || activeBranch.parentBranchId === 'root') {
          visibleMessages.push(message);
          branchPath.push(activeBranch.id);
          // console.log('Added root message:', message.id);
          continue;
        }

        // Check if this message continues from our current path
        if (branchPath.includes(activeBranch.parentBranchId)) {
          // This message is a valid continuation
          visibleMessages.push(message);
          
          // Find where in the path this branches from
          const parentIndex = branchPath.indexOf(activeBranch.parentBranchId);
          
          // Truncate the path after the parent and add this branch
          branchPath.length = parentIndex + 1;
          branchPath.push(activeBranch.id);
          
          // console.log('Message continues from branch at index', parentIndex, 'added branch:', activeBranch.id, 'branchPath now:', [...branchPath]);
        } else {
          // The active branch doesn't continue from our path
          // Look for branches that do, preferring: 1) stored activeBranchId, 2) chronologically newest
          
          // Find all branches that continue from our path
          const validBranches = message.branches.filter(branch => 
            branch.parentBranchId && branchPath.includes(branch.parentBranchId)
          );
          
          if (validBranches.length === 0) {
            // No branch continues from current path - skip this message
            continue;
          }
          
          // Pick the best branch:
          // 1. Prefer the stored activeBranchId if it's valid
          // 2. Otherwise pick the chronologically newest (by createdAt)
          let selectedBranch = validBranches.find(b => b.id === message.activeBranchId);
          
          if (!selectedBranch) {
            // Sort by createdAt descending (newest first) and pick the first
            selectedBranch = [...validBranches].sort((a, b) => {
              const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
              return timeB - timeA; // Newest first
            })[0];
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
      }
      
      // console.log('Returning', visibleMessages.length, 'visible messages from', state.allMessages.length, 'total');
      return visibleMessages;
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
      const token = localStorage.getItem('token');
      if (!token) return;
      
      state.wsService = new WebSocketService(token);
      
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
        // console.log('Store handling message_edited:', data);
        const index = state.allMessages.findIndex(m => m.id === data.message.id);
        if (index !== -1) {
          state.allMessages[index] = data.message;
          invalidateSortCache();
          console.log('Updated message at index', index, 'new activeBranchId:', data.message.activeBranchId);
        }
      });
      
      state.wsService.on('message_deleted', (data: any) => {
        // console.log('Store handling message_deleted:', data);
        const { messageId, branchId, deletedMessages } = data;
        
        // If multiple messages were deleted (cascade delete)
        if (deletedMessages && deletedMessages.length > 0) {
          state.allMessages = state.allMessages.filter(m => !deletedMessages.includes(m.id));
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
            invalidateSortCache();
          }
        }
      });
      
      state.wsService.on('generation_aborted', (data: any) => {
        console.log('Store handling generation_aborted:', data);
        // The ConversationView will handle resetting isStreaming via the stream event with aborted flag
      });
      
      state.wsService.connect();
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
