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
          v-model="settings.format"
          :items="formatOptions"
          item-title="title"
          item-value="value"
          label="Conversation Format"
          variant="outlined"
          density="compact"
          class="mt-4"
          :disabled="isAlreadyGroupChat"
          :hint="isAlreadyGroupChat ? 'Group chats cannot be converted back to one-on-one' : ''"
          :persistent-hint="isAlreadyGroupChat"
        >
          <template v-slot:item="{ props, item }">
            <v-list-item v-bind="props">
              <template v-slot:subtitle>
                {{ item.raw.description }}
              </template>
            </v-list-item>
          </template>
        </v-select>
        
        <div v-if="showGroupChatWarning" class="d-flex align-center mt-1 mb-2">
          <v-icon size="small" color="warning" class="mr-1">mdi-alert</v-icon>
          <span class="text-caption text-warning">
            It's advised to have at least 6 messages before switching to group chat to avoid instability.
          </span>
        </div>
        
        <ModelSelector
          v-if="settings.format === 'standard'"
          v-model="settings.model"
          :models="activeModels"
          :availability="store.state.modelAvailability"
          label="Model"
          variant="outlined"
          density="compact"
          class="mt-4"
        />
        
        <!-- System prompt - available for all formats -->
        <v-textarea
          v-model="settings.systemPrompt"
          label="System Prompt"
          :placeholder="settings.format === 'standard' ? 'You are a helpful AI assistant...' : 'Optional conversation-level system prompt (each participant can also have their own)'"
          variant="outlined"
          density="compact"
          rows="4"
          class="mt-4"
        />
        <p v-if="settings.format === 'prefill'" class="text-caption text-grey mt-1 mb-0">
          Note: If the CLI mode prompt toggle below is enabled, it will be prepended to this system prompt for early messages.
        </p>
        
        <div v-if="settings.format === 'standard'">
          <v-divider class="my-4" />
          
          <h4 class="text-h6 mb-2">Model Parameters</h4>
        </div>
        
        <!-- Multi-participant mode: Show participants section -->
        <div v-else class="mt-4">
          <ParticipantsSection
            v-model="localParticipants"
            :models="activeModels"
            :availability="store.state.modelAvailability"
            :personas="personas || []"
            :can-use-personas="canUsePersonas || false"
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
              <v-tooltip location="top" open-on-click open-on-focus>
                <template v-slot:activator="{ props }">
                  <v-icon
                    v-bind="props"
                    size="small"
                    class="tooltip-icon"
                    role="button"
                    tabindex="0"
                    aria-label="Initial message help"
                  >
                    mdi-help-circle-outline
                  </v-icon>
                </template>
                This message appears at the beginning of the conversation log sent to the model.
                Common patterns: &lt;cmd&gt;command&lt;/cmd&gt; for commands, or plain text for context.
              </v-tooltip>
            </template>
          </v-textarea>
          
          <v-divider class="my-4" />
          
          <!-- CLI Mode Prompt Settings -->
          <h4 class="text-h6 mb-4">CLI Mode Prompt</h4>
          <p class="text-caption text-grey mb-3">
            Automatically inject a CLI simulation prompt for early messages in group chats.
          </p>
          
          <v-checkbox
            v-model="cliModeEnabled"
            label="Enable CLI mode prompt for early messages"
            density="compact"
          />
          
          <v-slider
            v-if="cliModeEnabled"
            v-model="cliModeThreshold"
            label="Message threshold"
            :min="1"
            :max="50"
            :step="1"
            thumb-label
            density="compact"
            class="mt-2"
          >
            <template v-slot:append>
              <span class="text-caption">{{ cliModeThreshold }} messages</span>
            </template>
          </v-slider>
          
          <v-divider class="my-4" />
          
          <!-- Combine Consecutive Messages -->
          <h4 class="text-h6 mb-4">Message Handling</h4>
          
          <v-checkbox
            v-model="combineConsecutiveMessages"
            label="Combine consecutive same-role messages"
            density="compact"
          >
            <template v-slot:append>
              <v-tooltip location="top" open-on-click open-on-focus max-width="300">
                <template v-slot:activator="{ props }">
                  <v-icon v-bind="props" size="small" class="tooltip-icon">mdi-help-circle-outline</v-icon>
                </template>
                When enabled, consecutive messages from the same role are merged when sent to the API.
                Disable this if you want to keep split messages separate in context.
              </v-tooltip>
            </template>
          </v-checkbox>
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
              <v-tooltip location="top" open-on-click open-on-focus>
                <template v-slot:activator="{ props }">
                  <v-icon
                    v-bind="props"
                    size="small"
                    class="ml-1 tooltip-icon"
                    role="button"
                    tabindex="0"
                    aria-label="Temperature help"
                  >
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
            class="mt-2"
          >
            <template v-slot:label>
              Max Tokens
              <v-tooltip location="top" open-on-click open-on-focus>
                <template v-slot:activator="{ props }">
                  <v-icon
                    v-bind="props"
                    size="small"
                    class="ml-1 tooltip-icon"
                    role="button"
                    tabindex="0"
                    aria-label="Max tokens help"
                  >
                    mdi-help-circle-outline
                  </v-icon>
                </template>
                Maximum number of tokens to generate in the response.
              </v-tooltip>
            </template>
          </v-slider>
          
          <!-- Top P (if supported) -->
          <div v-if="selectedModel.settings.topP" class="mt-2">
            <v-checkbox
              v-model="topPEnabled"
              label="Enable Top P"
              density="compact"
              hide-details
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
                <v-tooltip location="top" open-on-click open-on-focus>
                  <template v-slot:activator="{ props }">
                    <v-icon
                      v-bind="props"
                      size="small"
                      class="ml-1 tooltip-icon"
                      role="button"
                      tabindex="0"
                      aria-label="Top P help"
                    >
                      mdi-help-circle-outline
                    </v-icon>
                  </template>
                  Nucleus sampling. Consider tokens with top_p probability mass.
                </v-tooltip>
              </template>
            </v-slider>
          </div>
          
          <!-- Top K (if supported) -->
          <div v-if="selectedModel.settings.topK" class="mt-2">
            <v-checkbox
              v-model="topKEnabled"
              label="Enable Top K"
              density="compact"
              hide-details
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
                <v-tooltip location="top" open-on-click open-on-focus>
                  <template v-slot:activator="{ props }">
                    <v-icon
                      v-bind="props"
                      size="small"
                      class="ml-1 tooltip-icon"
                      role="button"
                      tabindex="0"
                      aria-label="Top K help"
                    >
                      mdi-help-circle-outline
                    </v-icon>
                  </template>
                  Consider only the top K most likely tokens.
                </v-tooltip>
              </template>
            </v-slider>
          </div>
          
          <!-- Extended Thinking (if supported) -->
          <div v-if="selectedModel?.supportsThinking" class="mt-2">
            <div class="thinking-toggle-row">
              <v-checkbox
                v-model="thinkingEnabled"
                label="Enable Extended Thinking"
                density="compact"
                hide-details
              />
              <v-tooltip location="top" open-on-click open-on-focus :close-on-content-click="false">
                <template v-slot:activator="{ props }">
                  <button
                    class="tooltip-icon-button"
                    type="button"
                    v-bind="props"
                    aria-label="Extended thinking help"
                    @click.stop="props.onClick && props.onClick($event)"
                    @mousedown.stop
                    @keydown.stop.prevent="props.onKeydown && props.onKeydown($event)"
                  >
                    <v-icon size="small" class="tooltip-icon">
                      mdi-help-circle-outline
                    </v-icon>
                  </button>
                </template>
                Extended thinking allows Claude to show its step-by-step reasoning process before delivering the final answer.
              </v-tooltip>
            </div>
            
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
                <v-tooltip location="top" open-on-click open-on-focus>
                  <template v-slot:activator="{ props }">
                    <v-icon
                      v-bind="props"
                      size="small"
                      class="ml-1 tooltip-icon"
                      role="button"
                      tabindex="0"
                      aria-label="Thinking budget help"
                    >
                      mdi-help-circle-outline
                    </v-icon>
                  </template>
                  Maximum tokens Claude can use for internal reasoning. Higher values enable more thorough analysis for complex problems. Minimum: 1024
                </v-tooltip>
              </template>
            </v-slider>
          </div>
          
          <!-- Sampling Branches -->
          <div class="mt-4">
            <div class="d-flex align-center">
              <v-slider
                v-model="samplingBranches"
                :min="1"
                :max="8"
                :step="1"
                thumb-label
                color="primary"
                show-ticks="always"
                tick-size="4"
              >
                <template v-slot:label>
                  Response Samples
                  <v-tooltip location="top" open-on-click open-on-focus>
                    <template v-slot:activator="{ props }">
                      <v-icon
                        v-bind="props"
                        size="small"
                        class="ml-1 tooltip-icon"
                        role="button"
                        tabindex="0"
                        aria-label="Sampling branches help"
                      >
                        mdi-help-circle-outline
                      </v-icon>
                    </template>
                    Generate multiple response branches simultaneously for sampling. Each response will be created as a separate branch you can navigate between.
                  </v-tooltip>
                </template>
              </v-slider>
            </div>
          </div>
          
          <!-- Model-Specific Settings (for models with configurableSettings) -->
          <ModelSpecificSettings
            v-if="modelConfigurableSettings.length > 0"
            v-model="modelSpecificValues"
            :settings="modelConfigurableSettings"
            :show-divider="true"
            :show-header="true"
            header-text="Advanced Model Settings"
          />
        </div>
        
        <v-divider class="my-4" />
        
        <!-- Context Management Settings -->
        <div>
          <h4 class="text-h6 mb-2">Context Management</h4>
          <p class="text-caption text-grey mb-3">
            These settings control how conversation history is managed for all participants, but can be overridden by participant-specific settings.
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
          <div v-if="contextStrategy === 'rolling'">
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
                <v-tooltip location="top" open-on-click open-on-focus>
                  <template v-slot:activator="{ props }">
                    <v-icon
                      v-bind="props"
                      size="small"
                      class="tooltip-icon"
                      role="button"
                      tabindex="0"
                      aria-label="Rolling max tokens help"
                    >
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
                <v-tooltip location="top" open-on-click open-on-focus>
                  <template v-slot:activator="{ props }">
                    <v-icon
                      v-bind="props"
                      size="small"
                      class="tooltip-icon"
                      role="button"
                      tabindex="0"
                      aria-label="Grace tokens help"
                    >
                      mdi-help-circle-outline
                    </v-icon>
                  </template>
                  Additional tokens allowed before truncation. Helps maintain cache efficiency.
                </v-tooltip>
              </template>
            </v-text-field>
            
            <!-- Cache Settings for Rolling Strategy -->
            <v-divider class="my-3" />
          </div>
          
          <div v-if="contextStrategy === 'append'">
            <v-text-field
              v-model.number="appendTokensBeforeCaching"
              type="number"
              label="Tokens Before Caching"
              variant="outlined"
              density="compact"
              :min="1000"
              :max="50000"
              :step="1000"
              class="mb-3"
            >
              <template v-slot:append-inner>
                <v-tooltip location="top" open-on-click open-on-focus>
                  <template v-slot:activator="{ props }">
                    <v-icon
                      v-bind="props"
                      size="small"
                      class="tooltip-icon"
                      role="button"
                      tabindex="0"
                      aria-label="Append caching help"
                    >
                      mdi-help-circle-outline
                    </v-icon>
                  </template>
                  Cache window moves in steps of this size. Lower = caching starts sooner (better for shorter conversations). Default: 10,000
                </v-tooltip>
              </template>
            </v-text-field>
          </div>
        </div>
        
        <v-divider class="my-4" />
        
        <div class="d-flex gap-2">
        <v-btn
          variant="text"
          @click="resetToDefaults"
        >
          Reset to Defaults
        </v-btn>
          <v-btn
            variant="text"
            color="info"
            @click="openArchive"
          >
            <v-icon start size="small">mdi-archive-outline</v-icon>
            View Archive
          </v-btn>
        </div>
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
import { useRouter } from 'vue-router';
import type { Conversation, Model, Participant, ConfigurableSetting, Persona } from '@deprecated-claude/shared';
import { getValidatedModelDefaults } from '@deprecated-claude/shared';
import ParticipantsSection from './ParticipantsSection.vue';
import ModelSelector from './ModelSelector.vue';
import ModelSpecificSettings from './ModelSpecificSettings.vue';
import { api } from '@/services/api';
import { useStore } from '@/store';

