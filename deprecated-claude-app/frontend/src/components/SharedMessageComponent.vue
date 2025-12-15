<template>
  <v-card flat class="message-card">
    <v-card-text class="pa-4">
      <!-- Message header -->
      <div class="d-flex align-center mb-2">
        <v-icon 
          :icon="currentBranch.role === 'user' ? 'mdi-account' : 'mdi-robot'"
          :color="currentBranch.role === 'user' ? 'primary' : modelColor"
          size="small"
          class="mr-2"
        />
        
        <div class="font-weight-medium">
          {{ participantName || (currentBranch.role === 'user' ? 'User' : 'Assistant') }}
        </div>
        
        <div v-if="showModelInfo && modelDisplayName" class="text-caption ml-2 text-grey">
          ({{ modelDisplayName }})
        </div>
        
        <div v-if="showTimestamps && currentBranch.createdAt" class="text-caption ml-2 text-grey">
          {{ formatTimestamp(currentBranch.createdAt) }}
        </div>
        
        <v-spacer />
        
        <!-- Branch navigation for tree view -->
        <div v-if="isTreeView && message.branches.length > 1" class="d-flex align-center gap-1">
          <v-btn
            icon="mdi-chevron-left"
            size="x-small"
            variant="text"
            :disabled="currentBranchIndex === 0"
            @click="navigateBranch(-1)"
          />
          <span class="text-caption">
            {{ currentBranchIndex + 1 }} / {{ message.branches.length }}
          </span>
          <v-btn
            icon="mdi-chevron-right"
            size="x-small"
            variant="text"
            :disabled="currentBranchIndex === message.branches.length - 1"
            @click="navigateBranch(1)"
          />
        </div>
        
        <!-- Action buttons -->
        <div class="d-flex gap-1">
          <v-btn
            icon="mdi-link"
            size="x-small"
            variant="text"
            @click="copyLink"
            title="Copy link to message"
          />
          
          <v-btn
            icon="mdi-content-copy"
            size="x-small"
            variant="text"
            @click="copyContent"
            title="Copy message"
          />
          
          <v-btn
            v-if="allowDownload"
            icon="mdi-code-json"
            size="x-small"
            variant="text"
            @click="downloadPrompt"
            title="Download prompt"
          />
        </div>
      </div>
      
      <!-- Message content -->
      <div class="message-content" v-html="renderedContent" />
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { getModelColor } from '@/utils/modelColors';
import { renderLatex, KATEX_ALLOWED_TAGS, KATEX_ALLOWED_ATTRS } from '@/utils/latex';
import { api } from '@/services/api';
import 'katex/dist/katex.min.css';

const props = defineProps<{
  message: any;
  participants?: any[];
  showTimestamps?: boolean;
  showModelInfo?: boolean;
  allowDownload?: boolean;
  conversationId: string;
  isTreeView?: boolean;
}>();

const emit = defineEmits<{
  'navigate-branch': [messageId: string, branchId: string];
  'copy-link': [messageId: string];
}>();

const currentBranchIndex = computed(() => {
  return props.message.branches.findIndex((b: any) => b.id === props.message.activeBranchId) || 0;
});

const currentBranch = computed(() => {
  return props.message.branches[currentBranchIndex.value] || props.message.branches[0];
});

// Find the participant for this message
const currentParticipant = computed(() => {
  if (!props.participants || !currentBranch.value.participantId) {
    return null;
  }
  return props.participants.find(p => p.id === currentBranch.value.participantId) || null;
});

const participantName = computed(() => {
  if (currentParticipant.value) {
    return currentParticipant.value.name || null;
  }
  return null;
});

// Get the model display name - prefer participant's modelDisplayName, then model ID
const modelDisplayName = computed(() => {
  // First try to use the pre-resolved display name from the backend
  if (currentParticipant.value?.modelDisplayName) {
    return currentParticipant.value.modelDisplayName;
  }
  
  const branchModel = currentBranch.value.model;
  const isUuid = branchModel && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branchModel);
  
  // If branch.model looks like a UUID (participant ID), try to use participant's model instead
  if (isUuid) {
    // Try to get model from the participant
    if (currentParticipant.value?.model) {
      return currentParticipant.value.model;
    }
    // If we can't find the participant, don't show the UUID - return null
    return null;
  }
  return branchModel;
});

const modelColor = computed(() => {
  // Use the participant's model for color, or fall back to branch model
  const model = currentParticipant.value?.model || currentBranch.value.model;
  if (!model) return 'grey';
  return getModelColor(model);
});

const renderedContent = computed(() => {
  const content = currentBranch.value.content || '';
  
  // Configure marked to respect single line breaks
  marked.setOptions({
    breaks: true,  // This makes single newlines render as <br>
    gfm: true      // GitHub Flavored Markdown
  });
  
  // Markdown + LaTeX rendering
  try {
    let html = marked.parse ? marked.parse(content) : (marked as any)(content);
    // Render LaTeX after markdown
    html = renderLatex(html as string);
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre',
        'blockquote', 'ul', 'ol', 'li', 'a', 'img',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'hr', 'sup', 'sub', 'del', 'ins',
        ...KATEX_ALLOWED_TAGS
      ],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel', ...KATEX_ALLOWED_ATTRS]
    });
  } catch (e) {
    // Fallback to plain text with line breaks
    return content.replace(/\n/g, '<br>');
  }
});

function navigateBranch(direction: number) {
  const newIndex = currentBranchIndex.value + direction;
  if (newIndex >= 0 && newIndex < props.message.branches.length) {
    const newBranch = props.message.branches[newIndex];
    emit('navigate-branch', props.message.id, newBranch.id);
  }
}

function copyContent() {
  navigator.clipboard.writeText(currentBranch.value.content);
}

function copyLink() {
  emit('copy-link', props.message.id);
}

async function downloadPrompt() {
  try {
    // Build the prompt from this point
    // Since we don't have auth, we'll build it client-side from the available data
    const messages = buildMessagesUpToHere();
    
    const blob = new Blob([JSON.stringify(messages, null, 2)], { type: 'application/json' });
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

function buildMessagesUpToHere(): any[] {
  // This is a simplified version - in production you'd want to
  // properly build the message history following the branch path
  return [{
    role: currentBranch.value.role,
    content: currentBranch.value.content
  }];
}

function formatTimestamp(timestamp: string | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffDays === 0) {
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
  }
  
  if (diffDays === 1) {
    return `Yesterday ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }
  
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  }
  
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined 
  });
}
</script>

<style scoped>
.message-card {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.message-content {
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.message-content :deep(pre) {
  background: rgba(0, 0, 0, 0.3);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.85em;
}

.message-content :deep(code) {
  background: rgba(0, 0, 0, 0.25);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
}

.message-content :deep(pre code) {
  background: transparent;
  padding: 0;
}

.message-content :deep(blockquote) {
  border-left: 3px solid rgba(var(--v-theme-primary), 0.5);
  padding-left: 12px;
  margin-left: 0;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
</style>
