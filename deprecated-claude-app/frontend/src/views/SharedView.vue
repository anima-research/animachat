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
        v-if="shareData?.share?.shareType === 'tree'"
        :icon="showTreeView ? 'mdi-message-text' : 'mdi-file-tree-outline'"
        size="small"
        @click="showTreeView = !showTreeView"
        :title="showTreeView ? 'Show messages' : 'Show tree'"
      />
      
      <v-btn
        v-if="shareData?.share?.settings?.allowDownload"
        icon="mdi-download"
        size="small"
        @click="downloadConversation"
        title="Download conversation"
      />
    </v-app-bar>
    
    <v-main>
      <div class="d-flex flex-column" style="height: calc(100vh - 48px);">
        <div v-if="isLoading" class="flex-grow-1 d-flex align-center justify-center">
          <v-progress-circular indeterminate color="primary" />
        </div>
        
        <div v-else-if="error" class="flex-grow-1 d-flex align-center justify-center">
          <v-alert type="error" variant="outlined" max-width="400">
            {{ error }}
          </v-alert>
        </div>
        
        <div v-else-if="shareData" class="flex-grow-1 d-flex flex-column" style="overflow: hidden;">
          <!-- Description if provided -->
          <v-alert
            v-if="shareData.share.settings.description"
            type="info"
            variant="outlined"
            density="compact"
            class="ma-4 mb-0 flex-shrink-0"
            style="background: rgba(var(--v-theme-info), 0.05); overflow: visible;"
          >
            <div style="color: rgba(var(--v-theme-on-surface), 0.87); word-wrap: break-word;">
              {{ shareData.share.settings.description }}
            </div>
          </v-alert>
          
          <!-- Tree view -->
          <div v-if="showTreeView && shareData.share.shareType === 'tree'" class="flex-grow-1 overflow-auto pa-4">
            <div class="mx-auto" style="max-width: 1200px;">
              <!-- Focus breadcrumb -->
              <div v-if="focusNodeId" class="mb-3 d-flex align-center">
                <v-btn
                  size="small"
                  variant="tonal"
                  @click="focusNodeId = null"
                  prepend-icon="mdi-home"
                >
                  Root
                </v-btn>
                <v-icon class="mx-2">mdi-chevron-right</v-icon>
                <v-chip size="small" variant="outlined">
                  Focused on: {{ getFocusedNodePreview() }}
                </v-chip>
              </div>
              
              <div class="tree-container">
                <div class="tree-node" v-for="(node, index) in treeNodes" :key="index">
                  <div 
                    class="tree-indent"
                    :style="{ marginLeft: `${node.depth * 10}px` }"
                  >
                    <div v-if="node.type === 'branch'" class="branch-indicator">
                      <v-icon size="x-small">mdi-source-branch</v-icon>
                    </div>
                    <v-card
                      v-else
                      :id="`message-${node.message.id}`"
                      class="tree-message-card"
                      :class="{ 
                        'active-branch': node.isActive,
                        'clickable': node.message.branches.length > 1,
                        'focus-root': node.branch.id === focusNodeId,
                        'is-ancestor': node.isAncestor
                      }"
                      @click="node.message.branches.length > 1 && navigateBranch(node.message.id, node.branch.id)"
                    >
                      <v-card-text class="pa-2">
                        <div class="d-flex align-center mb-1">
                          <v-icon 
                            :icon="node.branch.role === 'user' ? 'mdi-account' : 'mdi-robot'"
                            :color="node.branch.role === 'user' ? 'primary' : 'grey'"
                            size="x-small"
                            class="mr-1"
                          />
                          <span class="text-caption font-weight-medium">
                            {{ getParticipantName(node.branch) || (node.branch.role === 'user' ? 'H' : 'A') }}
                          </span>
                          <v-spacer />
                          <div class="d-flex gap-2">
                            <v-btn
                              icon="mdi-target"
                              size="small"
                              variant="tonal"
                              color="primary"
                              @click.stop="focusOnNode(node.branch.id)"
                              title="Focus on this node"
                            />
                            <v-btn
                              icon="mdi-link"
                              size="small"
                              variant="tonal"
                              @click.stop="copyMessageLink(node.message.id)"
                              title="Copy link to this message"
                            />
                          </div>
                        </div>
                        <div 
                          class="text-body-2 message-content-tree"
                          :class="{ 'expanded': node.isActive || expandedNodes.has(node.branch.id) }"
                          @click="toggleNodeExpansion(node.branch.id)"
                          style="cursor: pointer"
                        >
                          <v-icon 
                            v-if="node.branch.content.length > 150"
                            size="x-small" 
                            class="mr-1"
                          >
                            {{ (node.isActive || expandedNodes.has(node.branch.id)) ? 'mdi-chevron-down' : 'mdi-chevron-right' }}
                          </v-icon>
                          {{ (node.isActive || expandedNodes.has(node.branch.id)) ? node.branch.content : (node.branch.content.substring(0, 150) + (node.branch.content.length > 150 ? '...' : '')) }}
                        </div>
                        <div v-if="node.message.branches.length > 1" class="text-caption text-grey mt-1">
                          Branch {{ node.branchIndex + 1 }} of {{ node.message.branches.length }}
                        </div>
                      </v-card-text>
                    </v-card>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Messages container -->
          <div v-else class="flex-grow-1 overflow-auto pa-4" ref="messagesContainer">
            <div class="mx-auto" style="max-width: 900px;">
              <div
                v-for="(message, index) in displayMessages"
                :key="message.id"
                :id="`message-${message.id}`"
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
                  @copy-link="copyMessageLink"
                />
              </div>
              
              <div v-if="displayMessages.length === 0" class="text-center text-grey">
                No messages to display
              </div>
            </div>
          </div>
          
        </div>
        
        <!-- Footer at bottom of viewport -->
        <div 
          v-if="shareData" 
          class="pa-2 text-caption flex-shrink-0"
          style="border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); background: rgba(var(--v-theme-surface), 0.95);"
        >
          <div>
            Shared {{ formatDate(shareData?.share?.createdAt) }}
            <span v-if="shareData?.share?.viewCount">
              • {{ shareData.share.viewCount }} view{{ shareData.share.viewCount !== 1 ? 's' : '' }}
            </span>
            <span v-if="shareData?.share?.expiresAt">
              • Expires {{ formatDate(shareData.share.expiresAt) }}
            </span>
          </div>
        </div>
      </div>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/services/api';
