<template>
  <v-dialog
    v-model="dialog"
    max-width="800"
    scrollable
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-share-variant</v-icon>
        Manage Shared Conversations
        <v-spacer />
        <v-btn
          icon="mdi-close"
          variant="text"
          @click="dialog = false"
        />
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-0">
        <!-- Loading state -->
        <div v-if="loading" class="pa-6 text-center">
          <v-progress-circular indeterminate color="primary" />
          <div class="mt-3 text-grey">Loading shares...</div>
        </div>

        <!-- Empty state -->
        <div v-else-if="shares.length === 0" class="pa-6 text-center">
          <v-icon size="64" color="grey-lighten-1">mdi-share-variant-outline</v-icon>
          <div class="text-h6 mt-3">No Shared Conversations</div>
          <div class="text-grey mt-2">
            You haven't shared any conversations yet. Share a conversation to see it here.
          </div>
        </div>

        <!-- Shares list -->
        <v-list v-else lines="three" class="py-0">
          <template v-for="(share, index) in shares" :key="share.id">
            <v-list-item>
              <template #prepend>
                <v-icon :color="share.shareType === 'tree' ? 'primary' : 'secondary'">
                  {{ share.shareType === 'tree' ? 'mdi-file-tree' : 'mdi-source-branch' }}
                </v-icon>
              </template>

              <v-list-item-title class="font-weight-medium">
                {{ getConversationTitle(share) }}
              </v-list-item-title>
              
              <v-list-item-subtitle>
                <div class="d-flex align-center gap-2 flex-wrap mt-1">
                  <v-chip size="x-small" variant="tonal" :color="share.shareType === 'tree' ? 'primary' : 'secondary'">
                    {{ share.shareType === 'tree' ? 'Full Tree' : 'Single Branch' }}
                  </v-chip>
                  <span class="text-caption">
                    Created {{ formatDate(share.createdAt) }}
                  </span>
                  <span v-if="share.viewCount" class="text-caption">
                    • {{ share.viewCount }} view{{ share.viewCount !== 1 ? 's' : '' }}
                  </span>
                  <span v-if="share.expiresAt" class="text-caption" :class="{ 'text-error': isExpiringSoon(share.expiresAt) }">
                    • Expires {{ formatDate(share.expiresAt) }}
                  </span>
                </div>
                <div v-if="share.settings?.description" class="text-caption mt-1 text-grey">
                  {{ share.settings.description }}
                </div>
              </v-list-item-subtitle>

              <template #append>
                <div class="d-flex align-center gap-1">
                  <v-btn
                    icon="mdi-content-copy"
                    size="small"
                    variant="text"
                    @click="copyShareLink(share)"
                    title="Copy link"
                  />
                  <v-btn
                    icon="mdi-open-in-new"
                    size="small"
                    variant="text"
                    :href="share.shareUrl || share.url"
                    target="_blank"
                    title="Open in new tab"
                  />
                  <v-btn
                    icon="mdi-delete"
                    size="small"
                    variant="text"
                    color="error"
                    @click="confirmDelete(share)"
                    title="Delete share"
                  />
                </div>
              </template>
            </v-list-item>
            
            <v-divider v-if="index < shares.length - 1" />
          </template>
        </v-list>
      </v-card-text>

      <v-divider v-if="shares.length > 0" />

      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="dialog = false"
        >
          Close
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Delete confirmation dialog -->
  <v-dialog
    v-model="deleteDialog"
    max-width="400"
  >
    <v-card v-if="shareToDelete">
      <v-card-title>Delete Shared Link?</v-card-title>
      <v-card-text>
        Are you sure you want to delete this shared link? The link will become invalid immediately.
        <div class="mt-3 pa-2 bg-grey-lighten-4 rounded">
          <div class="font-weight-medium">{{ getConversationTitle(shareToDelete) }}</div>
          <div class="text-caption text-grey mt-1">
            {{ shareToDelete.shareType === 'tree' ? 'Full conversation tree' : 'Single branch' }}
          </div>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="deleteDialog = false"
        >
          Cancel
        </v-btn>
        <v-btn
          color="error"
          variant="flat"
          @click="deleteShare"
          :loading="deleting"
        >
          Delete
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Snackbar for notifications -->
  <v-snackbar
    v-model="snackbar"
    :color="snackbarColor"
    :timeout="3000"
  >
    {{ snackbarText }}
  </v-snackbar>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '../services/api';

interface SharedConversation {
  id: string;
  conversationId: string;
  shareToken: string;
  shareType: 'branch' | 'tree';
  branchId?: string;
  settings: {
    title?: string;
    description?: string;
    showModelInfo: boolean;
    showTimestamps: boolean;
    allowDownload: boolean;
  };
  createdAt: string;
  expiresAt?: string;
  viewCount: number;
  url?: string;
  shareUrl?: string;
}

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const dialog = ref(false);
const loading = ref(false);
const shares = ref<SharedConversation[]>([]);
const deleteDialog = ref(false);
const shareToDelete = ref<SharedConversation | null>(null);
const deleting = ref(false);
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');

// Sync dialog with v-model
watch(() => props.modelValue, (val) => {
  dialog.value = val;
  if (val) {
    loadShares();
  }
});

watch(dialog, (val) => {
  emit('update:modelValue', val);
});

async function loadShares() {
  loading.value = true;
  try {
    const response = await api.get('/shares/my-shares');
    shares.value = response.data;
  } catch (error) {
    console.error('Failed to load shares:', error);
    showSnackbar('Failed to load shares', 'error');
  } finally {
    loading.value = false;
  }
}

function getConversationTitle(share: SharedConversation): string {
  return share.settings?.title || `Conversation ${share.conversationId.substring(0, 8)}`;
}

function formatDate(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      if (diffMinutes === 0) {
        return 'just now';
      }
      return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    }
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  } else if (diffDays === 1) {
    return 'yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
  } else {
    return d.toLocaleDateString();
  }
}

function isExpiringSoon(expiresAt: string): boolean {
  const expires = new Date(expiresAt);
  const now = new Date();
  const diffMs = expires.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours < 24 && diffHours > 0;
}

async function copyShareLink(share: SharedConversation) {
  try {
    const url = share.shareUrl || share.url || '';
    if (!url) {
      showSnackbar('No URL available for this share', 'error');
      return;
    }
    await navigator.clipboard.writeText(url);
    showSnackbar('Link copied to clipboard', 'success');
  } catch (error) {
    console.error('Failed to copy link:', error);
    showSnackbar('Failed to copy link', 'error');
  }
}

function confirmDelete(share: SharedConversation) {
  shareToDelete.value = share;
  deleteDialog.value = true;
}

async function deleteShare() {
  if (!shareToDelete.value) return;
  
  deleting.value = true;
  try {
    await api.delete(`/shares/${shareToDelete.value.id}`);
    shares.value = shares.value.filter(s => s.id !== shareToDelete.value?.id);
    deleteDialog.value = false;
    showSnackbar('Share deleted successfully', 'success');
  } catch (error) {
    console.error('Failed to delete share:', error);
    showSnackbar('Failed to delete share', 'error');
  } finally {
    deleting.value = false;
  }
}

function showSnackbar(text: string, color: string = 'success') {
  snackbarText.value = text;
  snackbarColor.value = color;
  snackbar.value = true;
}
</script>

<style scoped>
.gap-1 {
  gap: 4px;
}

.gap-2 {
  gap: 8px;
}

.bg-grey-lighten-4 {
  background-color: #f5f5f5;
}
</style>
