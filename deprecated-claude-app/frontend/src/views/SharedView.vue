<template>
  <v-app>
    <v-app-bar density="compact">
      <v-app-bar-title>
        {{ shareData?.conversation?.title || 'Shared Conversation' }}
      </v-app-bar-title>
      
      <v-spacer />
      
      <v-chip
        v-if="shareData?.share?.shareType === 'branch'"
        size="small"
        variant="outlined"
        class="mr-2"
      >
        <v-icon start size="small">mdi-source-branch</v-icon>
        Branch View
      </v-chip>
      
      <v-chip
        v-else-if="shareData?.share?.shareType === 'tree'"
        size="small"
        variant="outlined"
        class="mr-2"
      >
        <v-icon start size="small">mdi-file-tree</v-icon>
        Full Tree
      </v-chip>
      
      <v-btn
        v-if="shareData?.share?.settings?.allowDownload"
        icon="mdi-download"
        size="small"
        @click="downloadConversation"
        title="Download conversation"
      />
    </v-app-bar>
    
    <v-main>
      <v-container fluid class="pa-0" style="height: 100vh;">
        <div v-if="isLoading" class="d-flex align-center justify-center" style="height: 100%;">
          <v-progress-circular indeterminate color="primary" />
        </div>
        
        <div v-else-if="error" class="d-flex align-center justify-center" style="height: 100%;">
          <v-alert type="error" variant="outlined" max-width="400">
            {{ error }}
          </v-alert>
        </div>
        
        <div v-else-if="shareData" class="d-flex flex-column" style="height: 100%;">
          <!-- Description if provided -->
          <v-alert
            v-if="shareData.share.settings.description"
            type="info"
            variant="tonal"
            density="compact"
            class="ma-4 mb-0"
          >
            {{ shareData.share.settings.description }}
          </v-alert>
          
          <!-- Messages container -->
          <div class="flex-grow-1 overflow-auto pa-4" ref="messagesContainer">
            <div class="mx-auto" style="max-width: 900px;">
              <div
                v-for="(message, index) in displayMessages"
                :key="message.id"
                class="mb-4"
              >
                <SharedMessageComponent
                  :message="message"
                  :participants="shareData.participants"
                  :show-timestamps="shareData.share.settings.showTimestamps"
                  :show-model-info="shareData.share.settings.showModelInfo"
                  :allow-download="shareData.share.settings.allowDownload"
                  :conversation-id="shareData.conversation.id"
                  :is-tree-view="shareData.share.shareType === 'tree'"
                  @navigate-branch="navigateBranch"
                />
              </div>
              
              <div v-if="displayMessages.length === 0" class="text-center text-grey">
                No messages to display
              </div>
            </div>
          </div>
          
          <!-- View info footer -->
          <v-footer app height="auto" class="pa-2 text-caption">
            <div>
              Shared {{ formatDate(shareData.share.createdAt) }}
              <span v-if="shareData.share.viewCount">
                • {{ shareData.share.viewCount }} view{{ shareData.share.viewCount !== 1 ? 's' : '' }}
              </span>
              <span v-if="shareData.share.expiresAt">
                • Expires {{ formatDate(shareData.share.expiresAt) }}
              </span>
            </div>
          </v-footer>
        </div>
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/services/api';
import SharedMessageComponent from '@/components/SharedMessageComponent.vue';

const route = useRoute();

const shareData = ref<any>(null);
const isLoading = ref(true);
const error = ref('');
const messagesContainer = ref<HTMLElement>();

// For tree navigation
const activeBranchPath = ref<Set<string>>(new Set());

const displayMessages = computed(() => {
  if (!shareData.value) return [];
  
  const messages = shareData.value.messages;
  
  // If tree view, we might want to show branch indicators
  if (shareData.value.share.shareType === 'tree') {
    // For tree view, show all messages but highlight the active path
    return messages.map((msg: any) => ({
      ...msg,
      // Mark which branch is active for display
      branches: msg.branches.map((branch: any) => ({
        ...branch,
        isInActivePath: activeBranchPath.value.has(branch.id)
      }))
    }));
  }
  
  // For branch view, messages are already filtered by the backend
  return messages;
});

onMounted(async () => {
  await loadShare();
});

async function loadShare() {
  const token = route.params.token as string;
  
  try {
    isLoading.value = true;
    error.value = '';
    
    // No auth header needed - this is a public endpoint
    const response = await api.get(`/shares/${token}`, {
      headers: {} // Override default auth headers
    });
    
    shareData.value = response.data;
    
    // Initialize active branch path if tree view
    if (shareData.value.share.shareType === 'tree' && shareData.value.messages.length > 0) {
      // Build the active path from the last message
      const lastMessage = shareData.value.messages[shareData.value.messages.length - 1];
      buildActivePath(lastMessage.activeBranchId);
    }
  } catch (err: any) {
    console.error('Failed to load share:', err);
    if (err.response?.status === 404) {
      error.value = 'This share link is invalid or has expired.';
    } else {
      error.value = 'Failed to load shared conversation.';
    }
  } finally {
    isLoading.value = false;
  }
}

function buildActivePath(leafBranchId: string) {
  activeBranchPath.value.clear();
  
  let currentBranchId: string | undefined = leafBranchId;
  const messagesByBranchId = new Map<string, any>();
  
  // Build lookup map
  for (const msg of shareData.value.messages) {
    for (const branch of msg.branches) {
      messagesByBranchId.set(branch.id, msg);
    }
  }
  
  // Walk backwards from leaf to root
  while (currentBranchId && currentBranchId !== 'root') {
    activeBranchPath.value.add(currentBranchId);
    
    const message = messagesByBranchId.get(currentBranchId);
    if (!message) break;
    
    const branch = message.branches.find((b: any) => b.id === currentBranchId);
    if (!branch) break;
    
    currentBranchId = branch.parentBranchId;
  }
}

function navigateBranch(messageId: string, branchId: string) {
  // Only works in tree view
  if (shareData.value.share.shareType !== 'tree') return;
  
  // Find the message and update its active branch
  const message = shareData.value.messages.find((m: any) => m.id === messageId);
  if (message) {
    message.activeBranchId = branchId;
    
    // Rebuild the active path from this point
    buildActivePath(branchId);
    
    // Update all downstream messages' active branches
    updateDownstreamBranches(messageId, branchId);
  }
}

function updateDownstreamBranches(messageId: string, branchId: string) {
  // Find messages that have this branch as parent and update their active branch
  const messageIndex = shareData.value.messages.findIndex((m: any) => m.id === messageId);
  
  for (let i = messageIndex + 1; i < shareData.value.messages.length; i++) {
    const msg = shareData.value.messages[i];
    
    // Find a branch that has the current branch as parent
    const childBranch = msg.branches.find((b: any) => b.parentBranchId === branchId);
    if (childBranch) {
      msg.activeBranchId = childBranch.id;
      buildActivePath(childBranch.id);
      break;
    }
  }
}

async function downloadConversation() {
  if (!shareData.value) return;
  
  const data = {
    title: shareData.value.conversation.title,
    messages: shareData.value.messages,
    participants: shareData.value.participants,
    exportDate: new Date().toISOString()
  };
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${shareData.value.conversation.title || 'conversation'}-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatDate(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return 'today';
  } else if (diffDays === 1) {
    return 'yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return d.toLocaleDateString();
  }
}
</script>

<style scoped>
.v-footer {
  background: rgba(var(--v-theme-surface), 0.95);
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
