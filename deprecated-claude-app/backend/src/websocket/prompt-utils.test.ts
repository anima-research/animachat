import { describe, it, expect } from 'vitest';
import {
  applyBackroomPromptIfNeeded,
  applyIdentityPromptIfNeeded,
  BACKROOM_PROMPT,
  type BackroomPromptParams,
  type IdentityPromptParams,
} from './prompt-utils.js';

// ============================================================================
// applyBackroomPromptIfNeeded
// ============================================================================

describe('applyBackroomPromptIfNeeded', () => {
  function defaultParams(overrides?: Partial<BackroomPromptParams>): BackroomPromptParams {
    return {
      conversationFormat: 'prefill',
      messageCount: 5,
      modelProvider: 'anthropic',
      existingSystemPrompt: '',
      ...overrides,
    };
  }

  // --- Core behavior: when it SHOULD apply ---

  it('returns BACKROOM_PROMPT for prefill format with anthropic provider and few messages', () => {
    const result = applyBackroomPromptIfNeeded(defaultParams());
    expect(result).toBe(BACKROOM_PROMPT);
  });

  it('prepends BACKROOM_PROMPT to existing system prompt', () => {
    const result = applyBackroomPromptIfNeeded(defaultParams({
      existingSystemPrompt: 'Be helpful.',
    }));
    expect(result).toBe(`${BACKROOM_PROMPT}\n\nBe helpful.`);
  });

  it('applies for bedrock provider', () => {
    const result = applyBackroomPromptIfNeeded(defaultParams({
      modelProvider: 'bedrock',
    }));
    expect(result).toBe(BACKROOM_PROMPT);
  });

  it('applies for non-native provider with modelSupportsPrefill=true', () => {
    const result = applyBackroomPromptIfNeeded(defaultParams({
      modelProvider: 'openrouter',
      modelSupportsPrefill: true,
    }));
    expect(result).toBe(BACKROOM_PROMPT);
  });

  it('applies when participantConversationMode is "auto"', () => {
    const result = applyBackroomPromptIfNeeded(defaultParams({
      participantConversationMode: 'auto',
    }));
    expect(result).toBe(BACKROOM_PROMPT);
  });

  it('applies when participantConversationMode is "prefill"', () => {
    const result = applyBackroomPromptIfNeeded(defaultParams({
      participantConversationMode: 'prefill',
    }));
    expect(result).toBe(BACKROOM_PROMPT);
  });

  it('applies when participantConversationMode is undefined', () => {
    const result = applyBackroomPromptIfNeeded(defaultParams({
      participantConversationMode: undefined,
    }));
    expect(result).toBe(BACKROOM_PROMPT);
  });

  // --- When it should NOT apply ---

  it('does NOT apply for standard format', () => {
    const result = applyBackroomPromptIfNeeded(defaultParams({
      conversationFormat: 'standard',
      existingSystemPrompt: 'My prompt',
    }));
    expect(result).toBe('My prompt');
  });

  it('does NOT apply when message count >= default threshold (10)', () => {
    const result = applyBackroomPromptIfNeeded(defaultParams({
      messageCount: 10,
      existingSystemPrompt: 'My prompt',
    }));
    expect(result).toBe('My prompt');
  });

  it('does NOT apply when message count exceeds custom threshold', () => {
    const result = applyBackroomPromptIfNeeded(defaultParams({
      messageCount: 5,
      cliModePrompt: { enabled: true, messageThreshold: 3 },
      existingSystemPrompt: 'My prompt',
    }));
    expect(result).toBe('My prompt');
  });

  it('does NOT apply when cliModePrompt is disabled', () => {
    const result = applyBackroomPromptIfNeeded(defaultParams({
      cliModePrompt: { enabled: false, messageThreshold: 10 },
      existingSystemPrompt: 'My prompt',
    }));
    expect(result).toBe('My prompt');
  });

  it('does NOT apply when model does not support prefill (e.g. openrouter without flag)', () => {
    const result = applyBackroomPromptIfNeeded(defaultParams({
      modelProvider: 'openrouter',
      modelSupportsPrefill: false,
      existingSystemPrompt: 'My prompt',
    }));
    expect(result).toBe('My prompt');
  });

  it('does NOT apply when participant mode is "messages"', () => {
    const result = applyBackroomPromptIfNeeded(defaultParams({
      participantConversationMode: 'messages',
      existingSystemPrompt: 'My prompt',
    }));
    expect(result).toBe('My prompt');
  });

  it('does NOT apply when participant mode is "completion"', () => {
    const result = applyBackroomPromptIfNeeded(defaultParams({
      participantConversationMode: 'completion',
      existingSystemPrompt: 'My prompt',
    }));
    expect(result).toBe('My prompt');
  });

  // --- Edge cases ---

  it('uses default threshold of 10 when cliModePrompt is not provided', () => {
    // 9 messages = under threshold, should apply
    const result9 = applyBackroomPromptIfNeeded(defaultParams({ messageCount: 9 }));
    expect(result9).toBe(BACKROOM_PROMPT);

    // 10 messages = at threshold, should NOT apply
    const result10 = applyBackroomPromptIfNeeded(defaultParams({ messageCount: 10 }));
    expect(result10).toBe('');
  });

  it('uses custom threshold from cliModePrompt', () => {
    const params = defaultParams({
      cliModePrompt: { enabled: true, messageThreshold: 5 },
    });

    // 4 messages = under custom threshold, should apply
    const result4 = applyBackroomPromptIfNeeded({ ...params, messageCount: 4 });
    expect(result4).toBe(BACKROOM_PROMPT);

    // 5 messages = at custom threshold, should NOT apply
    const result5 = applyBackroomPromptIfNeeded({ ...params, messageCount: 5 });
    expect(result5).toBe('');
  });

  it('returns empty string when existingSystemPrompt is empty and conditions do not match', () => {
    const result = applyBackroomPromptIfNeeded(defaultParams({
      conversationFormat: 'standard',
      existingSystemPrompt: '',
    }));
    expect(result).toBe('');
  });

  it('BACKROOM_PROMPT constant has expected content', () => {
    expect(BACKROOM_PROMPT).toContain('CLI simulation mode');
    expect(BACKROOM_PROMPT).toContain('output of the command');
  });
});

