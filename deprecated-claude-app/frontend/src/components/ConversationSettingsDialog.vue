<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="600"
  >
    <v-card v-if="conversation">
      <v-card-title>
        Conversation Settings
      </v-card-title>
      
      <v-card-text class="settings-panel">
        <v-text-field
          v-model="settings.title"
          label="Title"
          variant="outlined"
          density="compact"
        />
        
        <v-select
          v-if="settings.format === 'standard'"
          v-model="settings.model"
          :items="models"
          item-title="displayName"
          item-value="id"
          label="Model"
          variant="outlined"
          density="compact"
          class="mt-4"
        />
        
        <v-select
          v-model="settings.format"
          :items="formatOptions"
          item-title="title"
          item-value="value"
          label="Conversation Format"
          variant="outlined"
          density="compact"
          class="mt-4"
        >
          <template v-slot:item="{ props, item }">
            <v-list-item v-bind="props">
              <template v-slot:subtitle>
                {{ item.raw.description }}
              </template>
            </v-list-item>
          </template>
        </v-select>
        
        <div v-if="settings.format === 'standard'">
          <v-textarea
            v-model="settings.systemPrompt"
            label="System Prompt"
            placeholder="You are a helpful AI assistant..."
            variant="outlined"
            density="compact"
            rows="4"
            class="mt-4"
          />
          
          <v-divider class="my-4" />
          
          <h4 class="text-h6 mb-4">Model Parameters</h4>
        </div>
        
        <!-- Multi-participant mode: Show participants section -->
        <div v-else class="mt-4">
          <ParticipantsSection
            v-model="localParticipants"
            :models="models"
          />
        </div>
        
        <div v-if="selectedModel && settings.format === 'standard'">
          <!-- Temperature -->
          <v-slider
            v-model="settings.settings.temperature"
            :min="selectedModel.settings.temperature.min"
            :max="selectedModel.settings.temperature.max"
            :step="selectedModel.settings.temperature.step"
            thumb-label
            color="primary"
          >
            <template v-slot:label>
              Temperature
              <v-tooltip location="top">
                <template v-slot:activator="{ props }">
                  <v-icon v-bind="props" size="small" class="ml-1">
                    mdi-help-circle-outline
                  </v-icon>
                </template>
                Controls randomness. Lower values make output more focused and deterministic.
              </v-tooltip>
            </template>
          </v-slider>
          
          <!-- Max Tokens -->
          <v-slider
            v-model="settings.settings.maxTokens"
            :min="selectedModel.settings.maxTokens.min"
            :max="selectedModel.settings.maxTokens.max"
            :step="100"
            thumb-label
            color="primary"
            class="mt-4"
          >
            <template v-slot:label>
              Max Tokens
              <v-tooltip location="top">
                <template v-slot:activator="{ props }">
                  <v-icon v-bind="props" size="small" class="ml-1">
                    mdi-help-circle-outline
                  </v-icon>
                </template>
                Maximum number of tokens to generate in the response.
              </v-tooltip>
            </template>
          </v-slider>
          
          <!-- Top P (if supported) -->
          <div v-if="selectedModel.settings.topP" class="mt-4">
            <v-checkbox
              v-model="topPEnabled"
              label="Enable Top P"
              density="compact"
            />
            <v-slider
              v-if="topPEnabled"
              v-model="settings.settings.topP"
              :min="selectedModel.settings.topP.min"
              :max="selectedModel.settings.topP.max"
              :step="selectedModel.settings.topP.step"
              thumb-label
              color="primary"
            >
              <template v-slot:label>
                Top P
                <v-tooltip location="top">
                  <template v-slot:activator="{ props }">
                    <v-icon v-bind="props" size="small" class="ml-1">
                      mdi-help-circle-outline
                    </v-icon>
                  </template>
                  Nucleus sampling. Consider tokens with top_p probability mass.
                </v-tooltip>
              </template>
            </v-slider>
          </div>
          
          <!-- Top K (if supported) -->
          <div v-if="selectedModel.settings.topK" class="mt-4">
            <v-checkbox
              v-model="topKEnabled"
              label="Enable Top K"
              density="compact"
            />
            <v-slider
              v-if="topKEnabled"
              v-model="settings.settings.topK"
              :min="selectedModel.settings.topK.min"
              :max="selectedModel.settings.topK.max"
              :step="selectedModel.settings.topK.step"
              thumb-label
              color="primary"
            >
              <template v-slot:label>
                Top K
                <v-tooltip location="top">
                  <template v-slot:activator="{ props }">
                    <v-icon v-bind="props" size="small" class="ml-1">
                      mdi-help-circle-outline
                    </v-icon>
                  </template>
                  Consider only the top K most likely tokens.
                </v-tooltip>
              </template>
            </v-slider>
          </div>
        </div>
        
        <v-divider class="my-4" />
        
        <v-btn
          variant="text"
          @click="resetToDefaults"
        >
          Reset to Defaults
        </v-btn>
      </v-card-text>
      
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="cancel"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          variant="elevated"
          @click="save"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { Conversation, Model, Participant } from '@deprecated-claude/shared';
import ParticipantsSection from './ParticipantsSection.vue';
import { api } from '@/services/api';

