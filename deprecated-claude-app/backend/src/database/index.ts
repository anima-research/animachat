import { User, Conversation, Message } from '@deprecated-claude/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';

interface ApiKey {
  id: string;
  userId: string;
  name: string;
  key: string;
  provider: 'bedrock' | 'anthropic';
  createdAt: Date;
}

export class Database {
  private users: Map<string, User> = new Map();
  private usersByEmail: Map<string, string> = new Map(); // email -> userId
  private conversations: Map<string, Conversation> = new Map();
  private messages: Map<string, Message> = new Map();
  private apiKeys: Map<string, ApiKey> = new Map();
  private userConversations: Map<string, Set<string>> = new Map(); // userId -> conversationIds
  private conversationMessages: Map<string, string[]> = new Map(); // conversationId -> messageIds (ordered)
  
  // Event log for append-only behavior
  private eventLog: Array<{
    timestamp: Date;
    type: string;
    data: any;
  }> = [];

  constructor() {
    // Always create a test user for development
    this.createTestUser();
  }

  private async createTestUser() {
    // Create test user with known credentials
    const testUser: User = {
      id: 'test-user-id-12345',
      email: 'test@example.com',
      name: 'Test User',
      createdAt: new Date(),
      apiKeys: []
    };
    
    // Use a simple password: "password123"
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    this.users.set(testUser.id, testUser);
    this.usersByEmail.set(testUser.email, testUser.id);
    this.userConversations.set(testUser.id, new Set());
    
    this.logEvent('user_created', { user: testUser, passwordHash: hashedPassword });
    
    console.log('🧪 Test user created:');
    console.log('   Email: test@example.com');
    console.log('   Password: password123');
  }

  private async createDemoUser() {
    const demoUser: User = {
      id: uuidv4(),
      email: 'demo@example.com',
      name: 'Demo User',
      createdAt: new Date(),
      apiKeys: []
    };
    
    this.users.set(demoUser.id, demoUser);
    this.usersByEmail.set(demoUser.email, demoUser.id);
    
    this.logEvent('user_created', demoUser);
  }

  private logEvent(type: string, data: any) {
    this.eventLog.push({
      timestamp: new Date(),
      type,
      data: JSON.parse(JSON.stringify(data)) // Deep clone to avoid mutations
    });
  }

