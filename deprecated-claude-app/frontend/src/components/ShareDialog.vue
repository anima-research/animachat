<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="500"
  >
    <v-card>
      <v-card-title>
        Share Conversation
      </v-card-title>
      
      <v-card-text>
        <div v-if="!shareUrl">
          <!-- Share options -->
          <v-radio-group v-model="shareType" class="mb-4">
            <v-radio
              label="Share current branch only"
              value="branch"
            />
            <v-radio
              label="Share entire conversation tree"
              value="tree"
            />
          </v-radio-group>
          
          <v-divider class="mb-4" />
          
          <h4 class="text-subtitle-1 mb-2">Share Settings</h4>
          
          <v-checkbox
            v-model="settings.allowDownload"
            label="Allow prompt downloads"
            density="compact"
          />
          
          <v-checkbox
            v-model="settings.showModelInfo"
            label="Show model information"
            density="compact"
          />
          
          <v-checkbox
            v-model="settings.showTimestamps"
            label="Show timestamps"
            density="compact"
          />
          
          <v-text-field
            v-model="settings.title"
            label="Custom title (optional)"
            variant="outlined"
            density="compact"
            class="mt-4"
            :placeholder="conversation?.title"
          />
          
          <v-textarea
            v-model="settings.description"
            label="Description (optional)"
            variant="outlined"
            density="compact"
            rows="2"
            placeholder="Add context or notes about this conversation..."
          />
          
          <v-select
            v-model="expiresIn"
            :items="expirationOptions"
            label="Link expiration"
            variant="outlined"
            density="compact"
          />
        </div>
        
        <!-- Share link display -->
        <div v-else>
          <v-alert
            type="success"
            variant="tonal"
            class="mb-4"
          >
            Your share link has been created!
          </v-alert>
          
          <v-text-field
            :model-value="shareUrl"
            label="Share URL"
            variant="outlined"
            density="compact"
            readonly
            append-inner-icon="mdi-content-copy"
            @click:append-inner="copyShareUrl"
          />
          
          <div class="text-caption mt-2">
            <div v-if="shareType === 'branch'">
              <v-icon size="x-small">mdi-source-branch</v-icon>
              Sharing current branch only
            </div>
            <div v-else>
              <v-icon size="x-small">mdi-file-tree</v-icon>
              Sharing entire conversation tree
            </div>
            <div v-if="expiresIn > 0" class="mt-1">
              <v-icon size="x-small">mdi-clock-outline</v-icon>
              Expires in {{ expiresIn }} hours
            </div>
          </div>
        </div>
      </v-card-text>
      
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="close"
        >
          {{ shareUrl ? 'Close' : 'Cancel' }}
        </v-btn>
        <v-btn
          v-if="!shareUrl"
          color="primary"
          variant="elevated"
          :loading="isLoading"
          @click="createShare"
        >
          Create Share Link
        </v-btn>
        <v-btn
          v-else
          color="primary"
          variant="elevated"
          @click="createNewShare"
        >
          Create New Link
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '@/services/api';
import type { Conversation, Message } from '@deprecated-claude/shared';

const props = defineProps<{
  modelValue: boolean;
  conversation: Conversation | null;
  currentBranchId?: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const shareType = ref<'branch' | 'tree'>('branch');
const settings = ref({
  allowDownload: true,
  showModelInfo: true,
  showTimestamps: true,
  title: '',
  description: ''
});
const expiresIn = ref(0);
const shareUrl = ref('');
const isLoading = ref(false);

const expirationOptions = [
  { title: 'Never', value: 0 },
  { title: '1 hour', value: 1 },
  { title: '24 hours', value: 24 },
  { title: '7 days', value: 168 },
  { title: '30 days', value: 720 }
];

// Reset when dialog opens
watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    shareUrl.value = '';
    settings.value = {
      allowDownload: true,
      showModelInfo: true,
      showTimestamps: true,
      title: '',
      description: ''
    };
  }
});

async function createShare() {
  if (!props.conversation) return;
  
  isLoading.value = true;
  try {
    const response = await api.post('/shares/create', {
      conversationId: props.conversation.id,
      shareType: shareType.value,
      branchId: shareType.value === 'branch' ? props.currentBranchId : undefined,
      settings: {
        ...settings.value,
        title: settings.value.title || undefined,
        description: settings.value.description || undefined
      },
      expiresIn: expiresIn.value > 0 ? expiresIn.value : undefined
    });
    
    shareUrl.value = response.data.shareUrl;
  } catch (error) {
    console.error('Failed to create share:', error);
    // TODO: Show error toast
  } finally {
    isLoading.value = false;
  }
}

function createNewShare() {
  shareUrl.value = '';
}

function copyShareUrl() {
  if (shareUrl.value) {
    navigator.clipboard.writeText(shareUrl.value);
    // TODO: Show success toast
  }
}

function close() {
  emit('update:modelValue', false);
}
</script>