import SharedMessageComponent from '@/components/SharedMessageComponent.vue';

const route = useRoute();

const shareData = ref<any>(null);
const isLoading = ref(true);
const error = ref('');
const messagesContainer = ref<HTMLElement>();
const showTreeView = ref(false);
const focusNodeId = ref<string | null>(null);
const expandedNodes = ref<Set<string>>(new Set());

// For tree navigation
const activeBranchPath = ref<Set<string>>(new Set());

const displayMessages = computed(() => {
  if (!shareData.value) return [];
  
  const messages = shareData.value.messages;
  
  // If tree view, only show messages on the active path
  if (shareData.value.share.shareType === 'tree') {
    const visibleMessages: any[] = [];
    let lastBranchId = 'root';
    
    for (const msg of messages) {
      // Find a branch that continues from the last branch
      const continuingBranch = msg.branches.find((b: any) => 
        b.parentBranchId === lastBranchId && b.id === msg.activeBranchId
      );
      
      if (continuingBranch) {
        visibleMessages.push({
          ...msg,
          // Mark which branch is active for display
          branches: msg.branches.map((branch: any) => ({
            ...branch,
            isInActivePath: activeBranchPath.value.has(branch.id)
          }))
        });
        lastBranchId = continuingBranch.id;
      }
    }
    
    return visibleMessages;
  }
  
  // For branch view, messages are already filtered by the backend
  return messages;
});

