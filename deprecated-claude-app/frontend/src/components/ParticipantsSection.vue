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
              :color="participant.type === 'user' ? 'primary' : 'secondary'"
              size="small"
            />
          </td>
          <td>
            <div class="editable-name-wrapper">
              <v-text-field
                v-model="participant.name"
                density="compact"
                variant="plain"
                hide-details
                single-line
                class="table-input editable-name"
                placeholder="Enter name..."
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
            <v-select
              v-if="participant.type === 'assistant'"
              v-model="participant.model"
              :items="models"
              item-title="displayName"
              item-value="id"
              density="compact"
              variant="plain"
              hide-details
              single-line
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
          </v-radio-group>
          
          <v-text-field
            v-model="newParticipant.name"
            label="Name"
            variant="outlined"
            density="compact"
            class="mb-4"
          />
          
          <v-select
            v-if="newParticipant.type === 'assistant'"
            v-model="newParticipant.model"
            :items="models"
            item-title="displayName"
            item-value="id"
            label="Model"
            variant="outlined"
            density="compact"
            @update:model-value="onModelSelected"
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
            :disabled="!newParticipant.name"
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
    >
      <v-card v-if="editingParticipant">
        <v-card-title>
          <div class="d-flex align-center">
            <v-icon icon="mdi-cog" class="mr-2" />
            Advanced Settings - {{ editingParticipant.name }}
          </div>
        </v-card-title>
        
        <v-card-text>
          <v-textarea
            v-model="editingParticipant.systemPrompt"
            label="System Prompt"
            variant="outlined"
            rows="4"
            hide-details
            class="mb-4"
            placeholder="You are a helpful AI assistant..."
          />
          
          <v-slider
            :model-value="editingParticipant ? getParticipantTemperature(editingParticipant) : 1.0"
            @update:model-value="(val) => editingParticipant && setParticipantTemperature(editingParticipant, val)"
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
                :model-value="editingParticipant ? getParticipantTemperature(editingParticipant) : 1.0"
                @update:model-value="(val) => editingParticipant && setParticipantTemperature(editingParticipant, Number(val))"
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
          
          <v-text-field
            :model-value="editingParticipant ? getParticipantMaxTokens(editingParticipant) : 1024"
            @update:model-value="(val) => editingParticipant && setParticipantMaxTokens(editingParticipant, Number(val))"
            type="number"
            label="Max Tokens"
            variant="outlined"
            hide-details
            :min="1"
            :max="200000"
          />
          
          <v-divider class="my-4" />
          
          <h4 class="text-subtitle-1 mb-3">Context Management</h4>
          
          <v-checkbox
            v-model="participantContextOverride"
            label="Override conversation context settings"
            density="compact"
            hide-details
            class="mb-3"
          />
          
          <div v-if="participantContextOverride" class="ml-4">
            <v-select
              v-model="participantContextStrategy"
              :items="contextStrategies"
              item-title="title"
              item-value="value"
              label="Context Strategy"
              variant="outlined"
              density="compact"
              hide-details
              class="mb-3"
            />
            
            <div v-if="participantContextStrategy === 'append'">
              <v-text-field
                v-model.number="participantCacheInterval"
                type="number"
                label="Cache Interval"
                variant="outlined"
                density="compact"
                hide-details
                :min="1000"
                :max="200000"
                class="mb-3"
              />
            </div>
            
            <div v-if="participantContextStrategy === 'rolling'">
              <v-text-field
                v-model.number="participantRollingMaxTokens"
                type="number"
                label="Max Tokens"
                variant="outlined"
                density="compact"
                hide-details
                :min="1000"
                :max="200000"
                class="mb-3"
              />
              
              <v-text-field
                v-model.number="participantRollingGraceTokens"
                type="number"
                label="Grace Tokens"
                variant="outlined"
                density="compact"
                hide-details
                :min="0"
                :max="50000"
                class="mb-3"
              />
              
              <v-text-field
                v-model.number="participantCacheMinTokens"
                type="number"
                label="Cache Min Tokens"
                variant="outlined"
                density="compact"
                hide-details
                :min="0"
                :max="50000"
                class="mb-3"
              />
              
              <v-text-field
                v-model.number="participantCacheDepthFromEnd"
                type="number"
                label="Cache Depth From End"
                variant="outlined"
                density="compact"
                hide-details
                :min="0"
                :max="20000"
                class="mb-3"
              />
            </div>
          </div>
          
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
import { type Participant, type Model, UpdateParticipantSchema } from '@deprecated-claude/shared';
import deepEqual from 'deep-equal';
import { useStore } from '@/store';
const store = useStore();

const props = defineProps({
  modelValue: {
    type: Array as PropType<Participant[]>,
    required: true
  },
  models: {
    type: Array as PropType<Model[]>,
    required: true
  }
});

const emit = defineEmits<{
  'update:modelValue': [value: Participant[]];
}>();

const participants = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const showAddDialog = ref(false);
const showSettingsDialog = ref(false);
const editingParticipant = ref<Participant | null>(null);
const originalEditingParticipant = ref<Participant | null>(null);
const newParticipant = ref<any>({
  type: 'assistant',
  name: '',
  model: ''
});

