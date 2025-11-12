<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="600"
    max-height="90vh"
  >
    <v-card v-if="conversation" style="display: flex; flex-direction: column; max-height: 90vh;">
      <v-card-title>
        Conversation Settings
      </v-card-title>
      
      <v-card-text class="settings-panel" style="overflow-y: auto; flex: 1;">
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
          
          <v-divider class="my-4" />
          
          <!-- Prefill Initial Message Settings -->
          <h4 class="text-h6 mb-4">Initial User Message</h4>
          <p class="text-caption text-grey mb-3">
            Configure the initial user message that starts the conversation log in group chat mode.
          </p>
          
          <v-checkbox
            v-model="prefillUserMessageEnabled"
            label="Include initial user message"
            density="compact"
          />
          
          <v-textarea
            v-if="prefillUserMessageEnabled"
            v-model="prefillUserMessageContent"
            label="Initial message content"
            placeholder="<cmd>cat untitled.log</cmd>"
            variant="outlined"
            density="compact"
            rows="2"
            class="mt-2"
          >
            <template v-slot:append-inner>
              <v-tooltip location="top">
                <template v-slot:activator="{ props }">
                  <v-icon v-bind="props" size="small">
                    mdi-help-circle-outline
                  </v-icon>
                </template>
                This message appears at the beginning of the conversation log sent to the model.
                Common patterns: &lt;cmd&gt;command&lt;/cmd&gt; for commands, or plain text for context.
              </v-tooltip>
            </template>
          </v-textarea>
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
          
          <!-- Extended Thinking (if supported) -->
          <div v-if="selectedModel?.supportsThinking" class="mt-4">
            <v-checkbox
              v-model="thinkingEnabled"
              label="Enable Extended Thinking"
              density="compact"
            >
              <template v-slot:label>
                Enable Extended Thinking
                <v-tooltip location="top">
                  <template v-slot:activator="{ props }">
                    <v-icon v-bind="props" size="small" class="ml-1">
                      mdi-help-circle-outline
                    </v-icon>
                  </template>
                  Extended thinking allows Claude to show its step-by-step reasoning process before delivering the final answer.
                </v-tooltip>
              </template>
            </v-checkbox>
            
            <v-slider
              v-if="thinkingEnabled"
              v-model="thinkingBudgetTokens"
              :min="1024"
              :max="32000"
              :step="1024"
              thumb-label
              color="primary"
              class="mt-2"
            >
              <template v-slot:label>
                Thinking Budget (tokens)
                <v-tooltip location="top">
                  <template v-slot:activator="{ props }">
                    <v-icon v-bind="props" size="small" class="ml-1">
                      mdi-help-circle-outline
                    </v-icon>
                  </template>
                  Maximum tokens Claude can use for internal reasoning. Higher values enable more thorough analysis for complex problems. Minimum: 1024
                </v-tooltip>
              </template>
            </v-slider>
          </div>
        </div>
        
        <v-divider class="my-4" />
        
        <!-- Context Management Settings -->
        <div>
          <h4 class="text-h6 mb-4">Context Management</h4>
          <p class="text-caption text-grey mb-3">
            These settings control how conversation history is managed for all participant, but can be overridden by participant-specific settings.
          </p>
          
          <v-select
            v-model="contextStrategy"
            :items="contextStrategies"
            item-title="title"
            item-value="value"
            label="Context Strategy"
            variant="outlined"
            density="compact"
            class="mb-4"
          >
            <template v-slot:item="{ props, item }">
              <v-list-item v-bind="props">
                <template v-slot:subtitle>
                  {{ item.raw.description }}
                </template>
              </v-list-item>
            </template>
          </v-select>
          
          <!-- Rolling Strategy Settings -->
          <div v-if="contextStrategy === 'rolling'" class="ml-4">
            <v-text-field
              v-model.number="rollingMaxTokens"
              type="number"
              label="Max Tokens"
              variant="outlined"
              density="compact"
              :min="1000"
              :max="200000"
              class="mb-3"
            >
              <template v-slot:append-inner>
                <v-tooltip location="top">
                  <template v-slot:activator="{ props }">
                    <v-icon v-bind="props" size="small">
                      mdi-help-circle-outline
                    </v-icon>
                  </template>
                  Maximum tokens to keep in context. Older messages beyond this limit will be dropped.
                </v-tooltip>
              </template>
            </v-text-field>
            
            <v-text-field
              v-model.number="rollingGraceTokens"
              type="number"
              label="Grace Tokens"
              variant="outlined"
              density="compact"
              :min="0"
              :max="50000"
              class="mb-3"
            >
              <template v-slot:append-inner>
                <v-tooltip location="top">
                  <template v-slot:activator="{ props }">
                    <v-icon v-bind="props" size="small">
                      mdi-help-circle-outline
                    </v-icon>
                  </template>
                  Additional tokens allowed before truncation. Helps maintain cache efficiency.
                </v-tooltip>
              </template>
            </v-text-field>
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
const thinkingEnabled = ref(false);
const thinkingBudgetTokens = ref(10000);

