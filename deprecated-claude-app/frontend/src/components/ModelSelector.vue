<template>
  <v-autocomplete
    :model-value="modelValue"
    v-model:search="search"
    :items="filteredModels"
    :item-title="getItemTitle"
    item-value="id"
    :label="label"
    :placeholder="placeholder"
    :variant="variant"
    :density="density"
    :hide-details="hideDetails"
    :disabled="disabled"
    :clearable="clearable"
    no-filter
    @update:model-value="onModelSelected"
    @update:search="onSearchUpdate"
  >
    <template v-slot:prepend-inner v-if="showIcon">
      <v-icon icon="mdi-robot" size="small" :color="selectedModelColor" />
    </template>
    
    <template v-slot:selection="{ item }">
      <span :style="`color: ${getModelColor(item.raw.id)}; font-weight: 500;`">
        {{ item.raw.displayName }}
      </span>
    </template>
    
    <template v-slot:item="{ props, item }">
      <v-list-item
        v-bind="props"
        :subtitle="getModelSubtitle(item.raw)"
        class="model-item"
      >
        <template v-slot:title>
          <div class="d-flex align-center">
            <span :style="`color: ${getModelColor(item.raw.id)}; font-weight: 500;`">
              {{ item.raw.displayName }}
            </span>
            <v-chip
              v-if="item.raw.supportsThinking"
              size="x-small"
              variant="tonal"
              color="primary"
              class="ml-2"
            >
              thinking
            </v-chip>
            <v-chip
              v-if="item.raw.deprecated"
              size="x-small"
              variant="outlined"
              color="warning"
              class="ml-2"
            >
              deprecated
            </v-chip>
          </div>
        </template>
        <template v-slot:append>
          <div class="model-info">
            <v-chip
              v-if="item.raw.contextWindow"
              size="x-small"
              variant="text"
            >
              {{ formatContextLength(item.raw.contextWindow) }}
            </v-chip>
          </div>
        </template>
      </v-list-item>
    </template>
    
    <template v-slot:prepend-item v-if="showProviderFilter && providers.length > 1">
      <div class="provider-filter px-3 py-2">
        <v-chip-group
          v-model="selectedProvider"
          selected-class="bg-primary"
        >
          <v-chip
            size="small"
            variant="outlined"
            :value="null"
          >
            All
          </v-chip>
          <v-chip
            v-for="provider in providers"
            :key="provider"
            size="small"
            variant="outlined"
            :value="provider"
          >
            {{ formatProvider(provider) }}
          </v-chip>
        </v-chip-group>
      </div>
      <v-divider />
    </template>
    
    <template v-slot:no-data>
      <v-list-item>
        <v-list-item-title class="text-center text-grey">
          <span v-if="search">No models found matching "{{ search }}"</span>
          <span v-else>No models available</span>
        </v-list-item-title>
      </v-list-item>
    </template>
  </v-autocomplete>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { Model } from '@deprecated-claude/shared';
import { getModelColor } from '@/utils/modelColors';

const props = withDefaults(defineProps<{
  modelValue: string | null;
  models: Model[];
  label?: string;
  placeholder?: string;
  variant?: 'outlined' | 'filled' | 'underlined' | 'solo' | 'solo-inverted' | 'solo-filled' | 'plain';
  density?: 'default' | 'comfortable' | 'compact';
  hideDetails?: boolean;
  disabled?: boolean;
  clearable?: boolean;
  showIcon?: boolean;
  showProviderFilter?: boolean;
  excludeDeprecated?: boolean;
}>(), {
  label: 'Model',
  placeholder: 'Search models...',
  variant: 'outlined',
  density: 'compact',
  hideDetails: false,
  disabled: false,
  clearable: false,
  showIcon: true,
  showProviderFilter: true,
  excludeDeprecated: true
});

const emit = defineEmits<{
  'update:modelValue': [value: string | null];
  'model-selected': [model: Model];
}>();

const search = ref('');
const selectedProvider = ref<string | null>(null);

// Get unique providers from models
const providers = computed(() => {
  const providerSet = new Set(
    props.models
      .filter(m => !props.excludeDeprecated || !m.deprecated)
      .map(m => m.provider)
  );
  return Array.from(providerSet).sort();
});

// Filter models based on search and provider
const filteredModels = computed(() => {
  let models = props.models;
  
  // Exclude deprecated if configured
  if (props.excludeDeprecated) {
    models = models.filter(m => !m.deprecated);
  }
  
  // Filter by provider
  if (selectedProvider.value) {
    models = models.filter(m => m.provider === selectedProvider.value);
  }
  
  // Filter by search term
  if (search.value) {
    const searchLower = search.value.toLowerCase();
    models = models.filter(model => {
      const displayName = model.displayName.toLowerCase();
      const shortName = model.shortName?.toLowerCase() || '';
      const id = model.id.toLowerCase();
      const provider = model.provider.toLowerCase();
      
      return displayName.includes(searchLower) || 
             shortName.includes(searchLower) || 
             id.includes(searchLower) ||
             provider.includes(searchLower);
    });
  }
  
  return models;
});

// Get the selected model's color
const selectedModelColor = computed(() => {
  if (!props.modelValue) return 'grey';
  return getModelColor(props.modelValue);
});

function getItemTitle(item: Model): string {
  return item.displayName;
}

function getModelSubtitle(model: Model): string {
  const parts: string[] = [];
  
  parts.push(formatProvider(model.provider));
  
  if (model.shortName && model.shortName !== model.displayName) {
    parts.push(model.shortName);
  }
  
  return parts.join(' • ');
}

function formatContextLength(length: number): string {
  if (length >= 1000000) {
    return `${(length / 1000000).toFixed(1)}M ctx`;
  }
  if (length >= 1000) {
    return `${Math.floor(length / 1000)}K ctx`;
  }
  return `${length} ctx`;
}

function formatProvider(provider: string): string {
  const providerNames: Record<string, string> = {
    'anthropic': 'Anthropic',
    'bedrock': 'AWS Bedrock',
    'openrouter': 'OpenRouter',
    'openai-compatible': 'OpenAI Compatible'
  };
  return providerNames[provider] || provider;
}

function onModelSelected(modelId: string | null) {
  emit('update:modelValue', modelId);
  if (modelId) {
    const model = props.models.find(m => m.id === modelId);
    if (model) {
      emit('model-selected', model);
    }
  }
}

function onSearchUpdate(value: string) {
  search.value = value;
}

// Watch for external changes to clear search
watch(() => props.modelValue, () => {
  search.value = '';
});
</script>

<style scoped>
.model-item {
  padding: 8px 0;
}

.model-info {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.provider-filter {
  background: rgba(var(--v-theme-surface-variant), 0.3);
}

:deep(.v-autocomplete .v-field__input) {
  cursor: text;
}

:deep(.v-chip-group) {
  flex-wrap: wrap;
}
</style>

