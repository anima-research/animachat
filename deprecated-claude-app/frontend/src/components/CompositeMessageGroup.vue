<template>
  <div class="composite-message-group">
    <!-- Collapsed view: combined content -->
    <div 
      v-if="!isExpanded && messages.length > 1" 
      :class="['message-container', isUserMessage ? 'user-message' : 'assistant-message', 'composite-collapsed']"
      @click="expand"
    >
      <!-- Info line (matching MessageComponent layout) -->
      <div class="info-row">
        <div class="d-flex align-center flex-wrap" style="gap: 4px;">
          <v-avatar v-if="avatarUrl" size="32" class="message-avatar">
            <v-img :src="avatarUrl" :alt="participantName" />
          </v-avatar>
          <v-icon
            v-else
            :icon="isUserMessage ? 'mdi-account' : 'mdi-robot'"
            :color="participantColor"
            size="small"
          />
          <span class="message-name font-weight-medium" :style="participantColor ? `color: ${participantColor};` : ''">
            {{ participantName }}
          </span>
          
          <!-- Models in group -->
          <span v-for="model in modelsInGroup" :key="model" class="text-caption text-grey-darken-1 ml-1">
            {{ formatModelName(model) }}
          </span>
          
          <!-- Combined count -->
          <v-chip size="x-small" variant="tonal" color="primary" class="ml-1">
            {{ messages.length }} msgs
          </v-chip>
          
          <!-- Branch info if any -->
          <v-chip v-if="branchStats.hasBranches" size="x-small" variant="outlined" color="grey" class="ml-1">
            <v-icon size="12" class="mr-1">mdi-source-branch</v-icon>
            {{ branchStats.totalBranches }} branches
          </v-chip>
          
          <!-- Authenticity icon for group -->
          <AuthenticityIcon 
            v-if="groupAuthenticityLevel" 
            :level="groupAuthenticityLevel" 
            :size="16"
            class="ml-1"
          />
        </div>
        
        <!-- Expand button -->
        <v-btn
          icon="mdi-unfold-more-horizontal"
          size="x-small"
          variant="text"
          density="compact"
          title="Click to expand individual messages"
          @click.stop="expand"
        />
      </div>
      
      <!-- Combined content -->
      <div class="message-content" v-html="combinedRenderedContent" />
    </div>
    
    <!-- Expanded view or single message: show individual MessageComponents -->
    <template v-else>
      <div v-if="messages.length > 1" class="expanded-header d-flex align-center justify-end">
        <v-btn
          size="x-small"
          variant="text"
          density="compact"
          color="grey"
          @click="collapse"
        >
          <v-icon size="14" class="mr-1">mdi-unfold-less-horizontal</v-icon>
          Collapse
        </v-btn>
      </div>
      <MessageComponent
        v-for="(message, index) in messages"
        :id="`message-${message.id}`"
        :key="message.id"
        :message="message"
        :participants="participants"
        :is-selected-parent="selectedParentCheck(message)"
        :is-last-message="isLastGroup && index === messages.length - 1"
        :is-streaming="streamingCheck(message)"
        :has-error="errorCheck(message)"
        :error-message="getErrorMessage(message)"
        :error-suggestion="getErrorSuggestion(message)"
        :post-hoc-affected="postHocAffected(message)"
        :show-stuck-button="showStuckButton && streamingCheck(message)"
        :authenticity-status="getAuthenticityStatus(message)"
        @regenerate="(msgId: string, branchId: string) => emit('regenerate', msgId, branchId)"
        @stuck-clicked="() => emit('stuck-clicked')"
        @edit="(msgId: string, branchId: string, content: string) => emit('edit', msgId, branchId, content)"
        @edit-only="(msgId: string, branchId: string, content: string) => emit('edit-only', msgId, branchId, content)"
        @switch-branch="(msgId: string, branchId: string) => emit('switch-branch', msgId, branchId)"
        @delete="(msgId: string, branchId: string) => emit('delete', msgId, branchId)"
        @delete-all-branches="(msgId: string) => emit('delete-all-branches', msgId)"
        @select-as-parent="(msgId: string, branchId: string) => emit('select-as-parent', msgId, branchId)"
        @stop-auto-scroll="() => emit('stop-auto-scroll')"
        @bookmark-changed="() => emit('bookmark-changed')"
        @post-hoc-hide="(msgId: string, branchId: string) => emit('post-hoc-hide', msgId, branchId)"
        @post-hoc-edit="(msgId: string, branchId: string) => emit('post-hoc-edit', msgId, branchId)"
        @post-hoc-edit-content="(msgId: string, branchId: string, content: string) => emit('post-hoc-edit-content', msgId, branchId, content)"
        @post-hoc-hide-before="(msgId: string, branchId: string) => emit('post-hoc-hide-before', msgId, branchId)"
        @post-hoc-unhide="(msgId: string, branchId: string) => emit('post-hoc-unhide', msgId, branchId)"
        @delete-post-hoc-operation="(msgId: string) => emit('delete-post-hoc-operation', msgId)"
        @split="(msgId: string, branchId: string, position: number) => emit('split', msgId, branchId, position)"
        @fork="(msgId: string, branchId: string) => emit('fork', msgId, branchId)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import MessageComponent from './MessageComponent.vue';
