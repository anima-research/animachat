<template>
  <div
    ref="messageCard"
    :class="[
      'message-container',
      message.branches[branchIndex].role === 'user' ? 'user-message' : 'assistant-message',
      isSelectedParent ? 'selected-parent' : ''
    ]"
    :style="{
      borderLeft: isSelectedParent ? '3px solid rgb(var(--v-theme-info))' : undefined,
      padding: '12px 12px 8px 12px'
    }"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <!-- Hover action bar (Discord-style) -->
    <div 
      v-if="isHovered && !isEditing && !isStreaming" 
      class="hover-actions"
    >
      <v-btn
        v-if="message.branches[branchIndex].role === 'assistant'"
        icon="mdi-refresh"
        size="x-small"
        variant="text"
        density="compact"
        title="Regenerate"
        @click="$emit('regenerate', message.id, currentBranch.id)"
      />
      <v-btn
        icon="mdi-pencil"
        size="x-small"
        variant="text"
        density="compact"
        title="Edit"
        @click="startEdit"
      />
      <v-btn
        icon="mdi-content-copy"
        size="x-small"
        variant="text"
        density="compact"
        title="Copy"
        @click="copyContent"
      />
      <v-btn
        :icon="isSelectedParent ? 'mdi-source-branch-check' : 'mdi-source-branch'"
        :color="isSelectedParent ? 'info' : undefined"
        size="x-small"
        variant="text"
        density="compact"
        title="Branch from here"
        :disabled="isLastMessage"
        @click="$emit('select-as-parent', message.id, currentBranch.id)"
      />
      <v-btn
        ref="bookmarkButtonRef"
        :icon="hasBookmark ? 'mdi-bookmark' : 'mdi-bookmark-outline'"
        :color="hasBookmark ? participantColor : undefined"
        size="x-small"
        variant="text"
        density="compact"
        title="Bookmark"
        @click="toggleBookmark"
      />
      <v-btn
        icon="mdi-code-json"
        size="x-small"
        variant="text"
        density="compact"
        title="Download prompt"
        @click="downloadPrompt"
      />
      <v-btn
        v-if="message.branches[branchIndex].role === 'assistant' && (currentBranch.debugRequest || currentBranch.debugResponse)"
        icon="mdi-bug"
        size="x-small"
        variant="text"
        density="compact"
        title="Debug: View LLM request/response"
        @click="showDebugDialog = true"
      />
      <v-btn
        v-if="canViewMetadata"
        icon="mdi-information-outline"
        size="x-small"
        variant="text"
        density="compact"
        title="View message metadata (IDs, branches, debug data)"
        @click="showMetadataDialog = true"
      />
      <v-divider vertical class="mx-1" style="height: 16px; opacity: 0.3;" />
      <v-btn
        icon="mdi-delete-outline"
        size="x-small"
        variant="text"
        density="compact"
        color="error"
        title="Delete this branch"
        @click="$emit('delete', message.id, currentBranch.id)"
      />
      <v-btn
        v-if="message.branches.length > 1"
        icon="mdi-delete-sweep-outline"
        size="x-small"
        variant="text"
        density="compact"
        color="error"
        title="Delete all branches of this message"
        @click="$emit('delete-all-branches', message.id)"
      />
    </div>

    <!-- Branch navigation (separate row on narrow, inline on wide) -->
    <div v-if="hasNavigableBranches" class="branch-nav-row d-flex align-center justify-center">
      <v-btn icon="mdi-chevron-left" size="x-small" variant="text" density="compact" :disabled="siblingIndex === 0" @click="navigateBranch(-1)" />
      <span class="text-caption meta-text">{{ siblingIndex + 1 }} / {{ siblingBranches.length }}</span>
      <v-btn icon="mdi-chevron-right" size="x-small" variant="text" density="compact" :disabled="siblingIndex === siblingBranches.length - 1" @click="navigateBranch(1)" />
    </div>

    <!-- Info line -->
    <div class="info-row">
      <!-- Left: name + meta -->
      <div class="d-flex align-center flex-wrap" style="gap: 4px;">
        <v-icon
          :icon="message.branches[branchIndex].role === 'user' ? 'mdi-account' : 'mdi-robot'"
          :color="participantColor"
          size="small"
        />
        <span v-if="participantDisplayName" class="message-name font-weight-medium" :style="participantColor ? `color: ${participantColor};` : ''">
          {{ participantDisplayName }}
        </span>
        <span v-if="senderDisplayName && senderDisplayName !== participantDisplayName" class="text-caption meta-text">
          ({{ senderDisplayName }})
        </span>
        <span v-if="modelIndicator" class="text-caption meta-text">
          {{ modelIndicator }}
        </span>
        <span v-if="currentBranch?.createdAt" class="text-caption meta-text">
          {{ formatTimestamp(currentBranch.createdAt) }}
        </span>
        <!-- Badges -->
        <v-chip v-if="currentBranch?.hiddenFromAi" size="x-small" color="warning" variant="tonal" density="compact">
          <v-icon size="x-small" start>mdi-eye-off</v-icon>
          Hidden
        </v-chip>
        <v-chip v-if="hasBookmark" size="x-small" :color="participantColor" variant="tonal" density="compact">
          <v-icon size="x-small" start>mdi-bookmark</v-icon>
          {{ bookmarkLabel }}
        </v-chip>
      </div>
      
      <!-- Center: Branch navigation (desktop only) -->
      <div v-if="hasNavigableBranches" class="branch-nav-inline d-flex align-center justify-center">
        <v-btn icon="mdi-chevron-left" size="x-small" variant="text" density="compact" :disabled="siblingIndex === 0" @click="navigateBranch(-1)" />
        <span class="text-caption meta-text">{{ siblingIndex + 1 }} / {{ siblingBranches.length }}</span>
        <v-btn icon="mdi-chevron-right" size="x-small" variant="text" density="compact" :disabled="siblingIndex === siblingBranches.length - 1" @click="navigateBranch(1)" />
      </div>
      <div v-else class="branch-nav-inline"></div>
      
      <!-- Right: empty for balance -->
      <div class="branch-nav-inline"></div>
    </div>
      
      <!-- Thinking blocks (if present) -->
      <div v-if="thinkingBlocks.length > 0 && !isEditing" class="thinking-section mb-1">
        <v-expansion-panels v-model="thinkingPanelOpen" variant="accordion">
          <v-expansion-panel v-for="(block, index) in thinkingBlocks" :key="index" :value="index">
            <v-expansion-panel-title>
              <v-icon size="small" class="mr-2">mdi-thought-bubble</v-icon>
              <span class="text-caption">
                {{ block.type === 'redacted_thinking' ? 'Thinking (Redacted)' : 'Thinking' }}
                <span v-if="isThinkingStreaming" class="ml-2 text-grey">(streaming...)</span>
              </span>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <div v-if="block.type === 'thinking'" class="thinking-content text-caption">
                <pre style="white-space: pre-wrap; font-family: inherit;">{{ block.thinking }}</pre>
              </div>
              <div v-else-if="block.type === 'redacted_thinking'" class="text-caption text-grey">
                <em>This thinking content has been redacted for safety reasons.</em>
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </div>
      
      <!-- Message content or edit mode -->
      <div v-if="!isEditing" class="message-content" v-html="renderedContent" />
      
      <v-textarea
        v-else
        v-model="editContent"
        auto-grow
        variant="outlined"
        density="compact"
        hide-details
        class="mb-2"
      />
      
      <!-- Generated images (from model output) -->
      <div v-if="imageBlocks.length > 0" class="generated-images mt-3">
        <div v-for="(block, index) in imageBlocks" :key="'img-' + index" class="generated-image-container mb-2">
          <img 
            :src="`data:${(block as any).mimeType || 'image/png'};base64,${(block as any).data}`"
            :alt="(block as any).revisedPrompt || 'Generated image'"
            class="generated-image"
            style="max-width: 100%; max-height: 600px; border-radius: 8px; cursor: pointer;"
            @click="openImagePreview(block)"
          />
          <div v-if="(block as any).revisedPrompt" class="text-caption text-grey mt-1">
            {{ (block as any).revisedPrompt }}
          </div>
        </div>
      </div>
      
      <!-- Attachments display (for user messages) -->
      <div v-if="currentBranch.role === 'user' && currentBranch.attachments && currentBranch.attachments.length > 0" class="mt-2">
        <template v-for="attachment in currentBranch.attachments" :key="attachment.id">
          <!-- Image attachments -->
          <div v-if="isImageAttachment(attachment)" class="mb-2">
            <img 
              :src="getImageSrc(attachment)"
              :alt="attachment.fileName"
              style="max-width: 300px; max-height: 300px; border-radius: 8px; cursor: pointer;"
              @click="openImageInNewTab(attachment)"
            />
            <div class="text-caption mt-1">{{ attachment.fileName }} ({{ formatFileSize(attachment.fileSize || 0) }})</div>
          </div>
          <!-- Text attachments -->
          <v-chip
            v-else
            class="mr-2 mb-1"
            size="small"
            color="grey-lighten-2"
          >
            <v-icon start size="x-small">mdi-paperclip</v-icon>
            {{ attachment.fileName }}
            <span class="ml-1 text-caption">({{ formatFileSize(attachment.fileSize || 0) }})</span>
          </v-chip>
        </template>
      </div>
      
      <div v-if="isEditing" class="d-flex gap-2 mt-2">
        <v-btn
          size="small"
          color="primary"
          @click="saveEdit"
        >
          Save
        </v-btn>
        <v-btn
          size="small"
          variant="text"
          @click="cancelEdit"
        >
          Cancel
        </v-btn>
      </div>
      
      <!-- Generating indicator or error indicator -->
      <div v-if="hasError && currentBranch.role === 'assistant'" class="error-indicator mt-3">
        <div class="error-box">
          <div class="error-header">
            <v-icon size="small" color="error" class="mr-2">mdi-alert-circle</v-icon>
            <span class="error-title">Error</span>
          </div>
          <div class="error-message">
            {{ errorMessage || 'Failed to generate response' }}
          </div>
          <div v-if="errorSuggestion" class="error-suggestion">
            💡 {{ errorSuggestion }}
          </div>
        </div>
      </div>
      <div v-else-if="isStreaming && currentBranch.role === 'assistant'" class="generating-indicator mt-1">
        <v-chip 
          size="x-small" 
          :color="participantColor || 'grey'"
          variant="tonal"
        >
          <v-progress-circular
            indeterminate
            size="12"
            width="2"
            class="mr-1"
            :color="participantColor || 'grey'"
          />
          Generating...
        </v-chip>
      </div>

    <!-- Bookmark dialog -->
    <v-dialog v-model="bookmarkDialog" max-width="400">
      <v-card>
        <v-card-title>{{ hasBookmark ? 'Edit Bookmark' : 'Add Bookmark' }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="bookmarkInput"
            label="Bookmark label"
            placeholder="Enter a label for this message..."
            variant="outlined"
            density="compact"
            autofocus
            @keydown.enter="saveBookmark"
          />
        </v-card-text>
        <v-card-actions>
          <v-btn
            v-if="hasBookmark"
            color="error"
            variant="text"
            @click="deleteBookmark"
          >
            Delete
          </v-btn>
          <v-spacer />
          <v-btn @click="bookmarkDialog = false">Cancel</v-btn>
          <v-btn
            color="primary"
            @click="saveBookmark"
            :disabled="!bookmarkInput.trim()"
          >
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    
    <!-- Image Preview Dialog -->
    <v-dialog v-model="imagePreviewDialog" max-width="90vw">
      <v-card class="pa-2" style="background: rgba(0,0,0,0.9);">
        <v-card-text class="pa-0 text-center">
          <img
            :src="previewImageSrc"
            :alt="previewImageAlt"
            style="max-width: 100%; max-height: 85vh; object-fit: contain;"
          />
        </v-card-text>
        <v-card-actions v-if="previewImageAlt" class="justify-center">
          <span class="text-caption text-grey">{{ previewImageAlt }}</span>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Debug Dialog -->
    <DebugMessageDialog
      v-model="showDebugDialog"
      :debug-request="currentBranch.debugRequest"
      :debug-response="currentBranch.debugResponse"
    />
    
    <!-- Metadata Dialog (for researchers/admins) -->
    <v-dialog v-model="showMetadataDialog" max-width="800">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon class="mr-2">mdi-information-outline</v-icon>
          Message Metadata
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" size="small" @click="showMetadataDialog = false" />
        </v-card-title>
        <v-card-text>
          <div class="mb-4">
            <h4 class="text-subtitle-1 mb-2">Message</h4>
            <v-table density="compact">
              <tbody>
                <tr>
                  <td class="font-weight-medium" style="width: 180px;">Message ID</td>
                  <td><code>{{ message.id }}</code></td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Conversation ID</td>
                  <td><code>{{ message.conversationId }}</code></td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Active Branch ID</td>
                  <td><code>{{ message.activeBranchId }}</code></td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Order</td>
                  <td>{{ message.order }}</td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Created At</td>
                  <td>{{ new Date(message.createdAt).toLocaleString() }}</td>
                </tr>
              </tbody>
            </v-table>
          </div>
          
          <div class="mb-4">
            <h4 class="text-subtitle-1 mb-2">Current Branch ({{ branchIndex + 1 }} of {{ message.branches.length }})</h4>
            <v-table density="compact">
              <tbody>
                <tr>
                  <td class="font-weight-medium" style="width: 180px;">Branch ID</td>
                  <td><code>{{ currentBranch.id }}</code></td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Role</td>
                  <td>{{ currentBranch.role }}</td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Parent Branch ID</td>
                  <td><code>{{ currentBranch.parentBranchId || 'root' }}</code></td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Model</td>
                  <td>
                    <template v-if="currentBranchModelDetails">
                      <div>{{ currentBranchModelDetails.displayName }}</div>
                      <div class="text-caption text-grey">
                        <code>{{ currentBranchModelDetails.providerModelId }}</code>
                        <span v-if="currentBranchModelDetails.isCustom" class="ml-1">(custom)</span>
                      </div>
                    </template>
                    <template v-else>
                      {{ currentBranch.model || 'N/A' }}
                    </template>
                  </td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Internal Model ID</td>
                  <td><code>{{ currentBranch.model || 'N/A' }}</code></td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Participant ID</td>
                  <td><code>{{ currentBranch.participantId || 'N/A' }}</code></td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Sent By User</td>
                  <td><code>{{ currentBranch.sentByUserId || 'N/A' }}</code></td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Content Length</td>
                  <td>{{ currentBranch.content?.length || 0 }} chars</td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Content Blocks</td>
                  <td>{{ currentBranch.contentBlocks?.length || 0 }}</td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Has Debug Request</td>
                  <td>{{ !!currentBranch.debugRequest }}</td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Has Debug Response</td>
                  <td>{{ !!currentBranch.debugResponse }}</td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Created At</td>
                  <td>{{ currentBranch.createdAt ? new Date(currentBranch.createdAt).toLocaleString() : 'N/A' }}</td>
                </tr>
              </tbody>
            </v-table>
          </div>
          
          <div v-if="message.branches.length > 1" class="mb-4">
            <h4 class="text-subtitle-1 mb-2">All Branches ({{ message.branches.length }})</h4>
            <v-expansion-panels variant="accordion" density="compact">
              <v-expansion-panel v-for="(branch, idx) in message.branches" :key="branch.id">
                <v-expansion-panel-title>
                  <span :class="{ 'font-weight-bold': branch.id === message.activeBranchId }">
                    Branch {{ idx + 1 }}: {{ branch.role }}
                    <span v-if="branch.id === message.activeBranchId" class="text-success ml-2">(active)</span>
                  </span>
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <v-table density="compact">
                    <tbody>
                      <tr>
                        <td class="font-weight-medium" style="width: 180px;">Branch ID</td>
                        <td><code>{{ branch.id }}</code></td>
                      </tr>
                      <tr>
                        <td class="font-weight-medium">Parent Branch ID</td>
                        <td><code>{{ branch.parentBranchId || 'root' }}</code></td>
                      </tr>
                      <tr>
                        <td class="font-weight-medium">Model</td>
                        <td>
                          <template v-if="getModelDetails(branch.model)">
                            {{ getModelDetails(branch.model)?.displayName }}
                            <div class="text-caption text-grey">
                              <code>{{ getModelDetails(branch.model)?.providerModelId }}</code>
                            </div>
                          </template>
                          <template v-else>
                            {{ branch.model || 'N/A' }}
                          </template>
                        </td>
                      </tr>
                      <tr>
                        <td class="font-weight-medium">Has Debug Data</td>
                        <td>{{ !!branch.debugRequest || !!branch.debugResponse }}</td>
                      </tr>
                    </tbody>
                  </v-table>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </div>
          
          <div v-if="currentBranch.debugRequest" class="mb-4">
            <h4 class="text-subtitle-1 mb-2">Debug Request</h4>
            <pre class="debug-json pa-2 rounded" style="max-height: 300px; overflow: auto; font-size: 11px;">{{ JSON.stringify(currentBranch.debugRequest, null, 2) }}</pre>
          </div>
          
          <div v-if="currentBranch.debugResponse" class="mb-4">
            <h4 class="text-subtitle-1 mb-2">Debug Response</h4>
            <pre class="debug-json pa-2 rounded" style="max-height: 200px; overflow: auto; font-size: 11px;">{{ JSON.stringify(currentBranch.debugResponse, null, 2) }}</pre>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-btn
            variant="text"
            size="small"
            @click="copyMetadataToClipboard"
          >
            <v-icon start>mdi-content-copy</v-icon>
            Copy All
          </v-btn>
          <v-spacer />
          <v-btn variant="text" @click="showMetadataDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUpdated, watch } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Message, Participant } from '@deprecated-claude/shared';
import { getModelColor } from '@/utils/modelColors';
import { api } from '@/services/api';
import { useStore } from '@/store';
import DebugMessageDialog from './DebugMessageDialog.vue';

const store = useStore();

const props = defineProps<{
  message: Message;
  participants?: Participant[];
  isSelectedParent?: boolean;
  isLastMessage?: boolean;
  isStreaming?: boolean;
  hasError?: boolean;
  errorMessage?: string;
  errorSuggestion?: string;
}>();

const emit = defineEmits<{
  regenerate: [messageId: string, branchId: string];
  edit: [messageId: string, branchId: string, content: string];
  'switch-branch': [messageId: string, branchId: string];
  delete: [messageId: string, branchId: string];
  'delete-all-branches': [messageId: string];
  'select-as-parent': [messageId: string, branchId: string];
  'stop-auto-scroll': [];
  'bookmark-changed': [];
}>();

const isEditing = ref(false);
const editContent = ref('');
const messageCard = ref<HTMLElement>();
const showScrollToTop = ref(false);
const isHovered = ref(false);
const bookmarkDialog = ref(false);
const bookmarkInput = ref('');
const bookmarkLabel = ref<string | null>(null);
const showBookmarkTooltip = ref(false);
const bookmarkButtonRef = ref<HTMLElement>();
const imagePreviewDialog = ref(false);
const previewImageSrc = ref('');
const previewImageAlt = ref('');
const showDebugDialog = ref(false);
const showMetadataDialog = ref(false);

// Check if user is researcher or admin (can see metadata)
const canViewMetadata = computed(() => {
  const summary = store.state.grantSummary;
  if (!summary?.grantCapabilities) return false;
  
  // Check for researcher or admin capability
  for (const cap of ['researcher', 'admin']) {
    const records = summary.grantCapabilities.filter((c: any) => c.capability === cap);
    if (records.length > 0) {
      const latest = records.reduce((a: any, b: any) => (a.time > b.time ? a : b));
      if (latest.action === 'granted') return true;
    }
  }
  return false;
});

const branchIndex = computed(() => {
  return props.message.branches.findIndex(b => b.id === props.message.activeBranchId) || 0;
});

const currentBranch = computed(() => {
  const branch = props.message.branches[branchIndex.value];
  return branch;
});

// Look up model details from store
function getModelDetails(modelId: string | undefined) {
  if (!modelId) return null;
  
  // Check standard models
  const standardModel = store.state.models.find(m => m.id === modelId);
  if (standardModel) {
    return {
      displayName: standardModel.displayName || standardModel.shortName || modelId,
      providerModelId: standardModel.providerModelId,
      provider: standardModel.provider,
      isCustom: false
    };
  }
  
  // Check custom models
  const customModel = store.state.customModels?.find(m => m.id === modelId);
  if (customModel) {
    return {
      displayName: customModel.displayName || modelId,
      providerModelId: customModel.providerModelId,
      provider: customModel.provider,
      isCustom: true
    };
  }
  
  return null;
}

const currentBranchModelDetails = computed(() => {
  return getModelDetails(currentBranch.value?.model);
});

// Get sender display name for multiuser attribution
const senderDisplayName = computed(() => {
  const sentByUserId = currentBranch.value?.sentByUserId;
  if (!sentByUserId) return null;
  
  // Check if current user is the sender
  if (store.state.user?.id === sentByUserId) {
    return 'you';
  }
  
  // For now, just show a shortened version of the user ID
  // In the future, we could look up user names from a user cache
  return sentByUserId.substring(0, 8);
});

const hasBookmark = computed(() => {
  return bookmarkLabel.value !== null && bookmarkLabel.value !== '';
});

// Check if message is long enough to need scroll button
onMounted(async () => {
  checkMessageHeight();
  await loadBookmark();
});

onUpdated(() => {
  checkMessageHeight();
});

// Also check height when streaming status changes or content updates
watch(() => props.isStreaming, () => {
  // Use setTimeout to ensure DOM has updated
  setTimeout(checkMessageHeight, 100);
});

// Watch for content changes during streaming
watch(() => currentBranch.value?.content, () => {
  if (props.isStreaming) {
    setTimeout(checkMessageHeight, 100);
  }
});

function checkMessageHeight() {
  if (messageCard.value) {
    const element = (messageCard.value as any).$el || messageCard.value;
    // Show button if message is taller than 500px
    showScrollToTop.value = element?.offsetHeight > 500;
  }
}

function scrollToTopOfMessage() {
  if (messageCard.value) {
    const element = (messageCard.value as any).$el || messageCard.value;
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    // Stop auto-scrolling if streaming
    if (props.isStreaming) {
      // Emit event to parent to stop auto-scrolling
      emit('stop-auto-scroll');
    }
  }
}

// Get participant display name (shown in UI - empty for empty-name participants)
const participantDisplayName = computed(() => {
  const branch = currentBranch.value;
  
  // If no participants list provided or no participantId, fall back to default behavior
  if (!props.participants || !branch.participantId) {
    return branch.role === 'user' ? 'You' : 'Assistant';
  }
  
  // Find the participant by ID
  const participant = props.participants.find(p => p.id === branch.participantId);
  if (participant && participant.name === '') {
    // Return empty string for empty-name participants (no name shown)
    return '';
  } else if (participant) {
    return participant.name;
  }
  
  // Fallback if participant not found
  return branch.role === 'user' ? 'You' : 'Assistant';
});

// Get model indicator for assistant messages
const modelIndicator = computed(() => {
  const branch = currentBranch.value;
  
  // Only show model indicator for assistant messages that have a model stored
  if (branch.role === 'assistant' && branch.model) {
    const details = getModelDetails(branch.model);
    if (details) {
      // Always prefer providerModelId (e.g., google/gemini-3-pro-preview)
      // as it's most useful for identifying the actual model
      return details.providerModelId || details.displayName;
    }
    return branch.model;
  }
  
  return null;
});

const participantColor = computed(() => {
  const branch = currentBranch.value;
  
  // Only color assistant messages
  if (branch.role !== 'assistant') {
    return '#bb86fc'
  }
  
  // Try to get model from participant or branch
  let model: string | undefined;
  
  if (props.participants && branch.participantId) {
    const participant = props.participants.find(p => p.id === branch.participantId);
    model = participant?.model;
  }
  
  // Fallback to branch model
  if (!model) {
    model = branch.model;
  }
  
  return getModelColor(model);
});

// Get all sibling branches (branches that share the same parent)
const siblingBranches = computed(() => {
  const activeParent = currentBranch.value.parentBranchId;
  return props.message.branches.filter(
    branch => branch.parentBranchId === activeParent
  );
});

// Get index among siblings
const siblingIndex = computed(() => {
  return siblingBranches.value.findIndex(b => b.id === props.message.activeBranchId) || 0;
});

// Check if branches are navigable (share the same parent)
const hasNavigableBranches = computed(() => {
  return siblingBranches.value.length > 1;
});

// Extract thinking blocks from content blocks
const thinkingBlocks = computed(() => {
  const branch = currentBranch.value;
  if (!branch.contentBlocks || branch.contentBlocks.length === 0) {
    return [];
  }
  
  // Filter for thinking and redacted_thinking blocks
  return branch.contentBlocks.filter((block: any) => 
    block.type === 'thinking' || block.type === 'redacted_thinking'
  );
});

// Extract generated image blocks from content blocks
const imageBlocks = computed(() => {
  const branch = currentBranch.value;
  if (!branch.contentBlocks || branch.contentBlocks.length === 0) {
    return [];
  }
  
  // Filter for image content blocks (generated by model)
  const images = branch.contentBlocks.filter((block: any) => block.type === 'image');
  if (images.length > 0) {
    console.log('[MessageComponent] Found image blocks:', images.length, images.map((b: any) => ({ type: b.type, hasData: !!b.data, mimeType: b.mimeType })));
  }
  return images;
});

// Control thinking panel open/close state
const thinkingPanelOpen = ref<number | undefined>(undefined);

// Check if thinking is currently streaming (has thinking blocks, is streaming, no content yet)
const isThinkingStreaming = computed(() => {
  const streaming = props.isStreaming && 
         thinkingBlocks.value.length > 0 && 
         !currentBranch.value.content?.trim();
  return streaming;
});

// Debug: watch for contentBlocks changes
watch(() => currentBranch.value.contentBlocks, (blocks) => {
  if (blocks && blocks.length > 0) {
    console.log('[MessageComponent] contentBlocks updated:', blocks.length, 'types:', blocks.map((b: any) => b.type));
  }
}, { immediate: true });

// Auto-open panel when thinking starts streaming, close when content starts
watch(isThinkingStreaming, (streaming, oldStreaming) => {
  if (streaming) {
    // Open the first thinking panel
    thinkingPanelOpen.value = 0;
  } else if (oldStreaming && currentBranch.value.content?.trim()) {
    // Close panel when response content starts (only if it was open due to streaming)
    thinkingPanelOpen.value = undefined;
  }
}, { immediate: true });

const renderedContent = computed(() => {
  let content = currentBranch.value.content;
  
  // Preserve leading/trailing whitespace by converting to non-breaking spaces
  const leadingSpaces = content.match(/^(\s+)/)?.[1] || '';
  const trailingSpaces = content.match(/(\s+)$/)?.[1] || '';
  
  // First, protect code blocks and inline code from HTML escaping
  const codeBlocks: string[] = [];
  const inlineCode: string[] = [];
  
  // Save code blocks with placeholders
  content = content.replace(/```[\s\S]*?```/g, (match) => {
    const index = codeBlocks.length;
    codeBlocks.push(match);
    return `__CODE_BLOCK_${index}__`;
  });
  
  // Save inline code with placeholders
  content = content.replace(/`[^`\n]+`/g, (match) => {
    const index = inlineCode.length;
    inlineCode.push(match);
    return `__INLINE_CODE_${index}__`;
  });
  
  // Escape HTML/XML tags that aren't in code blocks
  // This prevents raw HTML from being rendered but preserves it visually
  content = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  // Restore code blocks and inline code
  content = content.replace(/__CODE_BLOCK_(\d+)__/g, (_, index) => codeBlocks[parseInt(index)]);
  content = content.replace(/__INLINE_CODE_(\d+)__/g, (_, index) => inlineCode[parseInt(index)]);
  
  // Handle code blocks with syntax highlighting
  const renderer = new marked.Renderer();
  
  renderer.code = (code, language) => {
    if (language) {
      try {
        // In a real app, you'd use a syntax highlighter like Prism or highlight.js
        return `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`;
      } catch (e) {
        // Fallback for unknown languages
      }
    }
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  };
  
  marked.setOptions({
    renderer,
    breaks: true,
    gfm: true
  });
  
  let html = marked.parse ? marked.parse(content) : marked(content);
  // Handle if marked returns a promise (newer versions)
  if (html instanceof Promise) {
    html = ''; // Fallback, but this shouldn't happen with sync parse
  }
  
  // Convert leading/trailing spaces to non-breaking spaces to preserve them
  const leadingNbsp = leadingSpaces.replace(/ /g, '&nbsp;').replace(/\n/g, '<br>');
  const trailingNbsp = trailingSpaces.replace(/ /g, '&nbsp;').replace(/\n/g, '<br>');
  
  // Add preserved whitespace back
  if (leadingNbsp) {
    html = leadingNbsp + html;
  }
  if (trailingNbsp) {
    html = html + trailingNbsp;
  }
  
  return DOMPurify.sanitize(html, {
    // Allow only safe HTML tags that markdown generates
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre',
      'blockquote', 'ul', 'ol', 'li', 'a', 'img',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'hr', 'sup', 'sub', 'del', 'ins'
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel']
  });
});

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function startEdit() {
  isEditing.value = true;
  editContent.value = currentBranch.value.content;
}

function cancelEdit() {
  isEditing.value = false;
  editContent.value = '';
}

function saveEdit() {
  if (editContent.value !== currentBranch.value.content) {
    emit('edit', props.message.id, currentBranch.value.id, editContent.value);
  }
  cancelEdit();
}

function copyContent() {
  navigator.clipboard.writeText(currentBranch.value.content);
}

function navigateBranch(direction: number) {
  const newIndex = siblingIndex.value + direction;
  if (newIndex >= 0 && newIndex < siblingBranches.value.length) {
    emit('switch-branch', props.message.id, siblingBranches.value[newIndex].id);
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function isImageAttachment(attachment: any): boolean {
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
  const fileExtension = attachment.fileName?.split('.').pop()?.toLowerCase() || '';
  return imageExtensions.includes(fileExtension);
}

function getImageSrc(attachment: any): string {
  const fileExtension = attachment.fileName?.split('.').pop()?.toLowerCase() || 'png';
  return `data:image/${fileExtension};base64,${attachment.content}`;
}

function openImageInNewTab(attachment: any): void {
  const src = getImageSrc(attachment);
  const newWindow = window.open();
  if (newWindow) {
    newWindow.document.write(`<img src="${src}" style="max-width: 100%; height: auto;" />`);
    newWindow.document.title = attachment.fileName;
  }
}

function openImagePreview(block: any): void {
  if (block.data) {
    previewImageSrc.value = `data:${block.mimeType || 'image/png'};base64,${block.data}`;
    previewImageAlt.value = block.revisedPrompt || 'Generated image';
    imagePreviewDialog.value = true;
  }
}

function formatTimestamp(timestamp: string | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  // If today, show time
  if (diffDays === 0) {
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
  }
  
  // If yesterday
  if (diffDays === 1) {
    return `Yesterday ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }
  
  // If within this week
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  }
  
  // Otherwise show date
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

async function downloadPrompt() {
  try {
    // Get the conversation ID from the store
    const conversationId = store.state.currentConversation?.id;
    if (!conversationId) {
      console.error('No conversation ID available');
      return;
    }

    // Call the API to get the prompt
    const response = await api.post('/prompt/build', {
      conversationId,
      branchId: currentBranch.value.id,
      includeSystemPrompt: true
    });

    // Create a downloadable JSON file with just the messages array
    const blob = new Blob([JSON.stringify(response.data.messages, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prompt-${props.message.id}-${currentBranch.value.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Failed to download prompt:', error);
  }
}

// Copy all message metadata to clipboard
async function copyMetadataToClipboard() {
  const metadata = {
    message: {
      id: props.message.id,
      conversationId: props.message.conversationId,
      activeBranchId: props.message.activeBranchId,
      order: props.message.order,
      createdAt: props.message.createdAt,
    },
    currentBranch: {
      id: currentBranch.value.id,
      role: currentBranch.value.role,
      parentBranchId: currentBranch.value.parentBranchId,
      model: currentBranch.value.model,
      participantId: currentBranch.value.participantId,
      sentByUserId: currentBranch.value.sentByUserId,
      contentLength: currentBranch.value.content?.length || 0,
      contentBlocks: currentBranch.value.contentBlocks?.length || 0,
      hasDebugRequest: !!currentBranch.value.debugRequest,
      hasDebugResponse: !!currentBranch.value.debugResponse,
      createdAt: currentBranch.value.createdAt,
    },
    allBranches: props.message.branches.map((b, idx) => ({
      index: idx,
      id: b.id,
      role: b.role,
      parentBranchId: b.parentBranchId,
      model: b.model,
      isActive: b.id === props.message.activeBranchId,
    })),
    debugRequest: currentBranch.value.debugRequest,
    debugResponse: currentBranch.value.debugResponse,
  };
  
  try {
    await navigator.clipboard.writeText(JSON.stringify(metadata, null, 2));
    console.log('Metadata copied to clipboard');
  } catch (err) {
    console.error('Failed to copy metadata:', err);
  }
}

// Bookmark management
async function loadBookmark() {
  try {
    const conversationId = store.state.currentConversation?.id;
    if (!conversationId) return;

    const response = await api.get(`/bookmarks/conversation/${conversationId}`);
    const bookmarks = response.data;

    // Find bookmark for current branch
    const bookmark = bookmarks.find((b: any) =>
      b.messageId === props.message.id && b.branchId === currentBranch.value.id
    );

    if (bookmark) {
      bookmarkLabel.value = bookmark.label;
    }
  } catch (error) {
    console.error('Failed to load bookmark:', error);
  }
}

function toggleBookmark() {
  if (hasBookmark.value) {
    bookmarkInput.value = bookmarkLabel.value || '';
  } else {
    bookmarkInput.value = '';
  }
  bookmarkDialog.value = true;
}

async function saveBookmark() {
  try {
    const conversationId = store.state.currentConversation?.id;
    if (!conversationId) return;

    const label = bookmarkInput.value.trim();
    if (!label) return;

    await api.post('/bookmarks', {
      conversationId,
      messageId: props.message.id,
      branchId: currentBranch.value.id,
      label
    });

    bookmarkLabel.value = label;
    bookmarkDialog.value = false;

    // Notify parent that bookmarks changed
    emit('bookmark-changed');
  } catch (error) {
    console.error('Failed to save bookmark:', error);
  }
}

async function deleteBookmark() {
  try {
    await api.delete(`/bookmarks/${props.message.id}/${currentBranch.value.id}`);

    bookmarkLabel.value = null;
    bookmarkDialog.value = false;

    // Notify parent that bookmarks changed
    emit('bookmark-changed');
  } catch (error) {
    console.error('Failed to delete bookmark:', error);
  }
}

// Watch for branch changes and reload bookmark
watch(() => currentBranch.value.id, async () => {
  await loadBookmark();
});
</script>

<style scoped>
/* Mobile: full-width messages */
@media (max-width: 768px) {
  .v-card {
    max-width: 100% !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
  }
}

.error-indicator {
  max-width: 100%;
}

.error-box {
  background: rgba(var(--v-theme-error), 0.1);
  border: 1px solid rgba(var(--v-theme-error), 0.3);
  border-radius: 8px;
  padding: 12px;
  max-width: 100%;
}

.error-header {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}

.error-title {
  font-weight: 600;
  color: rgb(var(--v-theme-error));
  font-size: 0.875rem;
}

.error-message {
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.875rem;
  line-height: 1.4;
  word-wrap: break-word;
  white-space: pre-wrap;
}

.error-suggestion {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(var(--v-theme-error), 0.2);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.8125rem;
  line-height: 1.4;
}

.generating-indicator {
  display: flex;
  align-items: center;
}

.generating-chip {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

.meta-text {
  opacity: 0.6;
  font-size: 0.75rem;
}

.top-controls {
  margin-top: -14px;
  margin-bottom: -2px;
}

.bottom-controls {
  margin-bottom: -6px;
  gap: 8px;
}

.flip-vertical {
  transform: scaleY(-1);
}

/* Compact message container */
.message-container {
  position: relative;
  border-radius: 8px;
  transition: background-color 0.15s ease;
  margin-bottom: 10px;
  max-width: 100%;
  overflow-x: hidden;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

/* Desktop: left-right offsets */
@media (min-width: 600px) {
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

/* User message styling - matches v-card primary tonal */
.message-container.user-message {
  background: rgba(var(--v-theme-primary), 0.15);
}

/* Assistant message styling - matches v-card surface elevated */
.message-container.assistant-message {
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 2px 4px -1px rgba(0,0,0,.2), 0 4px 5px 0 rgba(0,0,0,.14), 0 1px 10px 0 rgba(0,0,0,.12);
}

.message-container:hover {
  filter: brightness(1.05);
}

/* Branch nav: separate row on narrow screens */
.branch-nav-row {
  display: flex;
  margin-bottom: 2px;
}

/* Hide inline branch nav on narrow screens */
.branch-nav-inline {
  display: none !important;
}

/* Info row - simple flex by default */
.info-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  overflow: hidden;
  max-width: 100%;
}

/* Wide screens: hide separate row, show inline centered */
@media (min-width: 700px) {
  .branch-nav-row {
    display: none !important;
  }
  
  .branch-nav-inline {
    display: flex !important;
  }
  
  .info-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    flex-wrap: nowrap;
    gap: 8px;
  }
}

/* Name matches message font size */
.message-name {
  font-size: 0.875rem;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 150px;
}

/* Match v-card-text typography */
.message-content {
  font-size: 0.875rem;
  line-height: 1.5;
  overflow-x: hidden;
  word-wrap: break-word;
  overflow-wrap: break-word;
  margin-top: 6px;
}

/* Use :deep() to penetrate v-html content */
.message-content :deep(p) {
  margin-top: 0;
  margin-bottom: 0.5em;
}

.message-content :deep(p:first-child) {
  margin-top: 0;
}

.message-content :deep(p:last-child) {
  margin-bottom: 0;
}

/* Discord-style hover action bar */
.hover-actions {
  position: absolute;
  top: -8px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  z-index: 10;
}

.hover-actions .v-btn {
  opacity: 0.6;
  min-width: 28px;
}

.hover-actions .v-btn:hover {
  opacity: 1;
}

/* Metadata dialog debug JSON */
.debug-json {
  background: rgba(0, 0, 0, 0.3);
  color: #a5d6a7;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>

<style>
/* Global style for bookmark tooltip - needs to be unscoped to override Vuetify */
.bookmark-tooltip {
  background-color: transparent !important;
  box-shadow: none !important;
}
</style>

