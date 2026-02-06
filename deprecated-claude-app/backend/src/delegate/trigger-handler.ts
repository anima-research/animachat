// Vendored from @deprecated-claude/backend
// Original location: node_modules/@deprecated-claude/backend/src/delegate/trigger-handler.ts

/**
 * Trigger Handler
 *
 * Handles external event triggers from delegates.
 * When a delegate receives a webhook (e.g., GitLab push), it sends
 * a TriggerInference message to the server, which creates a message
 * in the specified conversation and runs inference.
 *
 * Flow:
 *   GitLab/GitHub → POST delegate webhook → delegate parses event
 *   → delegate sends trigger_inference via WS → delegate-handler.ts
 *   → triggerHandler.handleTrigger() → creates messages + runs inference
 *   → response streams to chat UI + returned to delegate
 */

import { Database } from '../database/index.js';
import { MembraneInferenceService } from '../services/membrane-inference.js';
import { EnhancedInferenceService } from '../services/enhanced-inference.js';
import { ContextManager } from '../services/context-manager.js';
import { ModelLoader } from '../config/model-loader.js';
import { toolRegistry } from '../tools/tool-registry.js';
import { roomManager } from '../websocket/room-manager.js';
import type { ToolCall, ToolResult } from '../tools/tool-registry.js';
import type { TriggerInferenceMessage, TriggerInferenceResultMessage } from './protocol.js';