const router = useRouter();

const store = useStore();

// Get user's first name for default participant name
const userFirstName = computed(() => {
  const user = store.state.user;
  if (!user) return 'User';
  if (user.name) return user.name.split(' ')[0];
  if (user.email) return user.email.split('@')[0];
  return 'User';
});

const props = defineProps<{
  modelValue: boolean;
  conversation: Conversation | null;
  models: Model[];
  messageCount?: number;
  personas?: Persona[];
  canUsePersonas?: boolean;
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
const samplingBranches = ref(1);

const contextStrategy = ref('append');
const rollingMaxTokens = ref(50000);
const rollingGraceTokens = ref(10000);
const appendTokensBeforeCaching = ref(10000);

const prefillUserMessageEnabled = ref(true);
const prefillUserMessageContent = ref('<cmd>cat untitled.log</cmd>');

// CLI mode prompt settings
const cliModeEnabled = ref(true);
const cliModeThreshold = ref(10);
const combineConsecutiveMessages = ref(true);

const formatOptions = [
  {
    value: 'standard',
    title: 'One-on-One',
    description: 'Traditional user/assistant conversation format'
  },
  {
    value: 'prefill',
    title: 'Group Chat',
    description: 'Supports multiple participants with custom names'
  }
];

// Prevent conversion from group chat back to one-on-one
const isAlreadyGroupChat = computed(() => {
  return props.conversation?.format === 'prefill';
});

// Show warning when switching to group chat with fewer than 6 messages
const showGroupChatWarning = computed(() => {
  return settings.value.format === 'prefill' && 
         props.conversation?.format !== 'prefill' && 
         (props.messageCount ?? 0) < 6;
});

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
    maxTokens: 4096, // Safe default for all models
    topP: undefined,
    topK: undefined,
    modelSpecific: {},
  }
});

