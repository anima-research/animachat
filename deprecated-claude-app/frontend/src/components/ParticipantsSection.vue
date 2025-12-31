<template>
  <div class="participants-section">
    <div class="d-flex align-center mb-4">
      <h5 class="text-subtitle-1">Participants</h5>
      <v-spacer />
      <v-btn
        size="small"
        color="primary"
        variant="elevated"
        @click="addParticipant"
      >
        <v-icon icon="mdi-plus" start />
        Add Participant
      </v-btn>
    </div>
    
    <!-- Participants Table -->
    <v-table
      density="compact"
      class="participants-table"
    >
      <thead>
        <tr>
          <th width="40">Type</th>
          <th width="200">
            <div class="d-flex align-center">
              Name
              <v-tooltip location="top">
                <template v-slot:activator="{ props }">
                  <v-icon
                    v-bind="props"
                    icon="mdi-information-outline"
                    size="x-small"
                    class="ml-1"
                    style="opacity: 0.6"
                  />
                </template>
                Click to edit participant names
              </v-tooltip>
            </div>
          </th>
          <th width="250">Model</th>
          <th width="100">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="participant in participants"
          :key="participant.id"
          class="participant-row"
        >
          <td>
            <v-icon
              :icon="participant.type === 'user' ? 'mdi-account' : 'mdi-robot'"
              :color="participant.type === 'user' ? 'primary' : getModelColor(participant.model)"
              size="small"
            />
          </td>
          <td>
            <div class="editable-name-wrapper">
              <v-text-field
                :model-value="participant.name"
                @update:model-value="(value) => updateParticipantName(participant, value)"
                density="compact"
                variant="plain"
                hide-details
                single-line
                class="table-input editable-name"
                :placeholder="getParticipantPlaceholder(participant)"
              >
                <template v-slot:append-inner>
                  <v-icon
                    icon="mdi-pencil"
                    size="x-small"
                    class="edit-indicator"
                  />
                </template>
              </v-text-field>
            </div>
          </td>
          <td>
            <ModelSelector
              v-if="participant.type === 'assistant'"
              :model-value="participant.model"
              @update:model-value="(value) => updateParticipantModel(participant, value)"
              :models="activeModels"
              :availability="props.availability"
              density="compact"
              variant="plain"
              hide-details
              :show-icon="false"
              :show-provider-filter="false"
              label=""
              placeholder="Select model..."
              class="table-input"
            />
            <span v-else class="text-disabled">—</span>
          </td>
          <td>
            <v-btn
              v-if="participant.type === 'assistant'"
              icon="mdi-cog"
              size="x-small"
              variant="text"
              @click="openSettings(participant)"
              title="Advanced Settings"
            />
            <v-btn
              v-if="participants.length > 2"
              icon="mdi-delete"
              size="x-small"
              variant="text"
              color="error"
              @click="removeParticipant(participant.id)"
              title="Remove Participant"
            />
          </td>
        </tr>
      </tbody>
    </v-table>
    
    <!-- Add Participant Dialog -->
    <v-dialog
      v-model="showAddDialog"
      max-width="400"
    >
      <v-card>
        <v-card-title>New Participant</v-card-title>
        
        <v-card-text>
          <v-radio-group
            v-model="newParticipant.type"
            inline
            hide-details
            class="mb-4"
          >
            <v-radio label="User" value="user" />
            <v-radio label="Assistant" value="assistant" />
            <v-radio v-if="canUsePersonas && personaItems.length > 0" label="Persona" value="persona" />
          </v-radio-group>
          
          <!-- Persona Selector -->
          <v-select
            v-if="newParticipant.type === 'persona'"
            v-model="newParticipant.personaId"
            :items="personaItems"
            item-title="name"
            item-value="id"
            label="Select Persona"
            variant="outlined"
            density="compact"
            class="mb-4"
          >
            <template v-slot:prepend-inner>
              <v-icon>mdi-account-multiple-outline</v-icon>
            </template>
            <template v-slot:item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps">
                <template v-slot:prepend>
                  <v-avatar :color="getPersonaColor(item.raw)" size="32">
                    <span class="text-caption">{{ item.raw.name.charAt(0).toUpperCase() }}</span>
                  </v-avatar>
                </template>
                <template v-slot:subtitle>
                  {{ getModelDisplayName(item.raw.modelId) }}
                </template>
              </v-list-item>
            </template>
          </v-select>
          
          <!-- Name field for user/assistant only -->
          <v-text-field
            v-if="newParticipant.type !== 'persona'"
            v-model="newParticipant.name"
            label="Name"
            :placeholder="newParticipant.name === '' ? '(continue)' : ''"
            variant="outlined"
            density="compact"
            class="mb-4"
            @input="onNameInput"
          >
            <template v-slot:append-inner v-if="newParticipant.name === ''">
              <v-tooltip location="top">
                <template v-slot:activator="{ props: tooltipProps }">
                  <v-icon
                    v-bind="tooltipProps"
                    icon="mdi-information-outline"
                    size="small"
                    color="info"
                  />
                </template>
                Empty name creates a continuation participant - no formatting will be added
              </v-tooltip>
            </template>
          </v-text-field>
          
          <ModelSelector
            v-if="newParticipant.type === 'assistant'"
            v-model="newParticipant.model"
            :models="activeModels"
            :availability="props.availability"
            label="Model"
            variant="outlined"
            density="compact"
            :show-icon="true"
            :show-provider-filter="true"
          />
        </v-card-text>
        
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="cancelAddParticipant"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            variant="elevated"
            :disabled="!isAddDialogValid"
            @click="confirmAddParticipant"
          >
            Add
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    
    <!-- Advanced Settings Dialog -->
    <v-dialog
      v-model="showSettingsDialog"
      max-width="600"
      @update:model-value="onSettingsDialogToggled"
    >
      <v-card v-if="selectedParticipantId">
        <v-card-title>
          <div class="d-flex align-center">
            <v-icon icon="mdi-cog" class="mr-2" />
            Advanced Settings - {{ getParticipantField('name', '') }}
          </div>
        </v-card-title>
        
        <v-card-text>
          <v-textarea
            :model-value="getParticipantField('systemPrompt', '')"
            @update:model-value="(val) => setParticipantField('systemPrompt', val)"
            label="System Prompt"
            variant="outlined"
            rows="4"
            hide-details
            class="mb-4"
            placeholder="You are a helpful AI assistant..."
          />
          
          <v-slider
            :model-value="getParticipantSettingsField('temperature', 1.0)"
            @update:model-value="(val) => setParticipantSettingsField('temperature', val)"
            :min="0"
            :max="2"
            :step="0.1"
            thumb-label
            label="Temperature"
            hide-details
            class="mb-4"
            color="primary"
          >
            <template v-slot:append>
              <v-text-field
                :model-value="getParticipantSettingsField('temperature', 1.0)"
                @update:model-value="(val) => setParticipantSettingsField('temperature', parseFloat(val))"
                type="number"
                density="compact"
                style="width: 70px"
                variant="outlined"
                hide-details
                single-line
                :min="0"
                :max="2"
                :step="0.1"
              />
            </template>
          </v-slider>
          
          <v-slider
            :model-value="getParticipantSettingsField('maxTokens', selectedParticipantModel?.settings?.maxTokens?.default || 4096)"
            @update:model-value="(val) => setParticipantSettingsField('maxTokens', val)"
            :min="1"
            :max="selectedParticipantModel?.outputTokenLimit || 200000"
            :step="1"
            thumb-label
            label="Max Tokens"
            hide-details
            class="mb-4"
            color="primary"
          >
            <template v-slot:append>
              <v-text-field
                :model-value="getParticipantSettingsField('maxTokens', selectedParticipantModel?.settings?.maxTokens?.default || 4096)"
                @update:model-value="(val) => setParticipantSettingsField('maxTokens', Number(val))"
                type="number"
                density="compact"
                style="width: 100px"
                variant="outlined"
                hide-details
                single-line
                :min="1"
                :max="selectedParticipantModel?.outputTokenLimit || 200000"
              />
            </template>
          </v-slider>
          
          <!-- Thinking Settings (for models that support it) -->
          <div v-if="selectedParticipantModel?.supportsThinking" class="mb-4">
            <v-checkbox
              :model-value="getParticipantSettingsField('thinking.enabled', false)"
              @update:model-value="(val) => setParticipantSettingsField('thinking', val ? { enabled: true, budgetTokens: getParticipantSettingsField('thinking.budgetTokens', 8000) } : undefined)"
              label="Extended Thinking"
              density="compact"
              hide-details
            />
            <v-slider
              v-if="getParticipantSettingsField('thinking.enabled', false)"
              :model-value="getParticipantSettingsField('thinking.budgetTokens', 8000)"
              @update:model-value="(val) => setParticipantSettingsField('thinking', { enabled: true, budgetTokens: val })"
              :min="1024"
              :max="32000"
              :step="1024"
              thumb-label
              label="Thinking Budget"
              hide-details
              color="primary"
              class="mt-2"
            />
          </div>
          
          <!-- Model-Specific Settings -->
          <ModelSpecificSettings
            v-if="selectedParticipantConfigurableSettings.length > 0"
            v-model="selectedParticipantModelSpecific"
            :settings="selectedParticipantConfigurableSettings"
            :show-divider="true"
            :show-header="true"
            header-text="Model-Specific Settings"
          />
          
          <v-divider class="my-4" />
          
          <h4 class="text-subtitle-1 mb-3">Context Management</h4>
          <p class="text-caption text-grey mb-3">
            These settings control how conversation history is managed.
          </p>
          <v-checkbox
            v-model="participantContextOverride"
            label="Override conversation context settings"
            density="compact"
            hide-details
            class="mb-3"
          />
          
          <div v-if="participantContextOverride" class="ml-4">
            <v-select
              :model-value="getParticipantContextOverrideField('strategy', 'append')"
              @update:model-value="(val) => updateContextOverrideStrategy(val)"
              :items="contextStrategies"
              item-title="title"
              item-value="value"
              label="Context Strategy"
              variant="outlined"
              density="compact"
              class="mb-3"
            >
              <template v-slot:item="{ props, item }">
                <v-list-item v-bind="props">
                  <template v-slot:subtitle>
                    {{ item.raw.description }}
                  </template>
                </v-list-item>
              </template>
            </v-select>
            <div v-if="getParticipantContextOverrideField('strategy', 'append') === 'rolling'">
              <v-text-field
                :model-value="getParticipantContextOverrideField('maxTokens', 50000)"
                @update:model-value="(val) => setParticipantContextOverrideField('maxTokens', Number(val))"
                type="number"
                label="Max Tokens"
                variant="outlined"
                density="compact"
                hide-details
                :min="1000"
                :max="200000"
                class="mb-3">
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
                :model-value="getParticipantContextOverrideField('maxGraceTokens', 10000)"
                @update:model-value="(val) => setParticipantContextOverrideField('maxGraceTokens', Number(val))"
                type="number"
                label="Grace Tokens"
                variant="outlined"
                density="compact"
                hide-details
                :min="0"
                :max="50000"
                class="mb-3">
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
          
          <h4 class="text-subtitle-1 mb-3">Conversation Mode</h4>
          <p class="text-caption text-grey mb-3">
            How messages are formatted for this participant's model.
          </p>
          <v-select
            :model-value="selectedParticipantConversationMode"
            @update:model-value="(val) => updateParticipantConversationMode(val)"
            :items="conversationModeOptions"
            item-title="title"
            item-value="value"
            label="Mode"
            variant="outlined"
            density="compact"
            class="mb-3"
          >
            <template v-slot:item="{ props, item }">
              <v-list-item v-bind="props">
                <template v-slot:subtitle>
                  {{ item.raw.description }}
                </template>
              </v-list-item>
            </template>
          </v-select>
          
          <v-alert
            type="info"
            variant="tonal"
            density="compact"
            class="mt-4"
          >
            These settings override the default model parameters for this participant.
          </v-alert>
        </v-card-text>
        
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="closeSettings"
          >
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, PropType } from 'vue';
import type { Participant, Model, ConfigurableSetting, Persona } from '@deprecated-claude/shared';
import { getValidatedModelDefaults } from '@deprecated-claude/shared';
import { getModelColor } from '@/utils/modelColors';
import { get as _get, set as _set, cloneDeep, isEqual } from 'lodash-es';
import ModelSelector from './ModelSelector.vue';
import ModelSpecificSettings from './ModelSpecificSettings.vue';

