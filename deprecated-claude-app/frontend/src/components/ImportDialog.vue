<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="600"
  >
    <v-card>
      <v-card-title>
        Import Conversation
      </v-card-title>
      
      <v-card-text>
        <v-file-input
          v-model="file"
          label="Select conversation JSON file"
          accept=".json,application/json"
          prepend-icon="mdi-file-document"
          variant="outlined"
          @change="parseFile"
        />
        
        <v-alert
          v-if="error"
          type="error"
          class="mt-4"
          dismissible
          @click:close="error = ''"
        >
          {{ error }}
        </v-alert>
        
        <div v-if="parsedData" class="mt-4">
          <v-text-field
            v-model="parsedData.title"
            label="Conversation Title"
            variant="outlined"
            density="compact"
          />
          
          <v-select
            v-model="parsedData.model"
            :items="models"
            item-title="displayName"
            item-value="id"
            label="Model"
            variant="outlined"
            density="compact"
            class="mt-2"
          />
          
          <v-textarea
            v-model="parsedData.systemPrompt"
            label="System Prompt (optional)"
            variant="outlined"
            density="compact"
            rows="3"
            class="mt-2"
          />
          
          <v-expansion-panels class="mt-4">
            <v-expansion-panel>
              <v-expansion-panel-title>
                Preview Messages ({{ parsedData.messages?.length || 0 }})
              </v-expansion-panel-title>
              <v-expansion-panel-text>
                <div
                  v-for="(msg, index) in parsedData.messages?.slice(0, 5)"
                  :key="index"
                  class="mb-2"
                >
                  <v-chip
                    :color="msg.role === 'user' ? 'primary' : 'secondary'"
                    size="small"
                    class="mr-2"
                  >
                    {{ msg.role }}
                  </v-chip>
                  <span class="text-caption">
                    {{ msg.content.substring(0, 100) }}{{ msg.content.length > 100 ? '...' : '' }}
                  </span>
                </div>
                <div v-if="parsedData.messages?.length > 5" class="text-caption text-grey">
                  ... and {{ parsedData.messages.length - 5 }} more messages
                </div>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </div>
      </v-card-text>
      
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="close"
        >
          Cancel
        </v-btn>
        <v-btn
          :disabled="!parsedData || loading"
          :loading="loading"
          color="primary"
          variant="elevated"
          @click="importConversation"
        >
          Import
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useStore } from '@/store';
import type { ImportConversationRequest } from '@deprecated-claude/shared';
import { api } from '@/services/api';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  imported: [conversation: any];
}>();

const store = useStore();

const file = ref<File | null>(null);
const parsedData = ref<ImportConversationRequest | null>(null);
const error = ref('');
const loading = ref(false);

const models = computed(() => store.state.models);

async function parseFile() {
  if (!file.value) return;
  
  error.value = '';
  parsedData.value = null;
  
  try {
    const text = await file.value.text();
    const data = JSON.parse(text);
    
    // Handle different formats (claude.ai export, our export, etc.)
    if (data.conversation && data.messages) {
      // Our export format
      parsedData.value = {
        title: data.conversation.title,
        model: data.conversation.model,
        systemPrompt: data.conversation.systemPrompt,
        messages: data.messages.flatMap((msg: any) => 
          msg.branches.map((branch: any) => ({
            role: branch.role,
            content: branch.content
          }))
        )
      };
    } else if (Array.isArray(data)) {
      // Simple message array
      parsedData.value = {
        title: 'Imported Conversation',
        model: models.value[0]?.id || 'claude-3-5-sonnet-20241022',
        messages: data
      };
    } else if (data.messages) {
      // claude.ai export format
      parsedData.value = {
        title: data.title || 'Imported from Claude.ai',
        model: data.model || models.value[0]?.id || 'claude-3-5-sonnet-20241022',
        systemPrompt: data.systemPrompt,
        messages: data.messages
      };
    } else {
      throw new Error('Unrecognized file format');
    }
  } catch (err: any) {
    error.value = err.message || 'Failed to parse file';
  }
}

async function importConversation() {
  if (!parsedData.value) return;
  
  loading.value = true;
  error.value = '';
  
  try {
    const response = await api.post('/conversations/import', parsedData.value);
    emit('imported', response.data);
    close();
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Import failed';
  } finally {
    loading.value = false;
  }
}

function close() {
  file.value = null;
  parsedData.value = null;
  error.value = '';
  emit('update:modelValue', false);
}

// Load models when dialog opens
watch(() => props.modelValue, async (isOpen) => {
  if (isOpen && models.value.length === 0) {
    await store.loadModels();
  }
});
</script>