import AuthenticityIcon from './AuthenticityIcon.vue';
import type { Message, Participant } from '@deprecated-claude/shared';
import { getAvatarUrl, getParticipantColor } from '@/utils/avatars';
import { type AuthenticityStatus, getAuthenticityLevel } from '@/utils/authenticity';

const props = defineProps<{
  messages: Message[];
  participants: Participant[];
  isLastGroup: boolean;
  selectedBranchForParent?: { messageId: string; branchId: string } | null;
  streamingMessageId?: string | null;
  streamingBranchId?: string | null;  // Track specific branch for parallel generation
  isStreaming?: boolean;
  streamingError?: { messageId: string; error: string; suggestion?: string } | null;
  postHocAffectedMessages?: Map<string, any>;
  showStuckButton?: boolean;
  authenticityMap?: Map<string, AuthenticityStatus>;
}>();

const emit = defineEmits<{
  regenerate: [msgId: string, branchId: string];
  edit: [msgId: string, branchId: string, content: string];
  'edit-only': [msgId: string, branchId: string, content: string];
  'switch-branch': [msgId: string, branchId: string];
  delete: [msgId: string, branchId: string];
  'delete-all-branches': [msgId: string];
  'select-as-parent': [msgId: string, branchId: string];
  'stop-auto-scroll': [];
  'bookmark-changed': [];
  'post-hoc-hide': [msgId: string, branchId: string];
  'post-hoc-edit': [msgId: string, branchId: string];
  'post-hoc-edit-content': [msgId: string, branchId: string, content: string];
  'post-hoc-hide-before': [msgId: string, branchId: string];
  'post-hoc-unhide': [msgId: string, branchId: string];
  'delete-post-hoc-operation': [msgId: string];
  split: [msgId: string, branchId: string, position: number];
  fork: [msgId: string, branchId: string];
  'stuck-clicked': [];
}>();

const isExpanded = ref(false);

const firstMessage = computed(() => props.messages[0]);

const isUserMessage = computed(() => {
  const branch = firstMessage.value?.branches?.find(b => b.id === firstMessage.value.activeBranchId);
  return branch?.role === 'user';
});

const participantName = computed(() => {
  const branch = firstMessage.value?.branches?.find(b => b.id === firstMessage.value.activeBranchId);
  if (!branch) return 'Unknown';
  
  if (branch.participantId) {
    const participant = props.participants.find(p => p.id === branch.participantId);
    if (participant) return participant.name;
  }
  return branch.role === 'user' ? 'User' : 'Assistant';
});

const participantColor = computed(() => {
  const branch = firstMessage.value?.branches?.find(b => b.id === firstMessage.value.activeBranchId);
  if (branch?.participantId) {
    return getParticipantColor(branch.participantId, props.participants);
  }
  return undefined;
});

const avatarUrl = computed(() => {
  const branch = firstMessage.value?.branches?.find(b => b.id === firstMessage.value.activeBranchId);
  if (branch?.participantId) {
    const participant = props.participants.find(p => p.id === branch.participantId);
    if (participant?.model) {
      return getAvatarUrl(participant.model);
    }
  }
  return null;
});

// Combine content from all messages with subtle join markers
const combinedContent = computed(() => {
  return props.messages.map((msg, index) => {
    const branch = msg.branches?.find(b => b.id === msg.activeBranchId);
    const content = branch?.content?.trim() || '';
    // Add join marker between messages (not before first)
    if (index > 0) {
      return `<span class="join-marker">·</span>${content}`;
    }
    return content;
  }).join(' ');
});

// Get unique models used in the combined messages
const modelsInGroup = computed(() => {
  const models = new Set<string>();
  for (const msg of props.messages) {
    const branch = msg.branches?.find(b => b.id === msg.activeBranchId);
    if (branch?.model) {
      models.add(branch.model);
    } else if (branch?.participantId) {
      const participant = props.participants.find(p => p.id === branch.participantId);
      if (participant?.model) {
        models.add(participant.model);
      }
    }
  }
  return Array.from(models);
});

// Count total branches across all messages
const branchStats = computed(() => {
  let totalBranches = 0;
  let messagesWithMultipleBranches = 0;
  
  for (const msg of props.messages) {
    const branchCount = msg.branches?.length || 0;
    totalBranches += branchCount;
    if (branchCount > 1) {
      messagesWithMultipleBranches++;
    }
  }
  
  return {
    totalBranches,
    messagesWithMultipleBranches,
    hasBranches: totalBranches > props.messages.length
  };
});

const combinedRenderedContent = computed(() => {
  const renderer = new marked.Renderer();
  const html = marked(combinedContent.value, { renderer, breaks: true }) as string;
  return DOMPurify.sanitize(html);
});

