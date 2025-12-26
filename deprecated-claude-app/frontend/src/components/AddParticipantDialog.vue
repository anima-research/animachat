<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="400"
  >
    <v-card>
      <v-card-title>{{ isStandardConversation ? 'Switch to Group Chat' : 'Add Participant' }}</v-card-title>
      
      <v-card-text>
        <!-- Notice for standard conversations -->
        <v-alert
          v-if="isStandardConversation"
          type="info"
          variant="tonal"
          density="compact"
          class="mb-4"
        >
          <template v-slot:text>
            Adding a participant will convert this to a group chat. The current model will become a participant, and you'll be able to have multiple models respond.
          </template>
        </v-alert>
        
        <v-radio-group
          v-model="newParticipant.type"
          inline
          hide-details
          class="mb-4"
        >
          <v-radio label="User" value="user" />
          <v-radio label="Assistant" value="assistant" />
          <v-radio v-if="canUsePersonas" label="Persona" value="persona" />
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
          <template v-slot:item="{ props, item }">
            <v-list-item v-bind="props">
              <template v-slot:prepend>
                <v-avatar :color="getPersonaColor(item.raw)" size="32">
                  <span class="text-caption">{{ item.raw.name.charAt(0).toUpperCase() }}</span>
                </v-avatar>
              </template>
              <template v-slot:subtitle>
                {{ getModelName(item.raw.modelId) }}
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
              <template v-slot:activator="{ props }">
                <v-icon
                  v-bind="props"
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
          :models="models"
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
          @click="cancel"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          variant="elevated"
          :disabled="!isValid"
          @click="confirm"
        >
          {{ isStandardConversation ? 'Convert & Add' : 'Add' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { Model, Persona } from '@deprecated-claude/shared';
import ModelSelector from '@/components/ModelSelector.vue';

interface ModelAvailability {
  userProviders: string[];
  adminProviders: string[];
  grantCurrencies: string[];
  canOverspend: boolean;
  availableProviders: string[];
}

const props = defineProps<{
  modelValue: boolean;
  models: Model[];
  availability?: ModelAvailability | null;
  personas: Persona[];
  conversationId: string;
  isStandardConversation?: boolean;
  canUsePersonas?: boolean;
  defaultModelId?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'add': [participant: { name: string; type: 'user' | 'assistant' | 'persona'; model?: string; personaId?: string }];
}>();

const newParticipant = ref({
  name: '',
  type: 'assistant' as 'user' | 'assistant' | 'persona',
  model: '',
  personaId: ''
});

// Track if the user has manually edited the name
const nameManuallyEdited = ref(false);
const lastAutoName = ref('');

// Color palette for personas (same as PersonasView)
const colors = ['primary', 'secondary', 'success', 'warning', 'info', 'error', 'purple', 'teal', 'orange', 'cyan'];

// Filter out archived personas
const personaItems = computed(() => {
  return props.personas.filter(p => !p.archivedAt);
});

const isValid = computed(() => {
  if (newParticipant.value.type === 'assistant') {
    return newParticipant.value.model !== '';
  }
  if (newParticipant.value.type === 'persona') {
    return newParticipant.value.personaId !== '';
  }
  return true;
});

function getPersonaColor(persona: Persona): string {
  if (!persona || !persona.id) return 'primary';
  const hash = persona.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function getModelName(modelId: string): string {
  const model = props.models.find(m => m.id === modelId);
  return model?.displayName || model?.shortName || modelId;
}

// Reset form when dialog opens
watch(() => props.modelValue, (open) => {
  if (open) {
    // If a default model is provided, use it
    const defaultModel = props.defaultModelId 
      ? props.models.find(m => m.id === props.defaultModelId) 
      : null;
    const defaultName = defaultModel?.shortName || defaultModel?.displayName?.split(':').pop()?.trim() || '';
    
    newParticipant.value = {
      name: defaultName,
      type: 'assistant',
      model: props.defaultModelId || '',
      personaId: ''
    };
    nameManuallyEdited.value = false;
    lastAutoName.value = defaultName;
  }
});

// Auto-populate name when model is selected
watch(() => newParticipant.value.model, (modelId) => {
  if (modelId && newParticipant.value.type === 'assistant') {
    const model = props.models.find(m => m.id === modelId);
    if (model) {
      // Use shortName if available, otherwise extract from displayName
      const suggestedName = model.shortName || model.displayName?.split(':').pop()?.trim() || '';
      // Only update if name hasn't been manually edited, or if it still matches the last auto-name
      if (!nameManuallyEdited.value || newParticipant.value.name === lastAutoName.value) {
        newParticipant.value.name = suggestedName;
        lastAutoName.value = suggestedName;
        nameManuallyEdited.value = false;
      }
    }
  }
});

// Track manual name edits
function onNameInput() {
  if (newParticipant.value.name !== lastAutoName.value) {
    nameManuallyEdited.value = true;
  }
}

function cancel() {
  emit('update:modelValue', false);
}

function confirm() {
  emit('add', {
    name: newParticipant.value.name,
    type: newParticipant.value.type,
    model: newParticipant.value.type === 'assistant' ? newParticipant.value.model : undefined,
    personaId: newParticipant.value.type === 'persona' ? newParticipant.value.personaId : undefined
  });
  emit('update:modelValue', false);
}
</script>