const props = defineProps<{
  modelValue: boolean;
  conversation: Conversation | null;
  models: Model[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  update: [updates: Partial<Conversation>];
  'update-participants': [participants: Participant[]];
}>();

const topPEnabled = ref(false);
const topKEnabled = ref(false);

const formatOptions = [
  {
    value: 'standard',
    title: 'One-on-One',
    description: 'Traditional user/assistant conversation format'
  },
  {
    value: 'prefill',
    title: 'Group Chat',
    description: 'Supports multiple participants with "Name: message" format'
  }
];

const settings = ref<any>({
  title: '',
  model: '',
  format: 'standard',
  systemPrompt: '',
  settings: {
    temperature: 1.0,
    maxTokens: 1024,
    topP: undefined,
    topK: undefined
  }
});

const localParticipants = ref<Participant[]>([]);

const selectedModel = computed(() => {
  return props.models.find(m => m.id === settings.value.model);
});

// Function to load participants
async function loadParticipants() {
  if (!props.conversation || props.conversation.format !== 'prefill') {
    localParticipants.value = [];
    return;
  }
  
  try {
    const response = await api.get(`/participants/conversation/${props.conversation.id}`);
    localParticipants.value = response.data;
  } catch (error) {
    console.error('Failed to load participants:', error);
    localParticipants.value = [];
  }
}

// Watch for conversation changes
watch(() => props.conversation, async (conversation) => {
  if (conversation) {
    settings.value = {
      title: conversation.title,
      model: conversation.model,
      format: conversation.format || 'standard',
      systemPrompt: conversation.systemPrompt || '',
      settings: { ...conversation.settings }
    };
    
    // Set checkbox states based on whether values are defined
    topPEnabled.value = conversation.settings?.topP !== undefined;
    topKEnabled.value = conversation.settings?.topK !== undefined;
    
    // Load participants if in multi-participant mode
    await loadParticipants();
  }
}, { immediate: true });

// Reload participants when dialog is opened
watch(() => props.modelValue, async (isOpen) => {
  if (isOpen && props.conversation?.format === 'prefill') {
    await loadParticipants();
  }
});

// Watch for format changes
watch(() => settings.value.format, async (newFormat, oldFormat) => {
  if (newFormat === 'prefill' && oldFormat === 'standard' && props.conversation) {
    // Check if participants have already been loaded by the conversation watcher
    if (localParticipants.value.length > 0) {
      // Participants already loaded, no need to reload
      return;
    }
    
    // Get the actual model name for the assistant participant
    const model = props.models.find(m => m.id === settings.value.model);
    const modelName = model?.displayName || 'Assistant';
    
    // Switching to group chat mode - load or create default participants
    try {
      const response = await api.get(`/participants/conversation/${props.conversation.id}`);
      localParticipants.value = response.data;
      
      // If no participants exist, create defaults
      if (localParticipants.value.length === 0) {
        localParticipants.value = [
          {
            id: 'temp-user',
            conversationId: props.conversation.id,
            type: 'user',
            name: 'User',
            isActive: true
          },
          {
            id: 'temp-assistant',
            conversationId: props.conversation.id,
            type: 'assistant',
            name: modelName,
            model: settings.value.model,
            isActive: true,
            settings: {
              temperature: 1.0,
              maxTokens: 1024
            }
          }
        ];
      }
      // Don't modify existing participants - let them keep their original data
    } catch (error) {
      console.error('Failed to load participants:', error);
      // Create default participants
      localParticipants.value = [
        {
          id: 'temp-user',
          conversationId: props.conversation?.id || '',
          type: 'user',
          name: 'User',
          isActive: true
        },
        {
          id: 'temp-assistant',
          conversationId: props.conversation?.id || '',
          type: 'assistant',
          name: modelName,
          model: settings.value.model,
          isActive: true,
          settings: {
            temperature: 1.0,
            maxTokens: 1024
          }
        }
      ];
    }
  }
});

// Update settings when model changes
watch(() => settings.value.model, (modelId) => {
  const model = props.models.find(m => m.id === modelId);
  if (model) {
    settings.value.settings = {
      temperature: model.settings.temperature.default,
      maxTokens: model.settings.maxTokens.default,
      topP: undefined,
      topK: undefined
    };
    
    // Disable topP and topK by default when changing models
    topPEnabled.value = false;
    topKEnabled.value = false;
  }
});

// Watch topP enabled state
watch(topPEnabled, (enabled) => {
  if (enabled && selectedModel.value?.settings.topP) {
    settings.value.settings.topP = selectedModel.value.settings.topP.default;
  } else {
    settings.value.settings.topP = undefined;
  }
});

// Watch topK enabled state
watch(topKEnabled, (enabled) => {
  if (enabled && selectedModel.value?.settings.topK) {
    settings.value.settings.topK = selectedModel.value.settings.topK.default;
  } else {
    settings.value.settings.topK = undefined;
  }
});

function resetToDefaults() {
  if (selectedModel.value) {
    settings.value.settings = {
      temperature: selectedModel.value.settings.temperature.default,
      maxTokens: selectedModel.value.settings.maxTokens.default,
      topP: undefined,
      topK: undefined
    };
    
    // Disable topP and topK by default
    topPEnabled.value = false;
    topKEnabled.value = false;
  }
}

function cancel() {
  emit('update:modelValue', false);
}

function save() {
  const finalSettings = {
    temperature: settings.value.settings.temperature,
    maxTokens: settings.value.settings.maxTokens,
    ...(topPEnabled.value && settings.value.settings.topP !== undefined && { topP: settings.value.settings.topP }),
    ...(topKEnabled.value && settings.value.settings.topK !== undefined && { topK: settings.value.settings.topK })
  };
  
  // Update conversation settings
  emit('update', {
    title: settings.value.title,
    model: settings.value.model,
    format: settings.value.format,
    systemPrompt: settings.value.systemPrompt || undefined,
    settings: finalSettings
  });
  
  // If in multi-participant mode, emit participants for parent to update
  if (settings.value.format === 'prefill') {
    emit('update-participants', localParticipants.value);
  }
  
  emit('update:modelValue', false);
}
</script>
