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
        Add Participant
      </v-btn>
    </div>
    
    <!-- Participants List -->
    <div class="participants-list">
      <v-card
        v-for="(participant, index) in participants"
        :key="participant.id"
        variant="outlined"
        class="participant-card mb-3"
      >
        <div class="participant-header d-flex align-center pa-3">
          <v-icon 
            :icon="participant.type === 'user' ? 'mdi-account' : 'mdi-robot'"
            class="mr-3"
          />
          
          <v-text-field
            v-model="participant.name"
            density="compact"
            variant="outlined"
            hide-details
            class="flex-grow-1"
          />
          
          <v-btn
            v-if="participants.length > 2"
            icon="mdi-delete"
            size="small"
            variant="text"
            color="error"
            class="ml-2"
            @click="removeParticipant(participant.id)"
          />
        </div>
        
        <!-- Assistant-specific settings -->
        <div v-if="participant.type === 'assistant'" class="px-3 pb-3">
          <v-select
            v-model="participant.model"
            :items="models"
            item-title="displayName"
            item-value="id"
            label="Model"
            density="compact"
            variant="outlined"
            hide-details
            class="mb-2"
          />
          
          <v-expansion-panels
            flat
            class="advanced-settings"
          >
            <v-expansion-panel>
              <v-expansion-panel-title class="text-caption pa-2">
                <v-icon size="small" class="mr-2">mdi-cog</v-icon>
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
                  class="mb-3"
                  placeholder="You are a helpful AI assistant..."
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
                  class="mb-3"
                  color="primary"
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
        </div>
      </v-card>
    </div>
    
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, PropType } from 'vue';
import type { Participant, Model } from '@deprecated-claude/shared';

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
const newParticipant = ref<any>({
  type: 'assistant',
  name: '',
  model: ''
});

function getParticipantTemperature(participant: Participant): number {
  return participant.settings?.temperature ?? 1.0;
}

function setParticipantTemperature(participant: Participant, value: number) {
  if (!participant.settings) {
    participant.settings = {};
  }
  participant.settings.temperature = value;
}

function getParticipantMaxTokens(participant: Participant): number {
  return participant.settings?.maxTokens ?? 1024;
}

function setParticipantMaxTokens(participant: Participant, value: string | number) {
  if (!participant.settings) {
    participant.settings = {};
  }
  participant.settings.maxTokens = parseInt(value.toString());
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
</script>

<style scoped>
.participants-section {
  margin-top: 1rem;
}

.participant-card {
  transition: all 0.2s;
}

.participant-card:hover {
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.participant-header {
  border-bottom: 1px solid rgba(0,0,0,0.08);
}

.advanced-settings {
  background: transparent !important;
  box-shadow: none !important;
}

.advanced-settings .v-expansion-panel {
  background: rgba(0,0,0,0.02);
}

.advanced-settings .v-expansion-panel-title {
  min-height: 36px !important;
  padding: 8px 12px !important;
  font-size: 0.875rem;
}
</style>
