import { describe, it, expect } from 'vitest';
import {
  UserSchema,
  ModelCapabilitiesSchema,
  ProviderEnum,
  ConversationModeEnum,
  ConversationFormatSchema,
  ModelSchema,
  ModelSettingsSchema,
  ConfigurableSettingSchema,
  SelectSettingSchema,
  BooleanSettingSchema,
  NumberSettingSchema,
  MultiselectSettingSchema,
  TextSettingSchema,
  ContentBlockSchema,
  TextContentBlockSchema,
  ThinkingContentBlockSchema,
  RedactedThinkingContentBlockSchema,
  ImageContentBlockSchema,
  AudioContentBlockSchema,
  PostHocOperationTypeSchema,
  PostHocOperationSchema,
  CreationSourceSchema,
  MessageBranchSchema,
  MessageSchema,
  ParticipantSchema,
  ConversationSchema,
  ContextManagementSchema,
  BookmarkSchema,
  AttachmentSchema,
  InviteSchema,
  PersonaContextStrategySchema,
  PersonaSchema,
  PersonaPermissionSchema,
  SiteConfigSchema,
  AvatarPackSchema,
  PrefillSettingsSchema,
  UserDefinedModelSchema,
  CreateUserModelSchema,
  WsMessageSchema,
  SiteLinkSchema,
  ContentSectionSchema,
  TestimonialSchema,
  UpdateParticipantSchema,
  getValidatedModelDefaults,
  deriveCanonicalId,
} from './types.js';

// ============================================================================
// Helper factories
// ============================================================================

const uuid = () => '00000000-0000-4000-a000-000000000001';
const uuid2 = () => '00000000-0000-4000-a000-000000000002';

function validUser() {
  return {
    id: uuid(),
    email: 'test@example.com',
    name: 'Test User',
    createdAt: new Date('2024-01-01'),
  };
}

function minimalModel() {
  return {
    id: 'test-model',
    providerModelId: 'test-model-v1',
    displayName: 'Test Model',
    shortName: 'Test',
    provider: 'anthropic' as const,
    hidden: false,
    contextWindow: 100000,
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 1, default: 0.7, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 2048 },
    },
  };
}

// ============================================================================
// UserSchema
// ============================================================================

