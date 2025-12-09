<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="550"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-account-multiple-plus</v-icon>
        Share with Users
      </v-card-title>
      
      <v-card-text>
        <!-- Add new collaborator -->
        <div class="mb-4">
          <h4 class="text-subtitle-2 mb-2">Invite by email</h4>
          <div class="d-flex gap-2">
            <v-text-field
              v-model="newEmail"
              label="Email address"
              variant="outlined"
              density="compact"
              type="email"
              :error-messages="emailError"
              @keydown.enter="addCollaborator"
              class="flex-grow-1"
            />
            <v-select
              v-model="newPermission"
              :items="permissionOptions"
              variant="outlined"
              density="compact"
              style="max-width: 150px;"
            />
            <v-btn
              color="primary"
              variant="elevated"
              :loading="isAdding"
              :disabled="!newEmail"
              @click="addCollaborator"
            >
              Add
            </v-btn>
          </div>
        </div>
        
        <v-divider class="my-4" />
        
        <!-- Current collaborators -->
        <h4 class="text-subtitle-2 mb-2">
          People with access
          <v-chip size="x-small" class="ml-2">{{ collaborators.length }}</v-chip>
        </h4>
        
        <v-list v-if="collaborators.length > 0" density="compact" class="bg-transparent">
          <v-list-item
            v-for="collab in collaborators"
            :key="collab.id"
            class="px-0"
          >
            <template #prepend>
              <v-avatar size="32" color="primary" class="mr-3">
                <span class="text-caption">{{ getInitials(collab.sharedWithEmail) }}</span>
              </v-avatar>
            </template>
            
            <v-list-item-title>{{ collab.sharedWithEmail }}</v-list-item-title>
            <v-list-item-subtitle class="text-caption">
              Added {{ formatDate(collab.createdAt) }}
            </v-list-item-subtitle>
            
            <template #append>
              <v-select
                :model-value="collab.permission"
                :items="permissionOptions"
                variant="outlined"
                density="compact"
                hide-details
                style="max-width: 130px;"
                class="mr-2"
                @update:model-value="updatePermission(collab.id, $event)"
              />
              <v-btn
                icon="mdi-close"
                size="small"
                variant="text"
                color="error"
                @click="removeCollaborator(collab.id)"
              />
            </template>
          </v-list-item>
        </v-list>
        
        <v-alert v-else type="info" variant="tonal" density="compact">
          No one else has access to this conversation yet.
        </v-alert>
        
        <!-- Permission descriptions -->
        <v-expansion-panels class="mt-4" variant="accordion">
          <v-expansion-panel>
            <v-expansion-panel-title class="text-caption">
              <v-icon size="small" class="mr-2">mdi-help-circle-outline</v-icon>
              Permission levels explained
            </v-expansion-panel-title>
            <v-expansion-panel-text class="text-caption">
              <div class="mb-2">
                <strong>Viewer:</strong> Can read the conversation but cannot send messages.
              </div>
              <div class="mb-2">
                <strong>Collaborator:</strong> Can read and send messages, but cannot delete messages.
              </div>
              <div>
                <strong>Editor:</strong> Full access - can read, send, and delete messages.
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>
      
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">
          Done
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { api } from '@/services/api';
import type { Conversation } from '@deprecated-claude/shared';

interface Collaborator {
  id: string;
  conversationId: string;
  sharedWithUserId: string;
  sharedWithEmail: string;
  sharedByUserId: string;
  permission: 'viewer' | 'collaborator' | 'editor';
  createdAt: string;
}

const props = defineProps<{
  modelValue: boolean;
  conversation: Conversation | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const newEmail = ref('');
const newPermission = ref<'viewer' | 'collaborator' | 'editor'>('collaborator');
const emailError = ref('');
const isAdding = ref(false);
const collaborators = ref<Collaborator[]>([]);
const isLoading = ref(false);

const permissionOptions = [
  { title: 'Viewer', value: 'viewer' },
  { title: 'Collaborator', value: 'collaborator' },
  { title: 'Editor', value: 'editor' }
];

// Load collaborators when dialog opens
watch(() => props.modelValue, async (isOpen) => {
  if (isOpen && props.conversation) {
    await loadCollaborators();
  }
});

async function loadCollaborators() {
  if (!props.conversation) return;
  
  isLoading.value = true;
  try {
    const response = await api.get(`/collaboration/conversation/${props.conversation.id}/shares`);
    collaborators.value = response.data.shares || [];
  } catch (error) {
    console.error('Failed to load collaborators:', error);
  } finally {
    isLoading.value = false;
  }
}

async function addCollaborator() {
  if (!props.conversation || !newEmail.value) return;
  
  emailError.value = '';
  isAdding.value = true;
  
  try {
    const response = await api.post('/collaboration/share', {
      conversationId: props.conversation.id,
      email: newEmail.value,
      permission: newPermission.value
    });
    
    if (response.data.share) {
      collaborators.value.push(response.data.share);
      newEmail.value = '';
    }
  } catch (error: any) {
    console.error('Failed to add collaborator:', error);
    emailError.value = error.response?.data?.error || 'Failed to add user';
  } finally {
    isAdding.value = false;
  }
}

async function updatePermission(shareId: string, permission: string) {
  try {
    await api.patch(`/collaboration/shares/${shareId}`, { permission });
    
    // Update local state
    const collab = collaborators.value.find(c => c.id === shareId);
    if (collab) {
      collab.permission = permission as 'viewer' | 'collaborator' | 'editor';
    }
  } catch (error) {
    console.error('Failed to update permission:', error);
    // Reload to get correct state
    await loadCollaborators();
  }
}

async function removeCollaborator(shareId: string) {
  try {
    await api.delete(`/collaboration/shares/${shareId}`);
    collaborators.value = collaborators.value.filter(c => c.id !== shareId);
  } catch (error) {
    console.error('Failed to remove collaborator:', error);
  }
}

function getInitials(email: string): string {
  const parts = email.split('@')[0].split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return email.substring(0, 2).toUpperCase();
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return 'today';
  } else if (diffDays === 1) {
    return 'yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString();
  }
}

function close() {
  emit('update:modelValue', false);
}
</script>

<style scoped>
.gap-2 {
  gap: 8px;
}
</style>

