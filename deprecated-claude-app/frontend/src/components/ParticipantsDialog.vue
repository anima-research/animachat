<template>
  <v-dialog
    v-model="dialog"
    max-width="600"
    persistent
  >
    <v-card>
      <v-card-title>Manage Participants</v-card-title>
      
      <v-card-text>
        <v-alert
          v-if="conversation?.format === 'standard'"
          type="info"
          density="compact"
          class="mb-4"
        >
          Standard format only supports one user and one assistant.
        </v-alert>
        
        <div class="mb-4">
          <div class="d-flex align-center mb-2">
            <h5 class="text-h6">Participants</h5>
            <v-spacer />
            <v-btn
              v-if="conversation?.format !== 'standard'"
              size="small"
              color="primary"
              @click="addParticipant"
            >
              Add Participant
            </v-btn>
          </div>
          
          <v-list>
            <v-list-item
              v-for="participant in participants"
              :key="participant.id"
              :disabled="conversation?.format === 'standard'"
            >
              <template v-slot:prepend>
                <v-icon :icon="participant.type === 'user' ? 'mdi-account' : 'mdi-robot'" />
              </template>
              
              <v-list-item-title>
                <v-text-field
                  v-model="participant.name"
                  density="compact"
                  variant="outlined"
                  hide-details
                  :disabled="conversation?.format === 'standard'"
                />
              </v-list-item-title>
              
              <v-list-item-subtitle v-if="participant.type === 'assistant'">
                <v-select
                  v-model="participant.model"
                  :items="models"
                  item-title="displayName"
                  item-value="id"
                  label="Model"
                  density="compact"
                  variant="outlined"
                  hide-details
                  class="mt-2"
                  :disabled="conversation?.format === 'standard'"
                />
                
                <v-expansion-panels
                  v-if="conversation?.format !== 'standard'"
                  flat
                  class="mt-2"
                >
                  <v-expansion-panel>
                    <v-expansion-panel-title class="text-caption pa-2">
                      Advanced Settings
                    </v-expansion-panel-title>
                    <v-expansion-panel-text>
                      <v-textarea
                        v-model="participant.systemPrompt"
                        label="System Prompt"
                        density="compact"
                        variant="outlined"
                        rows="3"
                        hide-details
                        class="mb-2"
                      />
                      
                      <v-slider
                        :model-value="getParticipantTemperature(participant)"
                        @update:model-value="(val) => setParticipantTemperature(participant, val)"
                        :min="0"
                        :max="2"
                        :step="0.1"
                        thumb-label
                        label="Temperature"
                        hide-details
                        class="mb-2"
                      />
                      
                      <v-text-field
                        :model-value="getParticipantMaxTokens(participant)"
                        @update:model-value="(val) => setParticipantMaxTokens(participant, val)"
                        type="number"
                        label="Max Tokens"
                        density="compact"
                        variant="outlined"
                        hide-details
                      />
                    </v-expansion-panel-text>
                  </v-expansion-panel>
                </v-expansion-panels>
              </v-list-item-subtitle>
              
              <template v-slot:append>
                <v-btn
                  v-if="conversation?.format !== 'standard' && participants.length > 2"
                  icon="mdi-delete"
                  size="small"
                  variant="text"
                  color="error"
                  @click="removeParticipant(participant.id)"
                />
              </template>
            </v-list-item>
          </v-list>
        </div>
        
        <v-divider v-if="newParticipant" class="my-4" />
        
        <div v-if="newParticipant" class="new-participant">
          <h5 class="text-h6 mb-3">New Participant</h5>
          
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
            class="mb-4"
          />
          
          <div class="d-flex gap-2">
            <v-btn
              color="primary"
              @click="confirmAddParticipant"
              :disabled="!newParticipant.name"
            >
              Add
            </v-btn>
            <v-btn
              variant="text"
              @click="cancelAddParticipant"
            >
              Cancel
            </v-btn>
          </div>
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

const props = defineProps<{
  modelValue: boolean;
  conversation: Conversation | null;
  models: Model[];
  currentParticipants: Participant[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  update: [participants: Participant[]];
}>();

const dialog = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const participants = ref<Participant[]>([]);
const newParticipant = ref<{
  type: 'user' | 'assistant';
  name: string;
  model?: string;
} | null>(null);

// Initialize participants from props
watch(() => props.currentParticipants, (current) => {
  if (current) {
    participants.value = current.map(p => ({ ...p }));
  }
}, { immediate: true });

function addParticipant() {
  newParticipant.value = {
    type: 'user',
    name: '',
    model: props.models[0]?.id
  };
}

function confirmAddParticipant() {
  if (!newParticipant.value || !newParticipant.value.name) return;
  
  const participant: Participant = {
    id: `temp-${Date.now()}`, // Temporary ID, will be replaced by backend
    conversationId: props.conversation?.id || '',
    name: newParticipant.value.name,
    type: newParticipant.value.type,
    model: newParticipant.value.type === 'assistant' ? newParticipant.value.model : undefined,
    isActive: true,
    // Initialize settings for assistant participants
    settings: newParticipant.value.type === 'assistant' ? {
      temperature: 1.0,
      maxTokens: 1024
    } : undefined
  };
  
  participants.value.push(participant);
  newParticipant.value = null;
}

function cancelAddParticipant() {
  newParticipant.value = null;
}

function removeParticipant(id: string) {
  participants.value = participants.value.filter(p => p.id !== id);
}

function cancel() {
  emit('update:modelValue', false);
}

function getParticipantTemperature(participant: Participant): number {
  return participant.settings?.temperature ?? 1.0;
}

function setParticipantTemperature(participant: Participant, value: number) {
  if (!participant.settings) {
    participant.settings = { temperature: value, maxTokens: 1024 };
  } else {
    participant.settings.temperature = value;
  }
}

function getParticipantMaxTokens(participant: Participant): number {
  return participant.settings?.maxTokens ?? 1024;
}

function setParticipantMaxTokens(participant: Participant, value: number | string) {
  const numValue = typeof value === 'string' ? parseInt(value, 10) : value;
  if (isNaN(numValue)) return;
  
  if (!participant.settings) {
    participant.settings = { temperature: 1.0, maxTokens: numValue };
  } else {
    participant.settings.maxTokens = numValue;
  }
}

function save() {
  emit('update', participants.value);
  emit('update:modelValue', false);
}
</script>

<style scoped>
.new-participant {
  background: rgba(0, 0, 0, 0.05);
  padding: 16px;
  border-radius: 8px;
}

.v-theme--dark .new-participant {
  background: rgba(255, 255, 255, 0.05);
}
</style>
