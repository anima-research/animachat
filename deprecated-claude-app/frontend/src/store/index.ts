import { reactive, computed, inject, InjectionKey, App } from 'vue';
import type { User, Conversation, Message, Model } from '@deprecated-claude/shared';
import { api } from '../services/api';
import { WebSocketService } from '../services/websocket';

interface StoreState {
  user: User | null;
  conversations: Conversation[];
  currentConversation: Conversation | null;
  allMessages: Message[]; // Store all messages
  models: Model[];
  isLoading: boolean;
  error: string | null;
  wsService: WebSocketService | null;
}

export interface Store {
  state: StoreState;
  
  // Getters
  isAuthenticated: boolean;
  currentModel: Model | null;
  messages: Message[]; // Computed property for visible messages
  
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
  sendMessage(content: string, participantId?: string, responderId?: string): Promise<void>;
  regenerateMessage(messageId: string, branchId: string): Promise<void>;
  editMessage(messageId: string, branchId: string, content: string): Promise<void>;
  switchBranch(messageId: string, branchId: string): void;
  deleteMessage(messageId: string, branchId: string): Promise<void>;
  
  loadModels(): Promise<void>;
  
  connectWebSocket(): void;
  disconnectWebSocket(): void;
}

const storeKey: InjectionKey<Store> = Symbol('store');