// Model-specific settings computed properties
const modelConfigurableSettings = computed<ConfigurableSetting[]>(() => {
  return (selectedModel.value?.configurableSettings as ConfigurableSetting[]) || [];
});

const modelSpecificValues = computed({
  get: () => settings.value.settings?.modelSpecific || {},
  set: (value: Record<string, unknown>) => {
    settings.value.settings = {
      ...settings.value.settings,
      modelSpecific: value,
    };
  },
});

const localParticipants = ref<Participant[]>([]);

const activeModels = computed(() => {
  return props.models.filter(m => !m.hidden);
});

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
    samplingBranches.value = conversation.settings?.samplingBranches || 1;
    
    // Load context management settings
    if (conversation.contextManagement) {
      contextStrategy.value = conversation.contextManagement.strategy;
      if (conversation.contextManagement.strategy === 'rolling') {
        rollingMaxTokens.value = conversation.contextManagement.maxTokens;
        rollingGraceTokens.value = conversation.contextManagement.maxGraceTokens;
      } else if (conversation.contextManagement.strategy === 'append') {
        appendTokensBeforeCaching.value = conversation.contextManagement.tokensBeforeCaching || 10000;
      }
    } else {
      contextStrategy.value = 'append';
      rollingMaxTokens.value = 50000;
      rollingGraceTokens.value = 10000;
      appendTokensBeforeCaching.value = 10000;
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
    
    // Load CLI mode prompt settings
    if (conversation.cliModePrompt) {
      cliModeEnabled.value = conversation.cliModePrompt.enabled;
      cliModeThreshold.value = conversation.cliModePrompt.messageThreshold;
    } else {
      // Default values
      cliModeEnabled.value = true;
      cliModeThreshold.value = 10;
    }
    
    // Load combine consecutive messages setting
    combineConsecutiveMessages.value = conversation.combineConsecutiveMessages ?? true;
    
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
        const currentModel = props.models.find(m => m.id === settings.value.model);
        localParticipants.value = [
          {
            id: 'temp-user',
            conversationId: props.conversation.id,
            type: 'user',
            name: userFirstName.value,
            isActive: true
          },
          {
            id: 'temp-assistant',
            conversationId: props.conversation.id,
            type: 'assistant',
            name: modelName,
            model: settings.value.model,
            isActive: true,
            settings: currentModel ? getValidatedModelDefaults(currentModel) : { temperature: 1.0, maxTokens: 4096 }
          }
        ];
      } else {
        // Update existing participants with generic names ("H", "A", "User", "Assistant")
        // to use more meaningful names
        localParticipants.value = localParticipants.value.map(p => {
          if (p.type === 'user' && (p.name === 'H' || p.name === 'User')) {
            return { ...p, name: userFirstName.value };
          }
          if (p.type === 'assistant' && (p.name === 'A' || p.name === 'Assistant')) {
            // Get this assistant's model name, or fall back to the conversation model
            const assistantModel = props.models.find(m => m.id === p.model);
            const assistantModelName = assistantModel?.shortName || assistantModel?.displayName || modelName;
            return { ...p, name: assistantModelName };
          }
          return p;
        });
      }
    } catch (error) {
      console.error('Failed to load participants:', error);
      // Create default participants
      const currentModel = props.models.find(m => m.id === settings.value.model);
      localParticipants.value = [
        {
          id: 'temp-user',
          conversationId: props.conversation?.id || '',
          type: 'user',
          name: userFirstName.value,
          isActive: true
        },
        {
          id: 'temp-assistant',
          conversationId: props.conversation?.id || '',
          type: 'assistant',
          name: modelName,
          model: settings.value.model,
          isActive: true,
          settings: currentModel ? getValidatedModelDefaults(currentModel) : { temperature: 1.0, maxTokens: 4096 }
        }
      ];
    }
  }
});