const props = defineProps({
  modelValue: {
    type: Array as PropType<Participant[]>,
    required: true
  },
  models: {
    type: Array as PropType<Model[]>,
    required: true
  },
  availability: {
    type: Object as PropType<{ userProviders: string[]; adminProviders: string[]; grantCurrencies: string[]; canOverspend: boolean; availableProviders: string[] } | null>,
    default: null
  },
  personas: {
    type: Array as PropType<Persona[]>,
    default: () => []
  },
  canUsePersonas: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits<{
  'update:modelValue': [value: Participant[]];
}>();

const participants = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const activeModels = computed(() => {
  return props.models.filter(m => !m.hidden);
});

const showAddDialog = ref(false);
const showSettingsDialog = ref(false);
const selectedParticipantId = ref<string | null>(null);
const newParticipant = ref<{
  type: 'user' | 'assistant' | 'persona';
  name: string;
  model: string;
  personaId: string;
}>({
  type: 'assistant',
  name: '',
  model: '',
  personaId: ''
});

// Track if the user has manually edited the name
const nameManuallyEdited = ref(false);
const lastAutoName = ref('');

// Color palette for personas
const personaColors = ['primary', 'secondary', 'success', 'warning', 'info', 'error', 'purple', 'teal', 'orange', 'cyan'];

// Filter out archived personas
const personaItems = computed(() => {
  return props.personas.filter(p => !p.archivedAt);
});

function getPersonaColor(persona: Persona): string {
  if (!persona || !persona.id) return 'primary';
  const hash = persona.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return personaColors[hash % personaColors.length];
}

function getModelDisplayName(modelId: string): string {
  const model = props.models.find(m => m.id === modelId);
  return model?.displayName || model?.shortName || modelId;
}

const defaultContextOverrideAppend = {
  strategy: 'append',
}

const defaultContextOverrideRollingWindow = {
  strategy: 'rolling',
  maxTokens: 50000,
  maxGraceTokens: 10000,
}

function getDefaultContextOverride(strategy: string) {
  return strategy == 'append'
    ? defaultContextOverrideAppend
    : defaultContextOverrideRollingWindow;
}

// Context management settings for participant
const participantContextOverride = ref(false);

const contextStrategies = [
  {
    value: 'append',
    title: 'Append',
    description: 'Keeps all messages, moves cache marker forward'
  },
  {
    value: 'rolling',
    title: 'Rolling Window',
    description: 'Maintains a sliding window of recent messages'
  }
];

// Conversation mode options for per-participant format override
const conversationModeOptions = [
  {
    value: 'auto',
    title: 'Auto',
    description: 'Use prefill if model supports it, otherwise messages'
  },
  {
    value: 'prefill',
    title: 'Prefill',
    description: 'Conversation log format with participant names (Claude native)'
  },
  {
    value: 'messages',
    title: 'Messages',
    description: 'Alternating user/assistant format (OpenAI compatible)'
  },
  {
    value: 'completion',
    title: 'Completion',
    description: 'OpenRouter completion mode (prompt field)'
  }
];


// generic functions for getting and setting participant fields
// these need to send updates correctly by modifying the participants array
// having a "cur modifying participant" object will not work bc it may be a copy
// and thus when you make changes they (sometimes) won't persist
function getParticipantField(path: string, defaultValue: any) {
  const p = participants.value.find(p => p.id === selectedParticipantId.value);
  return _get(p ?? {}, path, defaultValue);
}

function setParticipantField(path: string, value: any) {
  const list = participants.value;
  const idx = list.findIndex(p => p.id === selectedParticipantId.value);
  if (idx < 0) return;

  const updated = cloneDeep(list);
  _set(updated[idx], path, value);

  // avoid no-op emits
  if (isEqual(list[idx], updated[idx])) return;
  
  // emit the modified participants array
  participants.value = updated;
}

function getParticipantSettingsField(settingsFieldName: string, defaultValue: any) {
  return getParticipantField("settings." + settingsFieldName, defaultValue);
}

function setParticipantSettingsField(settingsFieldName: string, value: any) {
  // Do not modify existing copy (that may be overwritten/may be a proxy)
  // instead we need to send changes back up by using these methods
  var currentSettings = cloneDeep(getParticipantField("settings", {
    // default settings if unspecified
    temperature: 1.0,
    maxTokens: 4096 // Safe default for all models (some like Opus 3 cap at 4096)
  }));
  
  _set(currentSettings, settingsFieldName, value);
  
  setParticipantField('settings', currentSettings);
}

function getParticipantContextOverrideField(contextOverrideFieldName: string, defaultValue: any) {
  return getParticipantField('contextManagement.' + contextOverrideFieldName, defaultValue);
}

function setParticipantContextOverrideField(contextOverrideFieldName: string, value: any) {
  // Do not modify existing copy (that may be overwritten/may be a proxy)
  // instead we need to send changes back up by using these methods
  var currentContextOverride = cloneDeep(getParticipantField('contextManagement',
    getDefaultContextOverride(getParticipantContextOverrideField("strategy", "append"))));
  
  _set(currentContextOverride, contextOverrideFieldName, value);
  
  setParticipantField("contextManagement", currentContextOverride);
}

function updateContextOverrideStrategy(strategy: string) {
  setParticipantContextOverrideField("strategy", strategy);
  // reset to default values for new strategy (this uses the assigned strategy when looking up)
  setParticipantField("contextManagement", getDefaultContextOverride(strategy));
}

// Model-specific settings for the selected participant
const selectedParticipantModel = computed(() => {
  const participant = participants.value.find(p => p.id === selectedParticipantId.value);
  if (!participant || participant.type !== 'assistant') return null;
  return props.models.find(m => m.id === participant.model) || null;
});

const selectedParticipantConfigurableSettings = computed<ConfigurableSetting[]>(() => {
  return (selectedParticipantModel.value?.configurableSettings as ConfigurableSetting[]) || [];
});

const selectedParticipantModelSpecific = computed({
  get: () => getParticipantSettingsField('modelSpecific', {}) as Record<string, unknown>,
  set: (value: Record<string, unknown>) => {
    setParticipantSettingsField('modelSpecific', value);
  },
});

// Conversation mode for the selected participant
const selectedParticipantConversationMode = computed(() => {
  const participant = participants.value.find(p => p.id === selectedParticipantId.value);
  return participant?.conversationMode || 'auto';
});

function updateParticipantConversationMode(mode: string) {
  const participant = participants.value.find(p => p.id === selectedParticipantId.value);
  if (participant) {
    participant.conversationMode = mode as 'auto' | 'prefill' | 'messages' | 'completion';
    emit('update:participants', [...participants.value]);
  }
}

function getParticipantPlaceholder(participant: any) {
  if (participant.name === '') {
    return '(continue)';
  }
  return 'Enter name...';
}

function addParticipant() {
  const defaultModel = activeModels.value[0] || props.models[0];
  const defaultModelName = defaultModel?.shortName || defaultModel?.displayName || '';
  
  newParticipant.value = {
    type: 'assistant',
    name: defaultModelName,
    model: defaultModel?.id || '',
    personaId: ''
  };
  nameManuallyEdited.value = false;
  lastAutoName.value = defaultModelName;
  showAddDialog.value = true;
}

function confirmAddParticipant() {
  const participant: any = {
    id: 'temp-' + Date.now(), // Temporary ID
    conversationId: '', // Will be set by parent
    type: newParticipant.value.type,
    name: newParticipant.value.name,
    isActive: true
  };
  
  if (newParticipant.value.type === 'assistant') {
    participant.model = newParticipant.value.model;
    participant.systemPrompt = '';
    // Use validated model defaults
    const selectedModel = activeModels.value.find(m => m.id === newParticipant.value.model);
    if (selectedModel) {
      participant.settings = getValidatedModelDefaults(selectedModel);
    } else {
      // Fallback for when model not found (shouldn't happen normally)
    participant.settings = {
      temperature: 1.0,
        maxTokens: 4096
      };
    }
  } else if (newParticipant.value.type === 'persona') {
    // For persona, get the model and name from the persona
    const persona = props.personas.find(p => p.id === newParticipant.value.personaId);
    if (persona) {
      participant.name = persona.name;
      participant.model = persona.modelId;
      participant.personaId = newParticipant.value.personaId;
      participant.type = 'assistant'; // Personas are assistant type
    }
  }
  
  const updated = [...participants.value, participant];
  emit('update:modelValue', updated);
  
  showAddDialog.value = false;
  newParticipant.value = {
    type: 'assistant',
    name: '',
    model: '',
    personaId: ''
  };
}

function cancelAddParticipant() {
  showAddDialog.value = false;
  newParticipant.value = {
    type: 'assistant',
    name: '',
    model: '',
    personaId: ''
  };
  nameManuallyEdited.value = false;
  lastAutoName.value = '';
}

// Track manual name edits
function onNameInput() {
  if (newParticipant.value.name !== lastAutoName.value) {
    nameManuallyEdited.value = true;
  }
}

// Auto-populate name when model is selected
watch(() => newParticipant.value.model, (modelId) => {
  if (modelId && newParticipant.value.type === 'assistant') {
    const model = props.models.find(m => m.id === modelId);
    if (model) {
      const suggestedName = model.shortName || model.displayName?.split(':').pop()?.trim() || '';
      if (!nameManuallyEdited.value || newParticipant.value.name === lastAutoName.value) {
        newParticipant.value.name = suggestedName;
        lastAutoName.value = suggestedName;
        nameManuallyEdited.value = false;
      }
    }
  }
});

// Validation for add dialog
const isAddDialogValid = computed(() => {
  if (newParticipant.value.type === 'assistant') {
    return newParticipant.value.model !== '';
  }
  if (newParticipant.value.type === 'persona') {
    return newParticipant.value.personaId !== '';
  }
  return true; // user type is always valid
});

function removeParticipant(id: string) {
  const updated = participants.value.filter(p => p.id !== id);
  emit('update:modelValue', updated);
}

// when toggle checkbox, set context overrides to default/unknown as needed
watch(participantContextOverride, () => {
  if (!selectedParticipantId.value) return;
  if (participantContextOverride.value) {
    if (getParticipantField('contextManagement', null) == null) {
      setParticipantField('contextManagement', getDefaultContextOverride(getParticipantContextOverrideField("strategy", "append")));
    }
  } else {
    setParticipantField('contextManagement', undefined);
  }
});

function openSettings(participant: Participant) {
  // we edit a draft, actually apply changes later
  selectedParticipantId.value = participant.id;
  participantContextOverride.value = Boolean(participant.contextManagement);
  
  showSettingsDialog.value = true;
}

// ensure close settings is called when the user clicks out of the box instead of the close button
function onSettingsDialogToggled(open: boolean) {
  if (!open) closeSettings();
}

function closeSettings() {
  showSettingsDialog.value = false;
  selectedParticipantId.value = null;
  participantContextOverride.value = false;
}

function updateParticipantModel(participant: any, newModelId: string) {
  console.log('[ParticipantsSection] updateParticipantModel called');
  console.log('  participant:', participant);
  console.log('  old model:', participant.model);
  console.log('  new model:', newModelId);
  
  // Find the participant in the array
  const list = participants.value;
  const idx = list.findIndex(p => p.id === participant.id);
  if (idx < 0) {
    console.log('  ❌ Participant not found in list!');
    return;
  }
  
  // Get the new model's display name for auto-fill
  const newModel = props.models.find(m => m.id === newModelId);
  const newModelName = newModel?.shortName || newModel?.displayName || '';
  
  // Check if we should auto-fill the name:
  // - Name is empty, OR
  // - Name matches the old model's name (shortName or displayName)
  const oldModel = props.models.find(m => m.id === participant.model);
  const oldModelNames = [
    oldModel?.shortName,
    oldModel?.displayName,
    oldModel?.name
  ].filter(Boolean);
  
  const shouldAutoFillName = 
    !participant.name || 
    participant.name === '' ||
    oldModelNames.includes(participant.name);
  
  // Create a new array with the updated participant
  const updated = cloneDeep(list);
  updated[idx] = {
    ...updated[idx],
    model: newModelId,
    ...(shouldAutoFillName && newModelName ? { name: newModelName } : {})
  };
  
  // If the new model doesn't support thinking, clear thinking settings
  if (updated[idx].settings?.thinking && !newModel?.supportsThinking) {
    console.log('  Clearing thinking settings (new model does not support thinking)');
    delete updated[idx].settings.thinking;
  }
  
  // Ensure maxTokens doesn't exceed the new model's output limit
  if (updated[idx].settings?.maxTokens && newModel?.outputTokenLimit) {
    if (updated[idx].settings.maxTokens > newModel.outputTokenLimit) {
      console.log(`  Capping maxTokens from ${updated[idx].settings.maxTokens} to ${newModel.outputTokenLimit}`);
      updated[idx].settings.maxTokens = newModel.outputTokenLimit;
    }
  }
  
  console.log('  ✅ Emitting updated participants:', updated);
  
  // Emit the updated array to trigger proper reactivity
  emit('update:modelValue', updated);
}

function updateParticipantName(participant: any, newName: string) {
  // Find the participant in the array
  const list = participants.value;
  const idx = list.findIndex(p => p.id === participant.id);
  if (idx < 0) return;
  
  // Create a new array with the updated participant
  const updated = cloneDeep(list);
  updated[idx] = {
    ...updated[idx],
    name: newName
  };
  
  // Emit the updated array to trigger proper reactivity
  emit('update:modelValue', updated);
}

</script>

<style scoped>
.participants-section {
  margin-top: 1rem;
}

.participants-table {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  overflow: hidden;
}

.participants-table th {
  font-weight: 600;
  font-size: 0.875rem;
  text-align: left;
  padding: 12px 16px !important;
  background: rgba(var(--v-theme-surface-variant), 0.5);
}

.participants-table td {
  padding: 8px 16px !important;
  vertical-align: middle;
}

.participant-row {
  transition: background-color 0.2s;
}

.participant-row:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.04);
}

