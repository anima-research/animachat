<template>
  <v-card
    ref="messageCard"
    :class="[
      'mb-4',
      message.branches[branchIndex].role === 'user' ? 'ml-auto' : 'mr-auto',
      isSelectedParent ? 'selected-parent' : ''
    ]"
    :style="{
      maxWidth: '80%',
      alignSelf: message.branches[branchIndex].role === 'user' ? 'flex-end' : 'flex-start',
      border: isSelectedParent ? '2px solid rgb(var(--v-theme-info))' : undefined
    }"
    :color="message.branches[branchIndex].role === 'user' ? 'primary' : 'surface'"
    :variant="message.branches[branchIndex].role === 'user' ? 'tonal' : 'elevated'"
  >
    <v-card-text>

      <div
        v-if="hasNavigableBranches"
        class="top-controls d-flex align-center justify-space-evenly"
      >
      <!-- Branch navigation section -->
        <div v-if="hasNavigableBranches" class="d-flex align-center">
          <v-btn
            icon="mdi-chevron-left"
            size="small"
            variant="text"
            density="compact"

            :disabled="siblingIndex === 0"
            @click="navigateBranch(-1)"
          />
          
          <span class="mx-1 meta-text">
            {{ siblingIndex + 1 }} / {{ siblingBranches.length }}
          </span>
          
          <v-btn
            icon="mdi-chevron-right"
            size="small"
            variant="text"
            density="compact"

            :disabled="siblingIndex === siblingBranches.length - 1"
            @click="navigateBranch(1)"
          />
        </div>

      </div>

      <div class="d-flex align-start mb-2">
        <v-icon
          :icon="message.branches[branchIndex].role === 'user' ? 'mdi-account' : 'mdi-robot'"
          :color="participantColor"
          size="small"
          class="mr-2"
        />
        <div v-if="participantDisplayName" class="text-caption" :style="participantColor ? `color: ${participantColor}; font-weight: 500;` : ''">
          {{ participantDisplayName }}
        </div>
        <div v-if="modelIndicator" class="text-caption ml-1 meta-text">
          ({{ modelIndicator }})
        </div>
        <div v-if="currentBranch?.createdAt" class="text-caption ml-2 meta-text">
          {{ formatTimestamp(currentBranch.createdAt) }}
        </div>
        
        <v-spacer />
        
        <div v-if="!isEditing" class="d-flex gap-1">

          <v-btn
            v-if="message.branches[branchIndex].role === 'assistant'"
            icon="mdi-refresh"
            size="x-small"
            density="compact"
            class="mr-4"
            style="opacity: 0.6"
            variant="text"
            @click="$emit('regenerate', message.id, currentBranch.id)"
          />

          <v-btn
            icon="mdi-delete-outline"
            size="x-small"
            density="compact"
            variant="text"
            color="error"
            @click="$emit('delete', message.id, currentBranch.id)"
          />
        </div>
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
      
      <div
        v-if="!isEditing && !isStreaming"
        class="bottom-controls d-flex align-center justify-space-between mt-3"
      >

        <v-btn
          :icon="isSelectedParent ? 'mdi-source-branch-check' : 'mdi-source-branch'"
          :color="isSelectedParent ? 'info' : undefined"
          size="small"
          variant="text"
          density="compact"
          :style="isSelectedParent ? 'opacity: 1' : isLastMessage ? 'opacity: 0.3' : 'opacity: 0.6'"
          @click="$emit('select-as-parent', message.id, currentBranch.id)"
          title="Branch from here"
          :disabled="isLastMessage"
        />

        <v-spacer />

        <div class="d-flex gap-1">
          <v-btn
            icon="mdi-content-copy"
            size="x-small"
            density="compact"
            variant="text"
            class="mr-4"
            style="opacity: 0.6"
            @click="copyContent"
          />
          <v-btn
            icon="mdi-code-json"
            size="x-small"
            variant="text"
            density="compact"
            class="mr-4"
            style="opacity: 0.6"
            @click="downloadPrompt"
            title="Download prompt as JSON"
          />
          <v-btn
            icon="mdi-pencil"
            size="x-small"
            variant="text"
            style="opacity: 0.6"
            density="compact"
            @click="startEdit"
          />
        </div>


        
        <!-- Scroll to top button -->
        <!-- <v-btn
          v-if="showScrollToTop"
          size="small"
          variant="tonal"
          color="grey"
          @click="scrollToTopOfMessage"
        >
          <v-icon start size="small">mdi-chevron-up</v-icon>
          Scroll to top
        </v-btn> -->
      </div>
      
      <!-- Generating indicator or error indicator -->
      <div v-if="hasError && currentBranch.role === 'assistant'" class="error-indicator mt-3">
        <v-chip 
          size="small" 
          color="error"
          variant="tonal"
          class="error-chip"
        >
          <v-icon
            size="small"
            class="mr-2"
          >
            mdi-alert-circle
          </v-icon>
          {{ errorMessage || 'Failed to generate response' }}
        </v-chip>
      </div>
      <div v-else-if="isStreaming && currentBranch.role === 'assistant'" class="generating-indicator mt-3">
        <v-chip 
          size="small" 
          :color="participantColor || 'grey'"
          variant="tonal"
          class="generating-chip"
        >
          <v-progress-circular
            indeterminate
            size="14"
            width="2"
            class="mr-2"
            :color="participantColor || 'grey'"
          />
          Generating...
        </v-chip>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUpdated, watch } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Message, Participant } from '@deprecated-claude/shared';
import { getModelColor } from '@/utils/modelColors';
import { api } from '@/services/api';
import { useStore } from '@/store';

const props = defineProps<{
  message: Message;
  participants?: Participant[];
  isSelectedParent?: boolean;
  isLastMessage?: boolean;
  isStreaming?: boolean;
  hasError?: boolean;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  regenerate: [messageId: string, branchId: string];
  edit: [messageId: string, branchId: string, content: string];
  'switch-branch': [messageId: string, branchId: string];
  delete: [messageId: string, branchId: string];
  'select-as-parent': [messageId: string, branchId: string];
  'stop-auto-scroll': [];
}>();

const isEditing = ref(false);
const editContent = ref('');
const messageCard = ref<HTMLElement>();
const showScrollToTop = ref(false);

const branchIndex = computed(() => {
  return props.message.branches.findIndex(b => b.id === props.message.activeBranchId) || 0;
});

const currentBranch = computed(() => {
  const branch = props.message.branches[branchIndex.value];
  return branch;
});

// Check if message is long enough to need scroll button
onMounted(() => {
  checkMessageHeight();
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
    // Return a shortened version of the model ID for display
    // e.g., "claude-3.5-sonnet" -> "claude-3.5"
    // or just return the full ID if you prefer
    return branch.model;
  }
  
  return null;
});

const participantColor = computed(() => {
  const branch = currentBranch.value;
  
  // Only color assistant messages
  if (branch.role !== 'assistant') {
    return undefined;
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

const store = useStore();

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
</script>

<style scoped>
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
</style>