const treeNodes = computed(() => {
  if (!shareData.value || !shareData.value.messages) return [];
  
  const nodes: any[] = [];
  const processedBranches = new Set<string>();
  
  // Determine starting point based on focus
  const startBranchId = focusNodeId.value || 'root';
  const startDepth = 0;
  
  // If we have a focus node, optionally show its ancestors with negative depth
  if (focusNodeId.value) {
    // Find path from root to focus node
    const pathToFocus: any[] = [];
    let currentId = focusNodeId.value;
    
    while (currentId && currentId !== 'root') {
      for (const msg of shareData.value.messages) {
        const branch = msg.branches.find((b: any) => b.id === currentId);
        if (branch) {
          pathToFocus.unshift({ message: msg, branch, branchIndex: msg.branches.indexOf(branch) });
          currentId = branch.parentBranchId;
          break;
        }
      }
    }
    
    // Add ancestors with negative depth (optional - comment out if you don't want to see ancestors)
    pathToFocus.forEach((item, index) => {
      if (!processedBranches.has(item.branch.id)) {
        processedBranches.add(item.branch.id);
        nodes.push({
          type: 'message',
          message: item.message,
          branch: item.branch,
          branchIndex: item.branchIndex,
          depth: index - pathToFocus.length,
          isActive: item.branch.id === item.message.activeBranchId,
          isAncestor: true
        });
      }
    });
  }
  
  // Build tree structure from focus point
  function addBranches(parentBranchId: string, depth: number, maxDepth: number = 10) {
    // Limit depth to prevent infinite recursion and save horizontal space
    if (depth > maxDepth) return;
    
    for (const msg of shareData.value.messages) {
      for (let branchIndex = 0; branchIndex < msg.branches.length; branchIndex++) {
        const branch = msg.branches[branchIndex];
        
        if (branch.parentBranchId === parentBranchId && !processedBranches.has(branch.id)) {
          processedBranches.add(branch.id);
          
          // Add branch indicator if this is not the first branch of a message
          if (branchIndex > 0 && nodes.length > 0 && nodes[nodes.length - 1].message.id === msg.id) {
            nodes.push({
              type: 'branch',
              depth: depth - 1
            });
          }
          
          nodes.push({
            type: 'message',
            message: msg,
            branch: branch,
            branchIndex: branchIndex,
            depth: depth,
            isActive: branch.id === msg.activeBranchId
          });
          
          // Recursively add children
          addBranches(branch.id, depth + 1, maxDepth);
        }
      }
    }
  }
  
  addBranches(startBranchId, startDepth);
  return nodes;
});

function getParticipantName(branch: any): string | null {
  if (!shareData.value.participants || !branch.participantId) {
    return null;
  }
  const participant = shareData.value.participants.find((p: any) => p.id === branch.participantId);
  return participant?.name || null;
}

onMounted(async () => {
  await loadShare();
  
  // Check for message hash in URL
  if (window.location.hash) {
    await scrollToMessage(window.location.hash.substring(1));
  }
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
    
    // Rebuild the entire conversation path from this branch
    rebuildConversationPath(branchId);
  }
}