.table-input {
  margin-top: -4px;
  margin-bottom: -4px;
}

.table-input :deep(.v-field) {
  padding: 0;
}

.table-input :deep(.v-field__input) {
  padding: 4px 0;
  min-height: 32px;
}

.table-input :deep(.v-field__append-inner) {
  padding-top: 4px;
}

.table-input :deep(.v-input__details) {
  display: none;
}

/* Make select dropdown more compact */
.table-input :deep(.v-select__selection) {
  margin: 0;
}

/* Editable name field styles */
.editable-name-wrapper {
  position: relative;
}

.editable-name {
  cursor: text;
}

.editable-name :deep(.v-field__input) {
  cursor: text;
}

/* Edit indicator icon - hidden by default */
.edit-indicator {
  opacity: 0;
  transition: opacity 0.2s ease;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

/* Show edit icon on hover */
.editable-name-wrapper:hover .edit-indicator {
  opacity: 1;
}

/* Add subtle background on hover */
.editable-name-wrapper:hover .editable-name :deep(.v-field) {
  background-color: rgba(var(--v-theme-primary), 0.04);
  border-radius: 4px;
  padding: 0 8px;
}

/* Add border when focused */
.editable-name :deep(.v-field--focused) {
  background-color: rgba(var(--v-theme-primary), 0.08);
  border-radius: 4px;
  padding: 0 8px;
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-primary), 0.3);
}

/* Ensure placeholder text is visible */
.editable-name :deep(.v-field__input::placeholder) {
  color: rgba(var(--v-theme-on-surface), 0.3);
  opacity: 1;
}
</style>