  // User methods
  async createUser(email: string, password: string, name: string): Promise<User> {
    if (this.usersByEmail.has(email)) {
      throw new Error('User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user: User = {
      id: uuidv4(),
      email,
      name,
      createdAt: new Date(),
      apiKeys: []
    };

    this.users.set(user.id, user);
    this.usersByEmail.set(email, user.id);
    this.userConversations.set(user.id, new Set());
    
    // Store password separately (not in User object)
    this.logEvent('user_created', { user, passwordHash: hashedPassword });

    return user;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const userId = this.usersByEmail.get(email);
    if (!userId) return null;
    return this.users.get(userId) || null;
  }

  async getUserById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async validatePassword(email: string, password: string): Promise<boolean> {
    // Find password hash from event log
    const userCreatedEvent = this.eventLog.find(
      event => event.type === 'user_created' && event.data.user.email === email
    );
    
    if (!userCreatedEvent) return false;
    
    return bcrypt.compare(password, userCreatedEvent.data.passwordHash);
  }

  // API Key methods
  async createApiKey(userId: string, name: string, provider: 'bedrock' | 'anthropic', key: string): Promise<ApiKey> {
    const apiKey: ApiKey = {
      id: uuidv4(),
      userId,
      name,
      key,
      provider,
      createdAt: new Date()
    };

    this.apiKeys.set(apiKey.id, apiKey);
    
    const user = await this.getUserById(userId);
    if (user) {
      if (!user.apiKeys) user.apiKeys = [];
      user.apiKeys.push({
        id: apiKey.id,
        name: apiKey.name,
        provider: apiKey.provider,
        masked: '****' + key.slice(-4),
        createdAt: apiKey.createdAt
      });
    }

    this.logEvent('api_key_created', { userId, keyId: apiKey.id, provider });
    
    return apiKey;
  }

  async getApiKey(keyId: string): Promise<ApiKey | null> {
    return this.apiKeys.get(keyId) || null;
  }

  async getUserApiKeys(userId: string): Promise<ApiKey[]> {
    return Array.from(this.apiKeys.values()).filter(key => key.userId === userId);
  }

  // Conversation methods
  async createConversation(userId: string, title: string, model: string, systemPrompt?: string, settings?: any): Promise<Conversation> {
    const conversation: Conversation = {
      id: uuidv4(),
      userId,
      title: title || 'New Conversation',
      model,
      systemPrompt,
      createdAt: new Date(),
      updatedAt: new Date(),
      archived: false,
      settings: settings || {
        temperature: 0.7,
        maxTokens: 1024
      }
    };

    this.conversations.set(conversation.id, conversation);
    
    const userConvs = this.userConversations.get(userId) || new Set();
    userConvs.add(conversation.id);
    this.userConversations.set(userId, userConvs);
    
    this.conversationMessages.set(conversation.id, []);

    this.logEvent('conversation_created', conversation);

    return conversation;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    return this.conversations.get(id) || null;
  }

  async getUserConversations(userId: string): Promise<Conversation[]> {
    const convIds = this.userConversations.get(userId) || new Set();
    return Array.from(convIds)
      .map(id => this.conversations.get(id))
      .filter((conv): conv is Conversation => conv !== undefined)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation | null> {
    const conversation = this.conversations.get(id);
    if (!conversation) return null;

    const updated = {
      ...conversation,
      ...updates,
      updatedAt: new Date()
    };

    this.conversations.set(id, updated);
    this.logEvent('conversation_updated', { id, updates });

    return updated;
  }

  async archiveConversation(id: string): Promise<boolean> {
    const conversation = this.conversations.get(id);
    if (!conversation) return false;

    conversation.archived = true;
    conversation.updatedAt = new Date();
    
    this.logEvent('conversation_archived', { id });
    
    return true;
  }

  async duplicateConversation(id: string, userId: string): Promise<Conversation | null> {
    const original = this.conversations.get(id);
    if (!original || original.userId !== userId) return null;

    const duplicate = await this.createConversation(
      userId,
      `${original.title} (Copy)`,
      original.model,
      original.systemPrompt,
      original.settings
    );

    // Copy messages
    const messages = await this.getConversationMessages(id);
    for (const message of messages) {
      const newMessage: Message = {
        ...message,
        id: uuidv4(),
        conversationId: duplicate.id,
        branches: message.branches.map(branch => ({
          ...branch,
          id: uuidv4()
        }))
      };
      newMessage.activeBranchId = newMessage.branches[0]?.id || '';
      
      this.messages.set(newMessage.id, newMessage);
      
      const convMessages = this.conversationMessages.get(duplicate.id) || [];
      convMessages.push(newMessage.id);
      this.conversationMessages.set(duplicate.id, convMessages);
    }

    this.logEvent('conversation_duplicated', { originalId: id, duplicateId: duplicate.id });

    return duplicate;
  }

  // Message methods
  async createMessage(conversationId: string, content: string, role: 'user' | 'assistant' | 'system', model?: string, explicitParentBranchId?: string): Promise<Message> {
    // Get conversation messages to determine parent
    const existingMessages = await this.getConversationMessages(conversationId);
    
    // Determine parent branch ID
    let parentBranchId: string;
    if (explicitParentBranchId !== undefined) {
      // Use explicitly provided parent
      parentBranchId = explicitParentBranchId;
    } else {
      // Auto-determine parent
      parentBranchId = 'root'; // Default for first message
      if (existingMessages.length > 0) {
        // Get the active branch of the last message
        const lastMessage = existingMessages[existingMessages.length - 1];
        const lastActiveBranch = lastMessage.branches.find(b => b.id === lastMessage.activeBranchId);
        if (lastActiveBranch) {
          parentBranchId = lastActiveBranch.id;
        }
      }
    }
    
    const message: Message = {
      id: uuidv4(),
      conversationId,
      branches: [{
        id: uuidv4(),
        content,
        role,
        createdAt: new Date(),
        model,
        isActive: true,
        parentBranchId
      }],
      activeBranchId: '',
      order: 0
    };
    
    message.activeBranchId = message.branches[0].id;
    
    // Get current message count for ordering
    const convMessages = this.conversationMessages.get(conversationId) || [];
    message.order = convMessages.length;
    
    this.messages.set(message.id, message);
    convMessages.push(message.id);
    this.conversationMessages.set(conversationId, convMessages);
    
    // Update conversation timestamp
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      conversation.updatedAt = new Date();
    }

    this.logEvent('message_created', message);

    return message;
  }

  async addMessageBranch(messageId: string, content: string, role: 'user' | 'assistant' | 'system', parentBranchId?: string, model?: string): Promise<Message | null> {
    const message = this.messages.get(messageId);
    if (!message) return null;

    const newBranch = {
      id: uuidv4(),
      content,
      role,
      createdAt: new Date(),
      model,
      parentBranchId,
      isActive: true
    };

    message.branches.push(newBranch);
    message.activeBranchId = newBranch.id;

    // Update conversation timestamp
    const conversation = this.conversations.get(message.conversationId);
    if (conversation) {
      conversation.updatedAt = new Date();
    }

    this.logEvent('message_branch_added', { messageId, branch: newBranch });

    return message;
  }

  async setActiveBranch(messageId: string, branchId: string): Promise<boolean> {
    const message = this.messages.get(messageId);
    if (!message) return false;

    const branch = message.branches.find(b => b.id === branchId);
    if (!branch) return false;

    message.activeBranchId = branchId;
    
    this.logEvent('active_branch_changed', { messageId, branchId });

    return true;
  }

  async getConversationMessages(conversationId: string): Promise<Message[]> {
    const messageIds = this.conversationMessages.get(conversationId) || [];
    return messageIds
      .map(id => this.messages.get(id))
      .filter((msg): msg is Message => msg !== undefined)
      .sort((a, b) => a.order - b.order);
  }

  async getMessage(id: string): Promise<Message | null> {
    return this.messages.get(id) || null;
  }

  // Export/Import functionality
  async exportConversation(conversationId: string): Promise<any> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) return null;

    const messages = await this.getConversationMessages(conversationId);

    return {
      conversation,
      messages,
      exportedAt: new Date()
    };
  }

  // Get event log (for debugging/audit)
  getEventLog(limit?: number): Array<any> {
    if (limit) {
      return this.eventLog.slice(-limit);
    }
    return [...this.eventLog];
  }
}