function expand() {
  isExpanded.value = true;
}

function collapse() {
  isExpanded.value = false;
}

function selectedParentCheck(message: Message) {
  return props.selectedBranchForParent?.messageId === message.id &&
         props.selectedBranchForParent?.branchId === message.activeBranchId;
}

function streamingCheck(message: Message) {
  // Check both message ID and branch ID for accurate streaming status during parallel generation
  const messageMatches = props.isStreaming && message.id === props.streamingMessageId;
  // If we have a specific branch ID, also check that
  if (props.streamingBranchId) {
    return messageMatches && message.activeBranchId === props.streamingBranchId;
  }
  return messageMatches;
}

function errorCheck(message: Message) {
  return props.streamingError?.messageId === message.id;
}

function getErrorMessage(message: Message) {
  return props.streamingError?.messageId === message.id ? props.streamingError.error : undefined;
}

function getErrorSuggestion(message: Message) {
  return props.streamingError?.messageId === message.id ? props.streamingError.suggestion : undefined;
}

function postHocAffected(message: Message) {
  return props.postHocAffectedMessages?.get(message.id);
}

// Get authenticity status for a message
function getAuthenticityStatus(message: Message): AuthenticityStatus | undefined {
  return props.authenticityMap?.get(message.id);
}

// Get the "worst" (lowest) authenticity level in the group for collapsed view
const groupAuthenticityLevel = computed(() => {
  if (!props.authenticityMap || props.messages.length === 0) return null;
  
  // Priority: lower is worse
  const levelPriority = ['altered', 'human_written', 'legacy', 'unaltered', 'trace_only', 'split_only', 'full', 'hard_mode'];
  
  let worstLevel = 'hard_mode';
  let worstPriority = levelPriority.length - 1;
  
  for (const msg of props.messages) {
    const status = props.authenticityMap.get(msg.id);
    if (status) {
      const level = getAuthenticityLevel(status);
      const priority = levelPriority.indexOf(level);
      if (priority < worstPriority) {
        worstPriority = priority;
        worstLevel = level;
      }
    }
  }
  
  return worstLevel as any;
});

// Format model name for display (extract short name)
function formatModelName(modelId: string): string {
  // Try to extract a readable name from model ID
  const parts = modelId.split('/');
  const name = parts[parts.length - 1];
  // Shorten common prefixes
  return name
    .replace('claude-', '')
    .replace('gpt-', '')
    .replace('-latest', '')
    .replace('-20', '-')
    .substring(0, 20);
}
</script>

<style scoped>
/* Use same styling as MessageComponent */
.message-container {
  position: relative;
  border-radius: 8px;
  transition: background-color 0.15s ease;
  margin-bottom: 10px;
  max-width: 100%;
  overflow: visible;
  word-wrap: break-word;
  overflow-wrap: break-word;
  padding: 12px 16px 28px 16px;
}

/* Collapsed composite is clickable with blue left bar */
.composite-collapsed {
  cursor: pointer;
  border-left: 3px solid rgba(var(--v-theme-primary), 0.6);
}

.composite-collapsed:hover {
  filter: brightness(1.08);
  border-left-color: rgb(var(--v-theme-primary));
}

/* Wide screens: limit width */
@media (min-width: 700px) {
  .message-container {
    max-width: 80%;
  }
  
  .message-container.user-message {
    margin-left: auto;
  }
  
  .message-container.assistant-message {
    margin-right: auto;
  }
}

/* User message styling */
.message-container.user-message {
  background: rgba(var(--v-theme-primary), 0.15);
}

/* Assistant message styling */
.message-container.assistant-message {
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 2px 4px -1px rgba(0,0,0,.2), 0 4px 5px 0 rgba(0,0,0,.14), 0 1px 10px 0 rgba(0,0,0,.12);
}

/* Info row - matches MessageComponent */
.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px;
  overflow: hidden;
  max-width: 100%;
  margin-bottom: 8px;
}

.message-name {
  font-size: 0.9rem;
}

.message-avatar {
  flex-shrink: 0;
}

/* Message content - matches MessageComponent */
.message-content {
  font-size: 0.95rem;
  line-height: 1.6;
}

.message-content :deep(p) {
  margin-bottom: 0.5em;
}

.message-content :deep(p:last-child) {
  margin-bottom: 0;
}

.message-content :deep(pre) {
  background: rgba(0, 0, 0, 0.3);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
}

.message-content :deep(code) {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.85em;
}

.message-content :deep(code:not(pre code)) {
  background: rgba(0, 0, 0, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
}

/* Join markers between combined messages */
.message-content :deep(.join-marker) {
  display: inline-block;
  color: rgba(var(--v-theme-primary), 0.6);
  font-weight: bold;
  padding: 0 4px;
  font-size: 1.2em;
  vertical-align: middle;
}

/* Expanded header - subtle */
.expanded-header {
  padding: 2px 8px;
  margin-bottom: 4px;
}
</style>