class TriggerHandler {
  /**
   * Handle a trigger inference request from a delegate.
   *
   * Steps:
   * 1. Validate conversation exists
   * 2. Add trigger context as a user message
   * 3. Create assistant response placeholder
   * 4. Run inference (streams to connected UI clients)
   * 5. Return the model's response to the delegate
   */
  async handleTrigger(
    msg: TriggerInferenceMessage,
    userId: string,
    db: Database
  ): Promise<TriggerInferenceResultMessage> {
    const triggerId = msg.triggerId;
    console.log(`[TriggerHandler] Received trigger "${triggerId}" from source "${msg.source}" for user ${userId}`);

    // 1. Validate conversation exists
    if (!msg.conversationId) {
      return {
        type: 'trigger_inference_result',
        triggerId,
        success: false,
        error: 'conversationId is required',
      };
    }

    let conversation;
    try {
      conversation = await db.getConversation(msg.conversationId, userId);
      if (!conversation) {
        return {
          type: 'trigger_inference_result',
          triggerId,
          success: false,
          error: `Conversation ${msg.conversationId} not found or not accessible`,
        };
      }
    } catch (error) {
      return {
        type: 'trigger_inference_result',
        triggerId,
        success: false,
        error: `Failed to access conversation: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // 2. Build trigger context message
    const contextText = this.formatTriggerContext(msg);
    console.log(`[TriggerHandler] Trigger context:\n${contextText}`);

    // 3. Add trigger message to conversation as a user message
    let triggerMessage;
    try {
      triggerMessage = await db.createMessage(
        msg.conversationId,
        userId,
        `[Webhook: ${msg.source}]\n${contextText}`,
        'user',
        undefined,    // model
        undefined,    // parent branch (auto-determined)
        undefined,    // participantId
        undefined,    // attachments
        userId,       // sentByUserId
        false,        // hiddenFromAi
        'inference'   // creationSource
      );
    } catch (error) {
      return {
        type: 'trigger_inference_result',
        triggerId,
        success: false,
        error: `Failed to create trigger message: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // Broadcast trigger message to connected UI clients
    roomManager.broadcastToRoom(msg.conversationId, {
      type: 'message_created',
      conversationId: msg.conversationId,
      message: triggerMessage,
    });
    console.log(`[TriggerHandler] Trigger message added: ${triggerMessage.id}`);

    // 4. Get participants and find responder
    const participants = await db.getConversationParticipants(msg.conversationId, userId);
    const responder = msg.participantId
      ? participants.find(p => p.id === msg.participantId)
      : participants.find(p => p.type === 'assistant');

    if (!responder) {
      return {
        type: 'trigger_inference_result',
        triggerId,
        success: false,
        error: 'No assistant participant found in conversation',
      };
    }

    // 5. Get model config
    const modelLoader = ModelLoader.getInstance();
    const model = await modelLoader.getModelById(
      conversation.model || 'claude-sonnet-4-20250514',
      userId
    );
    if (!model) {
      return {
        type: 'trigger_inference_result',
        triggerId,
        success: false,
        error: `Model ${conversation.model} not found`,
      };
    }

    // 6. Create assistant response placeholder
    let assistantMessage;
    try {
      assistantMessage = await db.createMessage(
        msg.conversationId,
        userId,
        '',             // empty, filled by inference
        'assistant',
        model.id,
        triggerMessage.activeBranchId,  // parent is the trigger message
        responder.id,
        undefined,      // attachments
        undefined,      // sentByUserId
        false,          // hiddenFromAi
        'inference'     // creationSource
      );
    } catch (error) {
      return {
        type: 'trigger_inference_result',
        triggerId,
        success: false,
        error: `Failed to create assistant message: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // Broadcast assistant message placeholder to UI
    roomManager.broadcastToRoom(msg.conversationId, {
      type: 'message_created',
      conversationId: msg.conversationId,
      message: assistantMessage,
    });

    // 7. Get conversation messages for context
    const messages = await db.getConversationMessages(msg.conversationId, userId);

    // 8. Build system prompt and settings
    const systemPrompt = responder.systemPrompt || msg.systemMessage || '';

    // Merge settings: conversation settings with participant overrides (same pattern as handler.ts)
    const inferenceSettings = conversation.format === 'standard'
      ? conversation.settings
      : {
          temperature: (responder as any).settings?.temperature ?? conversation.settings.temperature,
          maxTokens: (responder as any).settings?.maxTokens ?? conversation.settings.maxTokens,
          topP: (responder as any).settings?.topP ?? conversation.settings.topP,
          topK: (responder as any).settings?.topK ?? conversation.settings.topK,
          thinking: conversation.settings.thinking,
        };

    // 9. Create inference service (same pattern as websocket handler)
    const baseInferenceService = new MembraneInferenceService(db);
    const contextManager = new ContextManager();
    const inferenceService = new EnhancedInferenceService(baseInferenceService, contextManager);

    // 10. Build tool options (delegate tools available to this user)
    const tools = toolRegistry.getToolsForUser(userId);
    const toolOptions = tools.length > 0 ? {
      tools,
      executeToolCall: async (call: ToolCall): Promise<ToolResult> => {
        return toolRegistry.executeTool(call, userId);
      },
    } : undefined;

    // 11. Run inference
    let fullResponse = '';
    const branchId = assistantMessage.activeBranchId;

    console.log(`[TriggerHandler] Starting inference for trigger "${triggerId}" (model: ${model.id})`);

    try {
      await inferenceService.streamCompletion(
        model,
        messages,
        systemPrompt,
        inferenceSettings,
        userId,
        async (chunk: string, isComplete: boolean, contentBlocks?: any[], usage?: any) => {
          fullResponse += chunk;

          // Broadcast streaming chunks to connected UI clients
          roomManager.broadcastToRoom(msg.conversationId!, {
            type: 'stream',
            conversationId: msg.conversationId,
            messageId: assistantMessage.id,
            branchId,
            content: chunk,
            contentBlocks,
            isComplete,
          });

          // Save content on complete
          if (isComplete) {
            await db.updateMessageContent(
              assistantMessage.id,
              msg.conversationId!,
              userId,
              branchId,
              fullResponse,
              contentBlocks
            );
            console.log(`[TriggerHandler] Inference complete for trigger "${triggerId}" (${fullResponse.length} chars)`);
          }
        },
        conversation,
        responder,
        undefined,        // onMetrics (skip for triggers)
        participants,
        undefined,        // abortSignal
        toolOptions
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[TriggerHandler] Inference error for trigger "${triggerId}":`, errorMsg);
      return {
        type: 'trigger_inference_result',
        triggerId,
        success: false,
        error: `Inference failed: ${errorMsg}`,
      };
    }

    // 12. Return success with the model's response
    return {
      type: 'trigger_inference_result',
      triggerId,
      success: true,
      conversationId: msg.conversationId,
      messageId: assistantMessage.id,
      response: fullResponse,
    };
  }

  /**
   * Format trigger context into a readable message.
   */
  private formatTriggerContext(msg: TriggerInferenceMessage): string {
    const lines: string[] = [];
    lines.push(`Source: ${msg.source}`);

    if (msg.systemMessage) {
      lines.push(`Message: ${msg.systemMessage}`);
    }

    // Format common webhook context fields
    const ctx = msg.context;
    if (ctx.event) lines.push(`Event: ${ctx.event}`);
    if (ctx.branch) lines.push(`Branch: ${ctx.branch}`);
    if (ctx.repository) lines.push(`Repository: ${ctx.repository}`);

    if (ctx.commits && Array.isArray(ctx.commits)) {
      lines.push(`Commits:`);
      for (const commit of ctx.commits) {
        const c = commit as any;
        lines.push(`  - ${c.message || c.id} (by ${c.author?.email || c.author || 'unknown'})`);
      }
    }

    return lines.join('\n');
  }
}

export const triggerHandler = new TriggerHandler();