// Update settings when model changes
watch(() => settings.value.model, (modelId) => {
  const model = props.models.find(m => m.id === modelId);
  if (model) {
    // Build default modelSpecific settings from configurableSettings
    const modelSpecificDefaults: Record<string, unknown> = {};
    if (model.configurableSettings) {
      for (const setting of model.configurableSettings as ConfigurableSetting[]) {
        modelSpecificDefaults[setting.key] = setting.default;
      }
    }
    
    // Ensure maxTokens is within valid range
    const validatedMaxTokens = Math.min(
      model.settings.maxTokens.default,
      model.settings.maxTokens.max,
      model.outputTokenLimit
    );
    
    settings.value.settings = {
      temperature: model.settings.temperature.default,
      maxTokens: validatedMaxTokens,
      topP: undefined,
      topK: undefined,
      modelSpecific: modelSpecificDefaults,
    };
    
    // Disable topP and topK by default when changing models
    topPEnabled.value = false;
    topKEnabled.value = false;
    
    // Auto-enable thinking for models that have it enabled by default
    if ((model as any).thinkingDefaultEnabled) {
      thinkingEnabled.value = true;
    } else if (!model.supportsThinking) {
      // Disable thinking if the new model doesn't support it
      thinkingEnabled.value = false;
    }
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
    samplingBranches.value = 1;
  }
}

function cancel() {
  emit('update:modelValue', false);
}

function openArchive() {
  if (props.conversation) {
    emit('update:modelValue', false);
    router.push(`/conversation/${props.conversation.id}/archive`);
  }
}

function save() {
  // Include modelSpecific settings if they exist and have values
  const modelSpecific = settings.value.settings?.modelSpecific;
  const hasModelSpecific = modelSpecific && Object.keys(modelSpecific).length > 0;
  
  const finalSettings = {
    temperature: settings.value.settings.temperature,
    maxTokens: settings.value.settings.maxTokens,
    ...(topPEnabled.value && settings.value.settings.topP !== undefined && { topP: settings.value.settings.topP }),
    ...(topKEnabled.value && settings.value.settings.topK !== undefined && { topK: settings.value.settings.topK }),
    ...(thinkingEnabled.value && { thinking: { enabled: true, budgetTokens: thinkingBudgetTokens.value } }),
    ...(samplingBranches.value > 1 && { samplingBranches: samplingBranches.value }),
    ...(hasModelSpecific && { modelSpecific })
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
      tokensBeforeCaching: appendTokensBeforeCaching.value
    };
  } else if (contextStrategy.value === 'rolling') {
    contextManagement = {
      strategy: 'rolling',
      maxTokens: rollingMaxTokens.value,
      maxGraceTokens: rollingGraceTokens.value,
    };
  }
  
  // Build prefill user message settings (only for prefill format)
  let prefillUserMessage: any = undefined;
  let cliModePrompt: any = undefined;
  if (settings.value.format === 'prefill') {
    prefillUserMessage = {
      enabled: prefillUserMessageEnabled.value,
      content: prefillUserMessageContent.value
    };
    cliModePrompt = {
      enabled: cliModeEnabled.value,
      messageThreshold: cliModeThreshold.value
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
    prefillUserMessage,
    cliModePrompt,
    combineConsecutiveMessages: combineConsecutiveMessages.value
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

<style scoped>
.tooltip-icon {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.thinking-toggle-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tooltip-icon-button {
  background: transparent;
  border: none;
  padding: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.tooltip-icon:focus-visible,
.tooltip-icon-button:focus-visible {
  outline: 2px solid rgba(var(--v-theme-primary), 0.9);
  border-radius: 50%;
}
</style>