const contextStrategy = ref('append');
const rollingMaxTokens = ref(50000);
const rollingGraceTokens = ref(10000);

const prefillUserMessageEnabled = ref(true);
const prefillUserMessageContent = ref('<cmd>cat untitled.log</cmd>');

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

const contextStrategies = [
  {
    value: 'append',
    title: 'Append (Default)',
    description: 'Keeps all messages, moves cache marker forward every 10k tokens'
  },
  {
    value: 'rolling',
    title: 'Rolling Window',
    description: 'Maintains a sliding window of recent messages, drops older ones'
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

// Flag to prevent loading participants right after saving them
const justSavedParticipants = ref(false);

// Function to load participants
async function loadParticipants() {
  if (!props.conversation || props.conversation.format !== 'prefill') {
    localParticipants.value = [];
    return;
  }
  
  // Don't reload if we just saved - prevents race condition
  if (justSavedParticipants.value) {
    console.log('[ConversationSettingsDialog] Skipping loadParticipants (just saved)');
    justSavedParticipants.value = false;
    return;
  }
  
  console.log('[ConversationSettingsDialog] loadParticipants called for conversation:', props.conversation.id);
  
  try {
    const response = await api.get(`/participants/conversation/${props.conversation.id}`);
    console.log('[ConversationSettingsDialog] Loaded participants from backend:', response.data);
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
    thinkingEnabled.value = conversation.settings?.thinking?.enabled || false;
    thinkingBudgetTokens.value = conversation.settings?.thinking?.budgetTokens || 8000;
    
    // Load context management settings
    if (conversation.contextManagement) {
      contextStrategy.value = conversation.contextManagement.strategy;
      if (conversation.contextManagement.strategy === 'rolling') {
        rollingMaxTokens.value = conversation.contextManagement.maxTokens;
        rollingGraceTokens.value = conversation.contextManagement.maxGraceTokens;
      }
    } else {
      contextStrategy.value = 'append';
      rollingMaxTokens.value = 50000;
      rollingGraceTokens.value = 10000;
    }
    
    // Load prefill user message settings
    if (conversation.prefillUserMessage) {
      prefillUserMessageEnabled.value = conversation.prefillUserMessage.enabled;
      prefillUserMessageContent.value = conversation.prefillUserMessage.content;
    } else {
      // Default values
      prefillUserMessageEnabled.value = true;
      prefillUserMessageContent.value = '<cmd>cat untitled.log</cmd>';
    }
    
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
    const modelName = model?.shortName || model?.displayName || 'Assistant';
    
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
    
    // Disable topP, topK, and thinking by default
    topPEnabled.value = false;
    topKEnabled.value = false;
    thinkingEnabled.value = false;
    thinkingBudgetTokens.value = 10000;
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
    ...(topKEnabled.value && settings.value.settings.topK !== undefined && { topK: settings.value.settings.topK }),
    ...(thinkingEnabled.value && { thinking: { enabled: true, budgetTokens: thinkingBudgetTokens.value } })
  };
  
  // Debug log
  console.log('[Settings Dialog] Saving settings:', {
    thinkingEnabled: thinkingEnabled.value,
    thinkingBudgetTokens: thinkingBudgetTokens.value,
    finalSettings
  });
  
  // Build context management settings
  let contextManagement: any = undefined;
  if (contextStrategy.value === 'append') {
    contextManagement = {
      strategy: 'append',
      cacheInterval: 10000
    };
  } else if (contextStrategy.value === 'rolling') {
    contextManagement = {
      strategy: 'rolling',
      maxTokens: rollingMaxTokens.value,
      maxGraceTokens: rollingGraceTokens.value,
      cacheMinTokens: 5000,
      cacheDepthFromEnd: 5
    };
  }
  
  // Build prefill user message settings (only for prefill format)
  let prefillUserMessage: any = undefined;
  if (settings.value.format === 'prefill') {
    prefillUserMessage = {
      enabled: prefillUserMessageEnabled.value,
      content: prefillUserMessageContent.value
    };
  }
  
  // Update conversation settings
  emit('update', {
    title: settings.value.title,
    model: settings.value.model,
    format: settings.value.format,
    systemPrompt: settings.value.systemPrompt || undefined,
    settings: finalSettings,
    contextManagement,
    prefillUserMessage
  });
  
  // If in multi-participant mode, emit participants for parent to update
  if (settings.value.format === 'prefill') {
    console.log('[ConversationSettingsDialog] Emitting participants:', localParticipants.value);
    justSavedParticipants.value = true; // Set flag to prevent reload
    emit('update-participants', localParticipants.value);
  }
  
  emit('update:modelValue', false);
}
</script>