describe('UserSchema', () => {
  it('accepts a valid user with required fields', () => {
    const result = UserSchema.safeParse(validUser());
    expect(result.success).toBe(true);
  });

  it('accepts a user with optional fields', () => {
    const result = UserSchema.safeParse({
      ...validUser(),
      emailVerified: true,
      emailVerifiedAt: new Date(),
      ageVerified: false,
      tosAccepted: true,
      tosAcceptedAt: new Date(),
      apiKeys: [{
        id: uuid(),
        name: 'My Key',
        provider: 'anthropic',
        masked: 'sk-...xxx',
        createdAt: new Date(),
      }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a user with invalid email', () => {
    const result = UserSchema.safeParse({ ...validUser(), email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects a user with non-UUID id', () => {
    const result = UserSchema.safeParse({ ...validUser(), id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects a user with missing name', () => {
    const { name: _, ...noName } = validUser();
    const result = UserSchema.safeParse(noName);
    expect(result.success).toBe(false);
  });

  it('rejects a user with missing createdAt', () => {
    const { createdAt: _, ...noDate } = validUser();
    const result = UserSchema.safeParse(noDate);
    expect(result.success).toBe(false);
  });

  it('rejects a user with invalid provider in apiKeys', () => {
    const result = UserSchema.safeParse({
      ...validUser(),
      apiKeys: [{
        id: uuid(),
        name: 'Key',
        provider: 'invalid-provider',
        masked: 'xxx',
        createdAt: new Date(),
      }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid providers in apiKeys', () => {
    for (const provider of ['bedrock', 'anthropic', 'openrouter', 'openai-compatible', 'google'] as const) {
      const result = UserSchema.safeParse({
        ...validUser(),
        apiKeys: [{
          id: uuid(),
          name: 'Key',
          provider,
          masked: 'xxx',
          createdAt: new Date(),
        }],
      });
      expect(result.success).toBe(true);
    }
  });
});

// ============================================================================
// ModelCapabilitiesSchema
// ============================================================================

describe('ModelCapabilitiesSchema', () => {
  it('applies defaults for all boolean fields', () => {
    const result = ModelCapabilitiesSchema.parse({});
    expect(result.imageInput).toBe(false);
    expect(result.pdfInput).toBe(false);
    expect(result.audioInput).toBe(false);
    expect(result.videoInput).toBe(false);
    expect(result.imageOutput).toBe(false);
    expect(result.audioOutput).toBe(false);
    expect(result.autoTruncateContext).toBe(false);
  });

  it('respects explicit true values', () => {
    const result = ModelCapabilitiesSchema.parse({
      imageInput: true,
      pdfInput: true,
    });
    expect(result.imageInput).toBe(true);
    expect(result.pdfInput).toBe(true);
    expect(result.audioInput).toBe(false);
  });

  it('accepts optional numeric limits', () => {
    const result = ModelCapabilitiesSchema.parse({
      maxFileSize: 10485760,
      maxImageSize: 2048,
      maxAudioDuration: 300,
      maxVideoDuration: 60,
      maxPdfPages: 100,
    });
    expect(result.maxFileSize).toBe(10485760);
    expect(result.maxPdfPages).toBe(100);
  });

  it('rejects non-boolean for boolean fields', () => {
    const result = ModelCapabilitiesSchema.safeParse({ imageInput: 'yes' });
    expect(result.success).toBe(false);
  });

  it('rejects non-number for numeric limits', () => {
    const result = ModelCapabilitiesSchema.safeParse({ maxFileSize: 'big' });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// ProviderEnum and ConversationModeEnum
// ============================================================================

describe('ProviderEnum', () => {
  it.each(['bedrock', 'anthropic', 'openrouter', 'openai-compatible', 'google'] as const)(
    'accepts valid provider "%s"', (provider) => {
      expect(ProviderEnum.parse(provider)).toBe(provider);
    }
  );

  it('rejects unknown providers', () => {
    const result = ProviderEnum.safeParse('azure');
    expect(result.success).toBe(false);
  });
});

describe('ConversationModeEnum', () => {
  it.each(['auto', 'prefill', 'messages', 'completion'] as const)(
    'accepts "%s"', (mode) => {
      expect(ConversationModeEnum.parse(mode)).toBe(mode);
    }
  );

  it('rejects invalid mode', () => {
    const result = ConversationModeEnum.safeParse('streaming');
    expect(result.success).toBe(false);
  });
});

describe('ConversationFormatSchema', () => {
  it('accepts "standard" and "prefill"', () => {
    expect(ConversationFormatSchema.parse('standard')).toBe('standard');
    expect(ConversationFormatSchema.parse('prefill')).toBe('prefill');
  });

  it('rejects other strings', () => {
    expect(ConversationFormatSchema.safeParse('custom').success).toBe(false);
  });
});

// ============================================================================
// ConfigurableSettingSchema (discriminated union)
// ============================================================================

describe('ConfigurableSettingSchema', () => {
  it('accepts a valid select setting', () => {
    const result = ConfigurableSettingSchema.safeParse({
      type: 'select',
      key: 'format',
      label: 'Format',
      options: [{ value: 'json', label: 'JSON' }],
      default: 'json',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid boolean setting', () => {
    const result = ConfigurableSettingSchema.safeParse({
      type: 'boolean',
      key: 'verbose',
      label: 'Verbose',
      default: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid number setting', () => {
    const result = ConfigurableSettingSchema.safeParse({
      type: 'number',
      key: 'count',
      label: 'Count',
      min: 0,
      max: 100,
      default: 50,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid multiselect setting', () => {
    const result = ConfigurableSettingSchema.safeParse({
      type: 'multiselect',
      key: 'modalities',
      label: 'Modalities',
      options: [{ value: 'text', label: 'Text' }],
      default: ['text'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid text setting', () => {
    const result = ConfigurableSettingSchema.safeParse({
      type: 'text',
      key: 'prefix',
      label: 'Prefix',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown setting type', () => {
    const result = ConfigurableSettingSchema.safeParse({
      type: 'slider',
      key: 'x',
      label: 'X',
    });
    expect(result.success).toBe(false);
  });

  it('rejects select setting missing options', () => {
    const result = SelectSettingSchema.safeParse({
      type: 'select',
      key: 'format',
      label: 'Format',
      default: 'json',
      // missing options
    });
    expect(result.success).toBe(false);
  });

  it('rejects number setting missing min/max', () => {
    const result = NumberSettingSchema.safeParse({
      type: 'number',
      key: 'count',
      label: 'Count',
      default: 50,
      // missing min and max
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// ModelSchema
// ============================================================================

describe('ModelSchema', () => {
  it('accepts a minimal valid model', () => {
    const result = ModelSchema.safeParse(minimalModel());
    expect(result.success).toBe(true);
  });

  it('accepts a model with all optional fields', () => {
    const result = ModelSchema.safeParse({
      ...minimalModel(),
      canonicalId: 'claude-3-opus',
      supportsThinking: true,
      thinkingDefaultEnabled: false,
      supportsPrefill: true,
      capabilities: { imageInput: true },
      currencies: { credit: true },
      configurableSettings: [{
        type: 'boolean',
        key: 'stream',
        label: 'Stream',
        default: true,
      }],
      settings: {
        ...minimalModel().settings,
        topP: { min: 0, max: 1, default: 0.9, step: 0.05 },
        topK: { min: 0, max: 500, default: 250, step: 1 },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a model with invalid provider', () => {
    const result = ModelSchema.safeParse({ ...minimalModel(), provider: 'azure' });
    expect(result.success).toBe(false);
  });

  it('rejects a model missing temperature settings', () => {
    const model = minimalModel();
    (model.settings as any).temperature = undefined;
    const result = ModelSchema.safeParse(model);
    expect(result.success).toBe(false);
  });

  it('rejects a model missing maxTokens settings', () => {
    const model = minimalModel();
    (model.settings as any).maxTokens = undefined;
    const result = ModelSchema.safeParse(model);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// ModelSettingsSchema
// ============================================================================

describe('ModelSettingsSchema', () => {
  it('accepts minimal settings', () => {
    const result = ModelSettingsSchema.safeParse({ temperature: 0.7, maxTokens: 2048 });
    expect(result.success).toBe(true);
  });

  it('accepts settings with thinking', () => {
    const result = ModelSettingsSchema.safeParse({
      temperature: 0.7,
      maxTokens: 2048,
      thinking: { enabled: true, budgetTokens: 8000 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects thinking budgetTokens below 1024', () => {
    const result = ModelSettingsSchema.safeParse({
      temperature: 0.7,
      maxTokens: 2048,
      thinking: { enabled: true, budgetTokens: 500 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing temperature', () => {
    const result = ModelSettingsSchema.safeParse({ maxTokens: 2048 });
    expect(result.success).toBe(false);
  });

  it('rejects missing maxTokens', () => {
    const result = ModelSettingsSchema.safeParse({ temperature: 0.7 });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// ContentBlockSchema (discriminated union)
// ============================================================================

describe('ContentBlockSchema', () => {
  it('accepts a text content block', () => {
    const result = ContentBlockSchema.safeParse({ type: 'text', text: 'Hello world' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe('text');
  });

  it('accepts a thinking content block', () => {
    const result = ContentBlockSchema.safeParse({
      type: 'thinking',
      thinking: 'I need to consider...',
      signature: 'sig123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a redacted_thinking content block', () => {
    const result = ContentBlockSchema.safeParse({
      type: 'redacted_thinking',
      data: 'encrypted-data',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an image content block', () => {
    const result = ContentBlockSchema.safeParse({
      type: 'image',
      mimeType: 'image/png',
      data: 'base64data',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an image content block with blobId', () => {
    const result = ContentBlockSchema.safeParse({
      type: 'image',
      mimeType: 'image/jpeg',
      blobId: 'blob-123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an audio content block', () => {
    const result = ContentBlockSchema.safeParse({
      type: 'audio',
      mimeType: 'audio/mp3',
      data: 'base64audio',
      duration: 30,
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown content block type', () => {
    const result = ContentBlockSchema.safeParse({ type: 'video', src: 'video.mp4' });
    expect(result.success).toBe(false);
  });

  it('rejects text block missing text field', () => {
    const result = TextContentBlockSchema.safeParse({ type: 'text' });
    expect(result.success).toBe(false);
  });

  it('rejects thinking block missing thinking field', () => {
    const result = ThinkingContentBlockSchema.safeParse({ type: 'thinking' });
    expect(result.success).toBe(false);
  });

  it('rejects image block missing mimeType', () => {
    const result = ImageContentBlockSchema.safeParse({ type: 'image', data: 'abc' });
    expect(result.success).toBe(false);
  });

  it('rejects audio block missing data', () => {
    const result = AudioContentBlockSchema.safeParse({ type: 'audio', mimeType: 'audio/mp3' });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// PostHocOperationSchema
// ============================================================================

describe('PostHocOperationSchema', () => {
  it('accepts a valid hide operation', () => {
    const result = PostHocOperationSchema.safeParse({
      type: 'hide',
      targetMessageId: uuid(),
      targetBranchId: uuid(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts an edit operation with replacement content', () => {
    const result = PostHocOperationSchema.safeParse({
      type: 'edit',
      targetMessageId: uuid(),
      targetBranchId: uuid(),
      replacementContent: [{ type: 'text', text: 'edited content' }],
      reason: 'Fixed typo',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a hide_attachment operation with indices', () => {
    const result = PostHocOperationSchema.safeParse({
      type: 'hide_attachment',
      targetMessageId: uuid(),
      targetBranchId: uuid(),
      attachmentIndices: [0, 2],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid operation type', () => {
    const result = PostHocOperationTypeSchema.safeParse('rename');
    expect(result.success).toBe(false);
  });

  it('accepts all valid operation types', () => {
    for (const type of ['hide', 'hide_before', 'edit', 'hide_attachment', 'unhide'] as const) {
      expect(PostHocOperationTypeSchema.parse(type)).toBe(type);
    }
  });

  it('rejects missing targetMessageId', () => {
    const result = PostHocOperationSchema.safeParse({
      type: 'hide',
      targetBranchId: uuid(),
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// CreationSourceSchema
// ============================================================================

describe('CreationSourceSchema', () => {
  it.each(['inference', 'human_edit', 'regeneration', 'split', 'import', 'fork'] as const)(
    'accepts "%s"', (source) => {
      expect(CreationSourceSchema.parse(source)).toBe(source);
    }
  );

  it('rejects unknown source', () => {
    expect(CreationSourceSchema.safeParse('copy').success).toBe(false);
  });
});

// ============================================================================
// ContextManagementSchema (discriminated union)
// ============================================================================

describe('ContextManagementSchema', () => {
  it('accepts append strategy with default tokensBeforeCaching', () => {
    const result = ContextManagementSchema.parse({ strategy: 'append' });
    expect(result.strategy).toBe('append');
    expect(result.tokensBeforeCaching).toBe(10000);
  });

  it('accepts append strategy with explicit tokensBeforeCaching', () => {
    const result = ContextManagementSchema.parse({ strategy: 'append', tokensBeforeCaching: 5000 });
    expect(result.tokensBeforeCaching).toBe(5000);
  });

  it('accepts rolling strategy', () => {
    const result = ContextManagementSchema.parse({
      strategy: 'rolling',
      maxTokens: 50000,
      maxGraceTokens: 10000,
    });
    expect(result.strategy).toBe('rolling');
    expect(result.maxTokens).toBe(50000);
  });

  it('rejects rolling strategy missing maxTokens', () => {
    const result = ContextManagementSchema.safeParse({
      strategy: 'rolling',
      maxGraceTokens: 10000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown strategy', () => {
    const result = ContextManagementSchema.safeParse({ strategy: 'truncate' });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// MessageBranchSchema and MessageSchema
// ============================================================================

describe('MessageBranchSchema', () => {
  it('accepts a minimal valid branch', () => {
    const result = MessageBranchSchema.safeParse({
      id: uuid(),
      content: 'Hello',
      role: 'user',
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts a branch with content blocks', () => {
    const result = MessageBranchSchema.safeParse({
      id: uuid(),
      content: '',
      role: 'assistant',
      createdAt: new Date(),
      contentBlocks: [
        { type: 'thinking', thinking: 'Let me think...' },
        { type: 'text', text: 'Here is my answer' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid role', () => {
    const result = MessageBranchSchema.safeParse({
      id: uuid(),
      content: 'test',
      role: 'moderator',
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid roles', () => {
    for (const role of ['user', 'assistant', 'system'] as const) {
      const result = MessageBranchSchema.safeParse({
        id: uuid(),
        content: 'test',
        role,
        createdAt: new Date(),
      });
      expect(result.success).toBe(true);
    }
  });
});

describe('MessageSchema', () => {
  it('accepts a valid message with branches', () => {
    const branchId = uuid();
    const result = MessageSchema.safeParse({
      id: uuid(),
      conversationId: uuid2(),
      branches: [{
        id: branchId,
        content: 'Hello',
        role: 'user',
        createdAt: new Date(),
      }],
      activeBranchId: branchId,
      order: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects message missing order', () => {
    const result = MessageSchema.safeParse({
      id: uuid(),
      conversationId: uuid(),
      branches: [],
      activeBranchId: uuid(),
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// ParticipantSchema
// ============================================================================

describe('ParticipantSchema', () => {
  it('accepts a user participant', () => {
    const result = ParticipantSchema.safeParse({
      id: uuid(),
      conversationId: uuid(),
      name: 'Alice',
      type: 'user',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an assistant participant with model and settings', () => {
    const result = ParticipantSchema.safeParse({
      id: uuid(),
      conversationId: uuid(),
      name: 'Claude',
      type: 'assistant',
      model: 'claude-3-opus',
      systemPrompt: 'You are helpful.',
      settings: { temperature: 0.5, maxTokens: 1000 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid participant type', () => {
    const result = ParticipantSchema.safeParse({
      id: uuid(),
      conversationId: uuid(),
      name: 'Bob',
      type: 'moderator',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing name', () => {
    const result = ParticipantSchema.safeParse({
      id: uuid(),
      conversationId: uuid(),
      type: 'user',
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// UpdateParticipantSchema
// ============================================================================

describe('UpdateParticipantSchema', () => {
  it('accepts partial participant update', () => {
    const result = UpdateParticipantSchema.safeParse({ name: 'New Name' });
    expect(result.success).toBe(true);
  });

  it('passes through contextManagement when present', () => {
    const result = UpdateParticipantSchema.parse({
      contextManagement: { strategy: 'append', tokensBeforeCaching: 5000 },
    });
    expect(result.contextManagement).toEqual({ strategy: 'append', tokensBeforeCaching: 5000 });
  });

  it('passes through undefined contextManagement', () => {
    const result = UpdateParticipantSchema.parse({ name: 'Test' });
    expect(result.contextManagement).toBeUndefined();
  });

  it('accepts empty update object', () => {
    const result = UpdateParticipantSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// ConversationSchema
// ============================================================================

describe('ConversationSchema', () => {
  it('accepts a minimal valid conversation', () => {
    const result = ConversationSchema.safeParse({
      id: uuid(),
      userId: uuid(),
      title: 'My Conversation',
      model: 'claude-3-opus',
      createdAt: new Date(),
      updatedAt: new Date(),
      settings: { temperature: 0.7, maxTokens: 2048 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Check defaults
      expect(result.data.format).toBe('standard');
      expect(result.data.archived).toBe(false);
    }
  });

  it('accepts a conversation with prefill format', () => {
    const result = ConversationSchema.safeParse({
      id: uuid(),
      userId: uuid(),
      title: 'Prefill Chat',
      model: 'claude-3-opus',
      format: 'prefill',
      createdAt: new Date(),
      updatedAt: new Date(),
      settings: { temperature: 0.7, maxTokens: 2048 },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.format).toBe('prefill');
  });

  it('rejects invalid format', () => {
    const result = ConversationSchema.safeParse({
      id: uuid(),
      userId: uuid(),
      title: 'Bad Format',
      model: 'claude-3-opus',
      format: 'xml',
      createdAt: new Date(),
      updatedAt: new Date(),
      settings: { temperature: 0.7, maxTokens: 2048 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = ConversationSchema.safeParse({
      id: uuid(),
      // missing userId, title, model, etc.
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// BookmarkSchema
// ============================================================================

describe('BookmarkSchema', () => {
  it('accepts a valid bookmark', () => {
    const result = BookmarkSchema.safeParse({
      id: uuid(),
      conversationId: uuid(),
      messageId: uuid(),
      branchId: uuid(),
      label: 'Important point',
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects bookmark with non-UUID id', () => {
    const result = BookmarkSchema.safeParse({
      id: 'abc',
      conversationId: uuid(),
      messageId: uuid(),
      branchId: uuid(),
      label: 'test',
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// AttachmentSchema
// ============================================================================

describe('AttachmentSchema', () => {
  it('accepts a text attachment', () => {
    const result = AttachmentSchema.safeParse({
      id: uuid(),
      fileName: 'readme.txt',
      fileSize: 1024,
      fileType: 'txt',
      content: 'Hello world',
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.encoding).toBe('text'); // default
  });

  it('accepts a base64 encoded attachment with metadata', () => {
    const result = AttachmentSchema.safeParse({
      id: uuid(),
      fileName: 'image.png',
      fileSize: 2048,
      fileType: 'png',
      mimeType: 'image/png',
      content: 'aGVsbG8=',
      encoding: 'base64',
      createdAt: new Date(),
      metadata: { width: 800, height: 600 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid encoding', () => {
    const result = AttachmentSchema.safeParse({
      id: uuid(),
      fileName: 'test.txt',
      fileSize: 100,
      fileType: 'txt',
      content: 'test',
      encoding: 'binary',
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// InviteSchema
// ============================================================================

describe('InviteSchema', () => {
  it('accepts a valid invite', () => {
    const result = InviteSchema.safeParse({
      code: 'ABC123',
      createdBy: uuid(),
      createdAt: '2024-01-01T00:00:00Z',
      amount: 100,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe('credit');
      expect(result.data.useCount).toBe(0);
    }
  });

  it('rejects non-positive amount', () => {
    const result = InviteSchema.safeParse({
      code: 'ABC',
      createdBy: uuid(),
      createdAt: '2024-01-01',
      amount: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative amount', () => {
    const result = InviteSchema.safeParse({
      code: 'ABC',
      createdBy: uuid(),
      createdAt: '2024-01-01',
      amount: -50,
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// PersonaContextStrategySchema
// ============================================================================

describe('PersonaContextStrategySchema', () => {
  it('accepts rolling strategy', () => {
    const result = PersonaContextStrategySchema.parse({ type: 'rolling' });
    expect(result.type).toBe('rolling');
    expect(result.maxTokens).toBe(60000); // default
  });

  it('accepts anchored strategy', () => {
    const result = PersonaContextStrategySchema.parse({ type: 'anchored' });
    expect(result.type).toBe('anchored');
    expect(result.prefixTokens).toBe(10000); // default
    expect(result.rollingTokens).toBe(50000); // default
  });

  it('rejects unknown strategy type', () => {
    const result = PersonaContextStrategySchema.safeParse({ type: 'fifo' });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// PersonaPermissionSchema
// ============================================================================

describe('PersonaPermissionSchema', () => {
  it.each(['viewer', 'user', 'editor', 'owner'] as const)(
    'accepts "%s"', (perm) => {
      expect(PersonaPermissionSchema.parse(perm)).toBe(perm);
    }
  );

  it('rejects unknown permission', () => {
    expect(PersonaPermissionSchema.safeParse('admin').success).toBe(false);
  });
});

// ============================================================================
// AvatarPackSchema
// ============================================================================

describe('AvatarPackSchema', () => {
  it('accepts a valid avatar pack', () => {
    const result = AvatarPackSchema.safeParse({
      id: 'default',
      name: 'Default Pack',
      avatars: { 'claude-3-opus': 'opus.png' },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isSystem).toBe(false); // default
  });

  it('rejects avatar pack missing avatars', () => {
    const result = AvatarPackSchema.safeParse({
      id: 'broken',
      name: 'Broken Pack',
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// PrefillSettingsSchema
// ============================================================================

describe('PrefillSettingsSchema', () => {
  it('applies defaults', () => {
    const result = PrefillSettingsSchema.parse({});
    expect(result.enabled).toBe(true);
    expect(result.content).toBe('<cmd>cat untitled.log</cmd>');
  });

  it('overrides defaults', () => {
    const result = PrefillSettingsSchema.parse({ enabled: false, content: 'custom' });
    expect(result.enabled).toBe(false);
    expect(result.content).toBe('custom');
  });
});

// ============================================================================
// SiteConfigSchema
// ============================================================================

describe('SiteConfigSchema', () => {
  it('applies all defaults for empty input', () => {
    const result = SiteConfigSchema.parse({});
    expect(result.branding.name).toBe('Arc Chat');
    expect(result.branding.tagline).toBe('Multi-agent conversations');
    expect(result.branding.logoVariant).toBe('arc');
    expect(result.links.discord).toBeNull();
    expect(result.links.github).toBeNull();
    expect(result.operator.name).toBe('Arc Chat Team');
    expect(result.features.showTestimonials).toBe(false);
    expect(result.features.showPhilosophy).toBe(false);
  });

  it('accepts a fully customized config', () => {
    const result = SiteConfigSchema.safeParse({
      branding: { name: 'My Chat', tagline: 'Cool chat', logoVariant: 'custom' },
      links: { discord: 'https://discord.gg/test', github: 'https://github.com/test' },
      operator: { name: 'My Org', contactEmail: 'admin@test.com' },
      features: { showTestimonials: true, showVoices: true },
      content: {
        aboutSections: [{ id: 'intro', content: 'Welcome!' }],
        testimonials: [{ id: 't1', author: 'Alice', content: 'Great tool!' }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid logoVariant', () => {
    const result = SiteConfigSchema.safeParse({
      branding: { logoVariant: 'invalid' },
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// WsMessageSchema (discriminated union)
// ============================================================================

describe('WsMessageSchema', () => {
  it('accepts a chat message', () => {
    const result = WsMessageSchema.safeParse({
      type: 'chat',
      conversationId: uuid(),
      messageId: uuid(),
      content: 'Hello',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a ping message', () => {
    const result = WsMessageSchema.safeParse({ type: 'ping' });
    expect(result.success).toBe(true);
  });

  it('accepts an abort message', () => {
    const result = WsMessageSchema.safeParse({
      type: 'abort',
      conversationId: uuid(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts a regenerate message', () => {
    const result = WsMessageSchema.safeParse({
      type: 'regenerate',
      conversationId: uuid(),
      messageId: uuid(),
      branchId: uuid(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts a join_room message', () => {
    const result = WsMessageSchema.safeParse({
      type: 'join_room',
      conversationId: uuid(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown message type', () => {
    const result = WsMessageSchema.safeParse({ type: 'subscribe' });
    expect(result.success).toBe(false);
  });

  it('rejects chat message missing content', () => {
    const result = WsMessageSchema.safeParse({
      type: 'chat',
      conversationId: uuid(),
      messageId: uuid(),
    });
    expect(result.success).toBe(false);
  });

  it('validates samplingBranches range (1-10)', () => {
    const base = {
      type: 'chat',
      conversationId: uuid(),
      messageId: uuid(),
      content: 'test',
    };
    expect(WsMessageSchema.safeParse({ ...base, samplingBranches: 1 }).success).toBe(true);
    expect(WsMessageSchema.safeParse({ ...base, samplingBranches: 10 }).success).toBe(true);
    expect(WsMessageSchema.safeParse({ ...base, samplingBranches: 0 }).success).toBe(false);
    expect(WsMessageSchema.safeParse({ ...base, samplingBranches: 11 }).success).toBe(false);
  });
});

// ============================================================================
// getValidatedModelDefaults
// ============================================================================

describe('getValidatedModelDefaults', () => {
  it('returns temperature and maxTokens from model settings', () => {
    const model = ModelSchema.parse(minimalModel());
    const defaults = getValidatedModelDefaults(model);
    expect(defaults.temperature).toBe(0.7);
    expect(defaults.maxTokens).toBe(2048);
  });

  it('clamps maxTokens to outputTokenLimit when it is lower', () => {
    const model = ModelSchema.parse({
      ...minimalModel(),
      outputTokenLimit: 1000, // lower than default 2048
    });
    const defaults = getValidatedModelDefaults(model);
    expect(defaults.maxTokens).toBe(1000);
  });

  it('clamps maxTokens to settings.maxTokens.max when it is lower', () => {
    const model = ModelSchema.parse({
      ...minimalModel(),
      outputTokenLimit: 10000,
      settings: {
        temperature: { min: 0, max: 1, default: 0.7, step: 0.1 },
        maxTokens: { min: 1, max: 500, default: 2048 }, // max is 500, lower than default
      },
    });
    const defaults = getValidatedModelDefaults(model);
    expect(defaults.maxTokens).toBe(500);
  });

  it('does not include topP/topK for anthropic provider', () => {
    const model = ModelSchema.parse({
      ...minimalModel(),
      provider: 'anthropic',
      settings: {
        ...minimalModel().settings,
        topP: { min: 0, max: 1, default: 0.9, step: 0.05 },
      },
    });
    const defaults = getValidatedModelDefaults(model);
    expect(defaults.topP).toBeUndefined();
  });

  it('does not include topP/topK for bedrock provider', () => {
    const model = ModelSchema.parse({
      ...minimalModel(),
      provider: 'bedrock',
      settings: {
        ...minimalModel().settings,
        topP: { min: 0, max: 1, default: 0.9, step: 0.05 },
        topK: { min: 0, max: 500, default: 250, step: 1 },
      },
    });
    const defaults = getValidatedModelDefaults(model);
    expect(defaults.topP).toBeUndefined();
    expect(defaults.topK).toBeUndefined();
  });

  it('includes topP/topK for openrouter provider', () => {
    const model = ModelSchema.parse({
      ...minimalModel(),
      provider: 'openrouter',
      settings: {
        ...minimalModel().settings,
        topP: { min: 0, max: 1, default: 0.9, step: 0.05 },
        topK: { min: 0, max: 500, default: 250, step: 1 },
      },
    });
    const defaults = getValidatedModelDefaults(model);
    expect(defaults.topP).toBe(0.9);
    expect(defaults.topK).toBe(250);
  });

  it('includes thinking settings when model supports thinking', () => {
    const model = ModelSchema.parse({
      ...minimalModel(),
      supportsThinking: true,
      thinkingDefaultEnabled: true,
    });
    const defaults = getValidatedModelDefaults(model);
    expect(defaults.thinking).toEqual({ enabled: true, budgetTokens: 8000 });
  });

  it('defaults thinking enabled to false when thinkingDefaultEnabled is not set', () => {
    const model = ModelSchema.parse({
      ...minimalModel(),
      supportsThinking: true,
    });
    const defaults = getValidatedModelDefaults(model);
    expect(defaults.thinking).toEqual({ enabled: false, budgetTokens: 8000 });
  });

  it('does not include thinking when model does not support it', () => {
    const model = ModelSchema.parse(minimalModel());
    const defaults = getValidatedModelDefaults(model);
    expect(defaults.thinking).toBeUndefined();
  });

  it('includes modelSpecific defaults from configurableSettings', () => {
    const model = ModelSchema.parse({
      ...minimalModel(),
      configurableSettings: [
        { type: 'select', key: 'outputFormat', label: 'Format', options: [{ value: 'json', label: 'JSON' }], default: 'json' },
        { type: 'boolean', key: 'verbose', label: 'Verbose', default: true },
      ],
    });
    const defaults = getValidatedModelDefaults(model);
    expect(defaults.modelSpecific).toEqual({
      outputFormat: 'json',
      verbose: true,
    });
  });

  it('does not include modelSpecific when no configurableSettings', () => {
    const model = ModelSchema.parse(minimalModel());
    const defaults = getValidatedModelDefaults(model);
    expect(defaults.modelSpecific).toBeUndefined();
  });

  it('skips configurable settings with no default value', () => {
    const model = ModelSchema.parse({
      ...minimalModel(),
      configurableSettings: [
        { type: 'text', key: 'prefix', label: 'Prefix' }, // text settings have optional default
        { type: 'boolean', key: 'verbose', label: 'Verbose', default: true },
      ],
    });
    const defaults = getValidatedModelDefaults(model);
    // Only verbose should be included since text setting has no default
    expect(defaults.modelSpecific).toEqual({ verbose: true });
  });

  it('includes topP without topK for non-anthropic provider', () => {
    const model = ModelSchema.parse({
      ...minimalModel(),
      provider: 'openrouter',
      settings: {
        ...minimalModel().settings,
        topP: { min: 0, max: 1, default: 0.95, step: 0.05 },
        // no topK
      },
    });
    const defaults = getValidatedModelDefaults(model);
    expect(defaults.topP).toBe(0.95);
    expect(defaults.topK).toBeUndefined();
  });

  it('omits topP and topK when non-anthropic has neither', () => {
    const model = ModelSchema.parse({
      ...minimalModel(),
      provider: 'google',
      // no topP or topK in settings
    });
    const defaults = getValidatedModelDefaults(model);
    expect(defaults.topP).toBeUndefined();
    expect(defaults.topK).toBeUndefined();
  });
});

// ============================================================================
// deriveCanonicalId
// ============================================================================

describe('deriveCanonicalId', () => {
  it('removes provider prefix', () => {
    expect(deriveCanonicalId('anthropic/claude-3-sonnet')).toBe('claude-3-sonnet');
    expect(deriveCanonicalId('openai/gpt-4')).toBe('gpt-4');
  });

  it('removes date suffixes', () => {
    expect(deriveCanonicalId('claude-3-opus-20240229')).toBe('claude-3-opus');
    // GPT normalization further simplifies: gpt-4-turbo -> gpt-4turbo
    expect(deriveCanonicalId('gpt-4-turbo-2024-04-09')).toBe('gpt-4turbo');
  });

  it('removes version suffixes', () => {
    expect(deriveCanonicalId('model-v1')).toBe('model');
    expect(deriveCanonicalId('model:latest')).toBe('model');
    expect(deriveCanonicalId('model-preview')).toBe('model');
    expect(deriveCanonicalId('model-beta')).toBe('model');
  });

  it('lowercases the input', () => {
    expect(deriveCanonicalId('Claude-3-Opus')).toBe('claude-3-opus');
  });

  it('normalizes Gemini models', () => {
    const result = deriveCanonicalId('gemini-1.5-pro-latest');
    // After removing -latest suffix and normalizing
    expect(result).toContain('gemini');
    expect(result).toContain('1.5');
    expect(result).toContain('pro');
  });

  it('removes models/ prefix for Gemini', () => {
    const result = deriveCanonicalId('models/gemini-2.0-flash');
    expect(result.startsWith('models/')).toBe(false);
  });

  it('cleans up double hyphens', () => {
    const result = deriveCanonicalId('test--model');
    expect(result).not.toContain('--');
  });

  it('uses display name when result is very long', () => {
    const longId = 'a'.repeat(40);
    const result = deriveCanonicalId(longId, 'Short Name');
    expect(result).toBe('short-name');
  });

  it('does not use display name when it would be longer', () => {
    const result = deriveCanonicalId('gpt-4', 'A Very Long Display Name Indeed');
    expect(result).toBe('gpt-4');
  });

  it('normalizes Claude models with dot notation', () => {
    expect(deriveCanonicalId('anthropic.claude-3-5-sonnet')).toBe('claude-3-5-sonnet');
  });

  it('normalizes Claude opus/sonnet style models', () => {
    expect(deriveCanonicalId('claude-opus-4-5')).toBe('claude-opus-4');
  });

  it('normalizes Llama models', () => {
    expect(deriveCanonicalId('meta-llama-3.1-70b')).toBe('llama-3.1');
    expect(deriveCanonicalId('llama-3-8b')).toBe('llama-3');
  });

  it('normalizes Mistral models', () => {
    expect(deriveCanonicalId('mistral-large')).toBe('mistral-large');
    expect(deriveCanonicalId('mistral-small')).toBe('mistral-small');
  });

  it('does not normalize GPT-4o-mini (4o has non-digit char)', () => {
    // The GPT regex only matches gpt-(\d+\.?\d*), so "4o" doesn't match
    expect(deriveCanonicalId('gpt-4o-mini')).toBe('gpt-4o-mini');
  });

  it('does not use display name when display name is longer than result', () => {
    const longId = 'a'.repeat(40);
    const longerDisplayName = 'A '.repeat(30).trim(); // generates a long display name
    const result = deriveCanonicalId(longId, longerDisplayName);
    // The display name simplified would be longer, so keep the id
    expect(result).toBe(longId);
  });

  it('handles model with no matching normalization pattern', () => {
    const result = deriveCanonicalId('custom-model-name');
    expect(result).toBe('custom-model-name');
  });

  it('removes exp/experimental suffixes', () => {
    expect(deriveCanonicalId('gemini-2.0-flash-exp')).toContain('gemini');
    expect(deriveCanonicalId('gemini-2.0-flash-exp')).not.toContain('exp');
  });
});
