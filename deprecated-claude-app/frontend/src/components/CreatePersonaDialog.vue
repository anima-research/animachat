<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="500"
  >
    <v-card>
      <v-card-title>Create Persona</v-card-title>

      <v-card-text>
        <v-text-field
          v-model="form.name"
          label="Name"
          placeholder="e.g., Aria, Claude-Philosophy"
          variant="outlined"
          density="compact"
          class="mb-4"
          :rules="[v => !!v || 'Name is required']"
        />

        <ModelSelector
          v-model="form.modelId"
          :models="models"
          :availability="props.availability"
          label="Model"
          variant="outlined"
          density="compact"
          :show-icon="true"
          :show-provider-filter="true"
          class="mb-4"
        />

        <v-select
          v-model="form.contextStrategy.type"
          :items="contextStrategyOptions"
          label="Context Strategy"
          variant="outlined"
          density="compact"
          class="mb-4"
        />

        <v-text-field
          v-if="form.contextStrategy.type === 'rolling'"
          v-model.number="form.contextStrategy.maxTokens"
          label="Max Tokens"
          type="number"
          variant="outlined"
          density="compact"
          class="mb-4"
          hint="Maximum tokens for rolling window"
        />

        <template v-if="form.contextStrategy.type === 'anchored'">
          <v-text-field
            v-model.number="form.contextStrategy.prefixTokens"
            label="Prefix Tokens"
            type="number"
            variant="outlined"
            density="compact"
            class="mb-4"
            hint="Tokens to preserve from beginning"
          />
          <v-text-field
            v-model.number="form.contextStrategy.rollingTokens"
            label="Rolling Tokens"
            type="number"
            variant="outlined"
            density="compact"
            class="mb-4"
            hint="Tokens for rolling portion"
          />
        </template>

        <v-text-field
          v-model.number="form.backscrollTokens"
          label="Backscroll Tokens"
          type="number"
          variant="outlined"
          density="compact"
          class="mb-4"
          hint="Recent messages from current conversation"
        />

        <v-checkbox
          v-model="form.allowInterleavedParticipation"
          label="Allow interleaved participation"
          density="compact"
          hint="Allow overlapping logical time ranges"
          persistent-hint
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
          :loading="isCreating"
          @click="create"
        >
          Create
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { Model, CreatePersonaRequest } from '@deprecated-claude/shared';
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
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'create': [request: CreatePersonaRequest];
}>();

const contextStrategyOptions = [
  { title: 'Rolling Window', value: 'rolling' },
  { title: 'Anchored (Prefix + Rolling)', value: 'anchored' }
];

const form = ref<{
  name: string;
  modelId: string;
  contextStrategy: {
    type: 'rolling' | 'anchored';
    maxTokens?: number;
    prefixTokens?: number;
    rollingTokens?: number;
  };
  backscrollTokens: number;
  allowInterleavedParticipation: boolean;
}>({
  name: '',
  modelId: '',
  contextStrategy: {
    type: 'rolling',
    maxTokens: 60000
  },
  backscrollTokens: 30000,
  allowInterleavedParticipation: false
});

const isCreating = ref(false);

const isValid = computed(() => {
  return form.value.name.trim() !== '' && form.value.modelId !== '';
});

// Reset form when dialog opens
watch(() => props.modelValue, (open) => {
  if (open) {
    form.value = {
      name: '',
      modelId: '',
      contextStrategy: {
        type: 'rolling',
        maxTokens: 60000
      },
      backscrollTokens: 30000,
      allowInterleavedParticipation: false
    };
    isCreating.value = false;
  }
});

// Initialize anchored defaults when switching strategy types
watch(() => form.value.contextStrategy.type, (type) => {
  if (type === 'anchored') {
    form.value.contextStrategy = {
      type: 'anchored',
      prefixTokens: form.value.contextStrategy.prefixTokens ?? 10000,
      rollingTokens: form.value.contextStrategy.rollingTokens ?? 50000
    };
  } else {
    form.value.contextStrategy = {
      type: 'rolling',
      maxTokens: form.value.contextStrategy.maxTokens ?? 60000
    };
  }
});

function cancel() {
  emit('update:modelValue', false);
}

async function create() {
  if (!isValid.value) return;

  isCreating.value = true;

  const request: CreatePersonaRequest = {
    name: form.value.name.trim(),
    modelId: form.value.modelId,
    contextStrategy: form.value.contextStrategy.type === 'rolling'
      ? { type: 'rolling', maxTokens: form.value.contextStrategy.maxTokens ?? 60000 }
      : { type: 'anchored', prefixTokens: form.value.contextStrategy.prefixTokens ?? 10000, rollingTokens: form.value.contextStrategy.rollingTokens ?? 50000 },
    backscrollTokens: form.value.backscrollTokens,
    allowInterleavedParticipation: form.value.allowInterleavedParticipation
  };

  emit('create', request);
}
</script>