function rebuildConversationPath(changedBranchId: string) {
  // First, build the path from root to the changed branch
  const pathToChanged: string[] = [];
  let currentBranchId: string | undefined = changedBranchId;
  
  const messagesByBranchId = new Map<string, any>();
  for (const msg of shareData.value.messages) {
    for (const branch of msg.branches) {
      messagesByBranchId.set(branch.id, { message: msg, branch });
    }
  }
  
  // Build path backwards from changed branch to root
  while (currentBranchId && currentBranchId !== 'root') {
    pathToChanged.unshift(currentBranchId);
    const entry = messagesByBranchId.get(currentBranchId);
    if (!entry) break;
    currentBranchId = entry.branch.parentBranchId;
  }
  
  // Now update all messages to follow this path
  let lastBranchId = 'root';
  
  for (const msg of shareData.value.messages) {
    // Find if this message has a branch that continues from the last branch
    const continuingBranch = msg.branches.find((b: any) => 
      b.parentBranchId === lastBranchId
    );
    
    if (continuingBranch) {
      // Check if this message is on our path
      const pathBranch = msg.branches.find((b: any) => 
        pathToChanged.includes(b.id)
      );
      
      if (pathBranch) {
        // Use the branch that's on our path
        msg.activeBranchId = pathBranch.id;
        lastBranchId = pathBranch.id;
      } else {
        // Not on our path, use the first valid continuing branch
        msg.activeBranchId = continuingBranch.id;
        lastBranchId = continuingBranch.id;
      }
    }
  }
  
  // Rebuild the active path for visualization
  buildActivePath(lastBranchId);
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

async function scrollToMessage(messageId: string) {
  await nextTick();
  const element = document.getElementById(messageId);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Add highlight effect
    element.classList.add('highlight-message');
    setTimeout(() => {
      element.classList.remove('highlight-message');
    }, 2000);
  }
}

function copyMessageLink(messageId: string) {
  const url = new URL(window.location.href);
  url.hash = `message-${messageId}`;
  navigator.clipboard.writeText(url.toString());
  // TODO: Show toast notification
}

function focusOnNode(branchId: string) {
  focusNodeId.value = branchId;
}

function getFocusedNodePreview(): string {
  if (!focusNodeId.value || !shareData.value) return '';
  
  for (const msg of shareData.value.messages) {
    const branch = msg.branches.find((b: any) => b.id === focusNodeId.value);
    if (branch) {
      const preview = branch.content.substring(0, 50);
      return preview + (branch.content.length > 50 ? '...' : '');
    }
  }
  
  return 'Unknown';
}

function toggleNodeExpansion(branchId: string) {
  if (expandedNodes.value.has(branchId)) {
    expandedNodes.value.delete(branchId);
  } else {
    expandedNodes.value.add(branchId);
  }
  // Force reactivity update
  expandedNodes.value = new Set(expandedNodes.value);
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
.tree-container {
  padding: 20px;
}

.tree-node {
  margin-bottom: 8px;
}

.tree-indent {
  position: relative;
}

.branch-indicator {
  text-align: center;
  margin: 8px 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.tree-message-card {
  transition: all 0.2s;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.tree-message-card.active-branch {
  border: 2px solid rgba(var(--v-theme-primary), 0.5);
  background: rgba(var(--v-theme-primary), 0.08);
  box-shadow: 0 2px 8px rgba(var(--v-theme-primary), 0.15);
}

.tree-message-card.clickable {
  cursor: pointer;
}

.tree-message-card.clickable:hover {
  border-color: rgba(var(--v-theme-primary), 0.3);
  transform: translateX(2px);
}

.tree-message-card.focus-root {
  border: 2px solid rgba(var(--v-theme-warning), 0.5);
  background: rgba(var(--v-theme-warning), 0.1);
}

.tree-message-card.is-ancestor {
  opacity: 0.6;
  background: rgba(var(--v-theme-on-surface), 0.02);
}

.message-content-tree {
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  transition: all 0.3s ease;
}

.message-content-tree.expanded {
  display: block;
  -webkit-line-clamp: unset;
  max-height: 400px;
  overflow-y: auto;
  padding: 8px;
  background: rgba(var(--v-theme-surface), 0.5);
  border-radius: 4px;
  margin-top: 4px;
}

.highlight-message {
  animation: highlight 2s ease-out;
}

@keyframes highlight {
  0% {
    background-color: rgba(var(--v-theme-warning), 0.3);
  }
  100% {
    background-color: transparent;
  }
}
</style>