// Context management settings for participant
const participantContextOverride = ref(false);
const participantContextStrategy = ref('append');
/// append settings
const participantCacheInterval = ref(10000);
/// rolling settings
const participantRollingMaxTokens = ref(50000);
const participantRollingGraceTokens = ref(10000);
const participantCacheMinTokens = ref(5000);
const participantCacheDepthFromEnd = ref(5);

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

function getParticipantTemperature(participant: Participant): number {
  return participant.settings?.temperature ?? 1.0;
}

function setParticipantTemperature(participant: Participant, value: number) {
  console.log(participant);
  console.log(participant.settings);
  if (!participant.settings) {
    participant.settings = {
      temperature: value,
      maxTokens: 1024
    };
  } else {
    participant.settings.temperature = value;
  }
}

function getParticipantMaxTokens(participant: Participant): number {
  return participant.settings?.maxTokens ?? 1024;
}

function setParticipantMaxTokens(participant: Participant, value: string | number) {
  if (!participant.settings) {
    participant.settings = {
      temperature: 1.0,
      maxTokens: parseInt(value.toString())
    };
  } else {
    participant.settings.maxTokens = parseInt(value.toString());
  }
}

function addParticipant() {
  newParticipant.value = {
    type: 'assistant',
    name: '',
    model: props.models[0]?.id || ''
  };
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
    participant.settings = {
      temperature: 1.0,
      maxTokens: 1024
    };
  }
  
  const updated = [...participants.value, participant];
  emit('update:modelValue', updated);
  
  showAddDialog.value = false;
  newParticipant.value = {
    type: 'assistant',
    name: '',
    model: ''
  };
}

function cancelAddParticipant() {
  showAddDialog.value = false;
  newParticipant.value = {
    type: 'assistant',
    name: '',
    model: ''
  };
}

function removeParticipant(id: string) {
  const updated = participants.value.filter(p => p.id !== id);
  emit('update:modelValue', updated);
}

function openSettings(participant: Participant) {
  editingParticipant.value = participant;
  
  originalEditingParticipant.value =
    JSON.parse(JSON.stringify(participant));
  
  // Load context management settings
  if (participant.contextManagement) {
    participantContextOverride.value = true;
    participantContextStrategy.value = participant.contextManagement.strategy;
    if(participant.contextManagement.strategy === 'append') {
      participantCacheInterval.value = participant.contextManagement.cacheInterval;
    }
    else if (participant.contextManagement.strategy === 'rolling') {
      participantRollingMaxTokens.value = participant.contextManagement.maxTokens;
      participantRollingGraceTokens.value = participant.contextManagement.maxGraceTokens;
      participantCacheMinTokens.value = participant.contextManagement.cacheMinTokens;
      participantCacheDepthFromEnd.value = participant.contextManagement.cacheDepthFromEnd;
    }
  } else {
    participantContextOverride.value = false;
    participantContextStrategy.value = 'append';
    // append settings
    participantCacheInterval.value = 10000;
    // rolling settings
    participantRollingMaxTokens.value = 50000;
    participantRollingGraceTokens.value = 10000;
    participantCacheMinTokens.value = 5000;
    participantCacheDepthFromEnd.value = 5;
  }
  
  showSettingsDialog.value = true;
}

async function closeSettings() {
  // Save context management settings
  if (editingParticipant.value) {
    if (participantContextOverride.value) {
      if (participantContextStrategy.value === 'append') {
        editingParticipant.value.contextManagement = {
          strategy: 'append',
          cacheInterval: participantCacheInterval.value
        };
      } else if (participantContextStrategy.value === 'rolling') {
        editingParticipant.value.contextManagement = {
          strategy: 'rolling',
          maxTokens: participantRollingMaxTokens.value,
          maxGraceTokens: participantRollingGraceTokens.value,
          cacheMinTokens: participantCacheMinTokens.value,
          cacheDepthFromEnd: participantCacheDepthFromEnd.value
        };
      }
    } else {
      editingParticipant.value.contextManagement = undefined;
    }
    // update edited participant, if modified
    if (!deepEqual(originalEditingParticipant.value, editingParticipant.value)) {
      try {
        const response = await fetch(`/api/participants/${editingParticipant.value.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${store.token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(UpdateParticipantSchema.parse({
            name: editingParticipant.value.name,
            model: editingParticipant.value.model,
            systemPrompt: editingParticipant.value.systemPrompt,
            settings: editingParticipant.value.settings,
            // keep in mind this field is special, for other fields undefined will simply skip modifying it
            // but for this field undefined means "use defaults" so its value will always be passed through
            contextManagement: editingParticipant.value.contextManagement,
            isActive: editingParticipant.value.isActive
          }))
        });
        if (!response.ok) {
          console.error('Failed to update participant:', response);
        }
      } catch (error) {
        console.error('Failed to update participant:', error);
      }
    }
  }
  
  showSettingsDialog.value = false;
  editingParticipant.value = null;
}

function onModelSelected(modelId: string) {
  // If the name is empty or hasn't been customized, set it to the model's shortName
  if (!newParticipant.value.name || newParticipant.value.name === '') {
    const model = props.models.find(m => m.id === modelId);
    if (model) {
      newParticipant.value.name = model.shortName || model.displayName;
    }
  }
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