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
          v-model="settings.model"
          :items="models"
          item-title="displayName"
          item-value="id"
          label="Model"
          variant="outlined"
          density="compact"
          class="mt-4"
        />
        
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
        
        <div v-if="selectedModel">
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
          <v-slider
            v-if="selectedModel.settings.topP"
            v-model="settings.settings.topP"
            :min="selectedModel.settings.topP.min"
            :max="selectedModel.settings.topP.max"
            :step="selectedModel.settings.topP.step"
            thumb-label
            color="primary"
            class="mt-4"
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
          
          <!-- Top K (if supported) -->
          <v-slider
            v-if="selectedModel.settings.topK"
            v-model="settings.settings.topK"
            :min="selectedModel.settings.topK.min"
            :max="selectedModel.settings.topK.max"
            :step="selectedModel.settings.topK.step"
            thumb-label
            color="primary"
            class="mt-4"
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
import type { Conversation, Model } from '@deprecated-claude/shared';

const props = defineProps<{
  modelValue: boolean;
  conversation: Conversation | null;
  models: Model[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  update: [updates: Partial<Conversation>];
}>();

const settings = ref<any>({
  title: '',
  model: '',
  systemPrompt: '',
  settings: {
    temperature: 0.7,
    maxTokens: 1024,
    topP: 0.9,
    topK: 40
  }
});

const selectedModel = computed(() => {
  return props.models.find(m => m.id === settings.value.model);
});

// Watch for conversation changes
watch(() => props.conversation, (conversation) => {
  if (conversation) {
    settings.value = {
      title: conversation.title,
      model: conversation.model,
      systemPrompt: conversation.systemPrompt || '',
      settings: { ...conversation.settings }
    };
  }
}, { immediate: true });

// Update settings when model changes
watch(() => settings.value.model, (modelId) => {
  const model = props.models.find(m => m.id === modelId);
  if (model) {
    settings.value.settings = {
      temperature: model.settings.temperature.default,
      maxTokens: model.settings.maxTokens.default,
      ...(model.settings.topP && { topP: model.settings.topP.default }),
      ...(model.settings.topK && { topK: model.settings.topK.default })
    };
  }
});

function resetToDefaults() {
  if (selectedModel.value) {
    settings.value.settings = {
      temperature: selectedModel.value.settings.temperature.default,
      maxTokens: selectedModel.value.settings.maxTokens.default,
      ...(selectedModel.value.settings.topP && { topP: selectedModel.value.settings.topP.default }),
      ...(selectedModel.value.settings.topK && { topK: selectedModel.value.settings.topK.default })
    };
  }
}

function cancel() {
  emit('update:modelValue', false);
}

function save() {
  emit('update', {
    title: settings.value.title,
    model: settings.value.model,
    systemPrompt: settings.value.systemPrompt || undefined,
    settings: settings.value.settings
  });
  emit('update:modelValue', false);
}
</script>