export function createStore(): {
  install(app: App): void;
} {
  const state = reactive<StoreState>({
    user: null,
    conversations: [],
    currentConversation: null,
    allMessages: [], // Store all messages
    models: [],
    isLoading: false,
    error: null,
    wsService: null,
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
    
    async register(email: string, password: string, name: string) {
      try {
        state.isLoading = true;
        const response = await api.post('/auth/register', { email, password, name });
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
            maxTokens: 1024
            // topP and topK are intentionally omitted to use API defaults
          }
        });
        
        const conversation = response.data;
        state.conversations.unshift(conversation);
        state.currentConversation = conversation;
        state.allMessages = [];
        
        return conversation;
      } catch (error) {
        console.error('Failed to create conversation:', error);
        throw error;
      }
    },
    
    async updateConversation(id: string, updates: Partial<Conversation>) {
      try {
        const response = await api.patch(`/conversations/${id}`, updates);
        const updated = response.data;
        
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
      } catch (error) {
        console.error('Failed to load messages:', error);
        throw error;
      }
    },
    
    async sendMessage(content: string, participantId?: string, responderId?: string) {
      if (!state.currentConversation || !state.wsService) return;
      
      // Get the last visible message to determine the parent branch
      const visibleMessages = this.messages;
      console.log('=== SENDING MESSAGE ===');
      console.log('Visible messages count:', visibleMessages.length);
      
      if (visibleMessages.length > 0) {
        console.log('Visible messages:', visibleMessages.map((m, idx) => ({
          index: idx,
          id: m.id,
          activeBranchId: m.activeBranchId,
          content: m.branches.find(b => b.id === m.activeBranchId)?.content.substring(0, 30) + '...'
        })));
      }
      
      let parentBranchId: string | undefined;
      
      if (visibleMessages.length > 0) {
        const lastMessage = visibleMessages[visibleMessages.length - 1];
        console.log('Last visible message:', lastMessage.id, 'branches:', lastMessage.branches.map(b => ({
          id: b.id,
          parent: b.parentBranchId,
          isActive: b.id === lastMessage.activeBranchId
        })));
        const activeBranch = lastMessage.branches.find(b => b.id === lastMessage.activeBranchId);
        parentBranchId = activeBranch?.id;
        console.log('>>> PARENT BRANCH ID:', parentBranchId, 'from branch', activeBranch?.id, 'of message', lastMessage.id);
      } else {
        console.log('Sending first message - no parent');
      }
      
      state.wsService.sendMessage({
        type: 'chat',
        conversationId: state.currentConversation.id,
        messageId: crypto.randomUUID(),
        content,
        parentBranchId,
        participantId,
        responderId
      });
    },
    
    async regenerateMessage(messageId: string, branchId: string) {
      if (!state.currentConversation || !state.wsService) return;
      
      state.wsService.sendMessage({
        type: 'regenerate',
        conversationId: state.currentConversation.id,
        messageId,
        branchId
      });
    },
    
    async editMessage(messageId: string, branchId: string, content: string) {
      if (!state.currentConversation || !state.wsService) return;
      
      state.wsService.sendMessage({
        type: 'edit',
        conversationId: state.currentConversation.id,
        messageId,
        branchId,
        content
      });
    },
    
        switchBranch(messageId: string, branchId: string) {
      const messageIndex = state.allMessages.findIndex(m => m.id === messageId);
      if (messageIndex === -1) return;
      
      const message = state.allMessages[messageIndex];
      console.log('=== SWITCHING BRANCH ===');
      console.log('Message:', messageId, 'from branch:', message.activeBranchId, 'to branch:', branchId);
      
      message.activeBranchId = branchId;
      
      // Update all subsequent messages to follow the new path
      const branchPath: string[] = [];
      
      // Build path up to and including the switched message
      for (let i = 0; i <= messageIndex; i++) {
        const msg = state.allMessages[i];
        const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId);
        if (activeBranch) {
          branchPath.push(activeBranch.id);
        }
      }
      
      console.log('Branch path after switch:', [...branchPath]);
      
      // Update subsequent messages to follow the correct path
      for (let i = messageIndex + 1; i < state.allMessages.length; i++) {
        const msg = state.allMessages[i];
        
        // Find which branch of this message continues from our path
        for (const branch of msg.branches) {
          if (branch.parentBranchId && branchPath.includes(branch.parentBranchId)) {
            if (msg.activeBranchId !== branch.id) {
              console.log(`Updating message ${i} activeBranchId from ${msg.activeBranchId} to ${branch.id}`);
              msg.activeBranchId = branch.id;
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
      console.log('getVisibleMessages called, allMessages:', state.allMessages.length);
      if (state.allMessages.length > 0) {
        console.log('All messages:', state.allMessages.map(m => ({
          id: m.id,
          activeBranchId: m.activeBranchId,
          branches: m.branches.map(b => ({
            id: b.id,
            parent: b.parentBranchId,
            role: b.role,
            isActive: b.id === m.activeBranchId,
            content: b.content.substring(0, 20) + '...'
          }))
        })));
      }
      const visibleMessages: Message[] = [];
      const branchPath: string[] = []; // Track the current conversation path (branch IDs)
      
      for (let i = 0; i < state.allMessages.length; i++) {
        const message = state.allMessages[i];
        const activeBranch = message.branches.find(b => b.id === message.activeBranchId);
        
        console.log(`Message ${i}:`, message.id, 'activeBranchId:', message.activeBranchId, 
                    'branches:', message.branches.length, 
                    'activeBranch parentBranchId:', activeBranch?.parentBranchId);
        
        if (!activeBranch) {
          console.log('No active branch found for message:', message.id);
          continue;
        }

        // First message (parent is 'root' or null)
        if (!activeBranch.parentBranchId || activeBranch.parentBranchId === 'root') {
          visibleMessages.push(message);
          branchPath.push(activeBranch.id);
          console.log('Added root message:', message.id);
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
          
          console.log('Message continues from branch at index', parentIndex, 'added branch:', activeBranch.id, 'branchPath now:', [...branchPath]);
        } else {
          // The active branch doesn't continue from our path
          // Look for any branch in this message that does
          let found = false;
          
          console.log('Looking for branch that continues from path:', [...branchPath]);
          for (const branch of message.branches) {
            console.log('  Checking branch:', branch.id, 'parent:', branch.parentBranchId, 'in path?', branchPath.includes(branch.parentBranchId));
            if (branch.parentBranchId && branchPath.includes(branch.parentBranchId)) {
              // Found a branch that continues from our path
              // Note: We should NOT modify message.activeBranchId in a computed property
              // Instead, we'll create a deep copy including branches
              const messageCopy = { 
                ...message, 
                activeBranchId: branch.id,
                branches: [...message.branches] // Copy the branches array too
              };
              visibleMessages.push(messageCopy);
              
              const parentIndex = branchPath.indexOf(branch.parentBranchId);
              branchPath.length = parentIndex + 1;
              branchPath.push(branch.id);
              
              found = true;
              console.log('Found branch', branch.id, 'that continues from path, branchPath now:', [...branchPath]);
              break;
            }
          }
          
          if (!found) {
            console.log('No branch in message continues from current path - skipping this message');
            // Don't break! There might be messages later that do connect to our path
            continue;
          }
        }
      }
      
      console.log('Returning', visibleMessages.length, 'visible messages from', state.allMessages.length, 'total');
      return visibleMessages;
    },
    
    // Model actions
    async loadModels() {
      try {
        const response = await api.get('/models');
        state.models = response.data;
        console.log('Frontend loaded models:', state.models.map(m => ({
          id: m.id,
          name: m.name,
          displayName: m.displayName,
          provider: m.provider
        })));
      } catch (error) {
        console.error('Failed to load models:', error);
        throw error;
      }
    },
    
    // WebSocket actions
    connectWebSocket() {
      const token = localStorage.getItem('token');
      if (!token) return;
      
      state.wsService = new WebSocketService(token);
      
      state.wsService.on('message_created', (data: any) => {
        console.log('Store handling message_created:', data);
        state.allMessages.push(data.message);
      });
      
      state.wsService.on('stream', (data: any) => {
        console.log('Store handling stream:', data);
        const message = state.allMessages.find(m => m.id === data.messageId);
        if (message) {
          const branch = message.branches.find(b => b.id === data.branchId);
          if (branch) {
            branch.content += data.content;
          }
        }
      });
      
      state.wsService.on('message_edited', (data: any) => {
        console.log('Store handling message_edited:', data);
        const index = state.allMessages.findIndex(m => m.id === data.message.id);
        if (index !== -1) {
          state.allMessages[index] = data.message;
          console.log('Updated message at index', index, 'new activeBranchId:', data.message.activeBranchId);
        }
      });
      
      state.wsService.on('message_deleted', (data: any) => {
        console.log('Store handling message_deleted:', data);
        const { messageId, branchId, deletedMessages } = data;
        
        // If multiple messages were deleted (cascade delete)
        if (deletedMessages && deletedMessages.length > 0) {
          state.allMessages = state.allMessages.filter(m => !deletedMessages.includes(m.id));
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
          }
        }
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
