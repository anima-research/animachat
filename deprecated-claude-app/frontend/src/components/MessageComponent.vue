<template>
  <v-card
    :class="[
      'mb-4',
      message.branches[branchIndex].role === 'user' ? 'ml-auto' : 'mr-auto'
    ]"
    :style="{
      maxWidth: '80%',
      alignSelf: message.branches[branchIndex].role === 'user' ? 'flex-end' : 'flex-start'
    }"
    :color="message.branches[branchIndex].role === 'user' ? 'primary' : 'surface'"
    :variant="message.branches[branchIndex].role === 'user' ? 'tonal' : 'elevated'"
  >
    <v-card-text>
      <div class="d-flex align-start mb-2">
        <v-icon
          :icon="message.branches[branchIndex].role === 'user' ? 'mdi-account' : 'mdi-robot'"
          size="small"
          class="mr-2"
        />
        <div class="text-caption">
          {{ participantName }}
        </div>
        
        <v-spacer />
        
        <div v-if="!isEditing" class="d-flex gap-1">
          <v-btn
            icon="mdi-pencil"
            size="x-small"
            variant="text"
            @click="startEdit"
          />
          
          <v-btn
            v-if="message.branches[branchIndex].role === 'assistant'"
            icon="mdi-refresh"
            size="x-small"
            variant="text"
            @click="$emit('regenerate', message.id, currentBranch.id)"
          />
          
          <v-btn
            icon="mdi-content-copy"
            size="x-small"
            variant="text"
            @click="copyContent"
          />
          
          <v-btn
            icon="mdi-delete-outline"
            size="x-small"
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
        <v-chip
          v-for="attachment in currentBranch.attachments"
          :key="attachment.id"
          class="mr-2 mb-1"
          size="small"
          color="grey-lighten-2"
        >
          <v-icon start size="x-small">mdi-paperclip</v-icon>
          {{ attachment.fileName }}
          <span class="ml-1 text-caption">({{ formatFileSize(attachment.fileSize || 0) }})</span>
        </v-chip>
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
      
      <!-- Branch navigation -->
      <div
        v-if="hasNavigableBranches"
        class="branch-navigation"
      >
        <v-btn
          icon="mdi-chevron-left"
          size="x-small"
          variant="text"
          :disabled="siblingIndex === 0"
          @click="navigateBranch(-1)"
        />
        
        <span>
          {{ siblingIndex + 1 }} / {{ siblingBranches.length }}
        </span>
        
        <v-btn
          icon="mdi-chevron-right"
          size="x-small"
          variant="text"
          :disabled="siblingIndex === siblingBranches.length - 1"
          @click="navigateBranch(1)"
        />
        
        <v-chip
          v-if="siblingIndex > 0"
          size="x-small"
          class="ml-2"
        >
          {{ getBranchLabel(branchIndex) }}
        </v-chip>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Message, MessageBranch, Participant } from '@deprecated-claude/shared';

const props = defineProps<{
  message: Message;
  participants?: Participant[];
}>();

const emit = defineEmits<{
  regenerate: [messageId: string, branchId: string];
  edit: [messageId: string, branchId: string, content: string];
  'switch-branch': [messageId: string, branchId: string];
  delete: [messageId: string, branchId: string];
}>();

const isEditing = ref(false);
const editContent = ref('');

const branchIndex = computed(() => {
  return props.message.branches.findIndex(b => b.id === props.message.activeBranchId) || 0;
});

const currentBranch = computed(() => {
  const branch = props.message.branches[branchIndex.value];
  if (branch?.attachments?.length > 0) {
    console.log(`Message ${props.message.id} has ${branch.attachments.length} attachments:`, branch.attachments);
  }
  return branch;
});

// Get participant name for current branch
const participantName = computed(() => {
  const branch = currentBranch.value;
  
  // If no participants list provided or no participantId, fall back to default behavior
  if (!props.participants || !branch.participantId) {
    return branch.role === 'user' ? 'You' : branch.model || 'Assistant';
  }
  
  // Find the participant by ID
  const participant = props.participants.find(p => p.id === branch.participantId);
  if (participant) {
    return participant.name;
  }
  
  // Fallback if participant not found
  return branch.role === 'user' ? 'You' : branch.model || 'Assistant';
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
  const content = currentBranch.value.content;
  
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
  
  const html = marked(content);
  return DOMPurify.sanitize(html);
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
  if (editContent.value.trim() !== currentBranch.value.content) {
    emit('edit', props.message.id, currentBranch.value.id, editContent.value.trim());
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

function getBranchLabel(index: number): string {
  // Determine if this is an edit or regeneration
  const branch = props.message.branches[index];
  const originalBranch = props.message.branches[0];
  
  if (branch.role === originalBranch.role && branch.parentBranchId) {
    return 'edited';
  }
  return 'regenerated';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
</script>