// ============================================================================
// applyIdentityPromptIfNeeded
// ============================================================================

describe('applyIdentityPromptIfNeeded', () => {
  function defaultParams(overrides?: Partial<IdentityPromptParams>): IdentityPromptParams {
    return {
      conversationFormat: 'prefill',
      participantName: 'Claude',
      modelProvider: 'openrouter', // does NOT support prefill natively
      existingSystemPrompt: '',
      hasCustomSystemPrompt: false,
      ...overrides,
    };
  }

  const expectedIdentityPrompt = (name: string) =>
    `You are ${name}. You are connected to a multi-participant chat system. Please respond in character.`;

  // --- When it SHOULD apply ---

  it('applies identity prompt for messages mode (explicit)', () => {
    const result = applyIdentityPromptIfNeeded(defaultParams({
      participantConversationMode: 'messages',
    }));
    expect(result).toBe(expectedIdentityPrompt('Claude'));
  });

  it('applies identity prompt for completion mode (explicit)', () => {
    const result = applyIdentityPromptIfNeeded(defaultParams({
      participantConversationMode: 'completion',
    }));
    expect(result).toBe(expectedIdentityPrompt('Claude'));
  });

  it('applies identity prompt when auto mode falls back to messages (no prefill support)', () => {
    const result = applyIdentityPromptIfNeeded(defaultParams({
      participantConversationMode: 'auto',
      modelProvider: 'openrouter',
      modelSupportsPrefill: false,
    }));
    expect(result).toBe(expectedIdentityPrompt('Claude'));
  });

  it('applies identity prompt when mode is undefined and model has no prefill support', () => {
    const result = applyIdentityPromptIfNeeded(defaultParams({
      participantConversationMode: undefined,
      modelProvider: 'openrouter',
    }));
    expect(result).toBe(expectedIdentityPrompt('Claude'));
  });

  it('prepends identity prompt to existing system prompt', () => {
    const result = applyIdentityPromptIfNeeded(defaultParams({
      participantConversationMode: 'messages',
      existingSystemPrompt: 'Be concise.',
    }));
    expect(result).toBe(`${expectedIdentityPrompt('Claude')}\n\nBe concise.`);
  });

  it('uses the participant name in the identity prompt', () => {
    const result = applyIdentityPromptIfNeeded(defaultParams({
      participantName: 'Sonnet',
      participantConversationMode: 'messages',
    }));
    expect(result).toContain('You are Sonnet.');
  });

  // --- When it should NOT apply ---

  it('does NOT apply for standard format', () => {
    const result = applyIdentityPromptIfNeeded(defaultParams({
      conversationFormat: 'standard',
      existingSystemPrompt: 'My prompt',
    }));
    expect(result).toBe('My prompt');
  });

  it('does NOT apply when participant has custom system prompt', () => {
    const result = applyIdentityPromptIfNeeded(defaultParams({
      hasCustomSystemPrompt: true,
      participantConversationMode: 'messages',
      existingSystemPrompt: 'I am a specific character.',
    }));
    expect(result).toBe('I am a specific character.');
  });

  it('does NOT apply when using prefill mode with anthropic provider', () => {
    const result = applyIdentityPromptIfNeeded(defaultParams({
      modelProvider: 'anthropic',
      participantConversationMode: 'auto',
      existingSystemPrompt: 'My prompt',
    }));
    // anthropic supports prefill, so auto -> prefill, no identity needed
    expect(result).toBe('My prompt');
  });

  it('does NOT apply when using prefill mode with bedrock provider', () => {
    const result = applyIdentityPromptIfNeeded(defaultParams({
      modelProvider: 'bedrock',
      existingSystemPrompt: 'My prompt',
    }));
    expect(result).toBe('My prompt');
  });

  it('does NOT apply when participant mode is explicitly "prefill"', () => {
    const result = applyIdentityPromptIfNeeded(defaultParams({
      participantConversationMode: 'prefill',
      existingSystemPrompt: 'My prompt',
    }));
    expect(result).toBe('My prompt');
  });

  it('does NOT apply when model supports prefill via flag (auto mode)', () => {
    const result = applyIdentityPromptIfNeeded(defaultParams({
      modelProvider: 'openrouter',
      modelSupportsPrefill: true,
      participantConversationMode: 'auto',
      existingSystemPrompt: 'My prompt',
    }));
    expect(result).toBe('My prompt');
  });

  // --- Edge cases ---

  it('returns empty string when standard format and no existing prompt', () => {
    const result = applyIdentityPromptIfNeeded(defaultParams({
      conversationFormat: 'standard',
      existingSystemPrompt: '',
    }));
    expect(result).toBe('');
  });

  it('handles empty participant name', () => {
    const result = applyIdentityPromptIfNeeded(defaultParams({
      participantName: '',
      participantConversationMode: 'messages',
    }));
    expect(result).toContain('You are .');
  });

  it('applies when auto mode and google provider (does not support prefill natively)', () => {
    const result = applyIdentityPromptIfNeeded(defaultParams({
      modelProvider: 'google',
      participantConversationMode: 'auto',
    }));
    expect(result).toBe(expectedIdentityPrompt('Claude'));
  });

  it('still applies identity for explicit messages mode even if model supports prefill', () => {
    // If participant explicitly chose messages mode, identity prompt is needed
    // regardless of model capabilities
    const result = applyIdentityPromptIfNeeded(defaultParams({
      modelProvider: 'anthropic',
      participantConversationMode: 'messages',
    }));
    expect(result).toBe(expectedIdentityPrompt('Claude'));
  });
});
