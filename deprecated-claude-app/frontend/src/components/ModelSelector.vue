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
        :class="{ 'model-unavailable': availability && getAvailabilityStatus(item.raw) === 'unavailable' }"
      >
        <template v-slot:prepend>
          <!-- Availability indicator icon -->
          <v-icon
            v-if="availability && getAvailabilityStatus(item.raw) === 'user-key'"
            icon="mdi-key"
            size="16"
            color="success"
            class="mr-2"
            title="You have an API key configured"
          />
          <v-icon
            v-else-if="availability && getAvailabilityStatus(item.raw) === 'subsidized'"
            icon="mdi-check-circle"
            size="16"
            color="info"
            class="mr-2"
            title="Available (subsidized)"
          />
          <v-icon
            v-else-if="availability && getAvailabilityStatus(item.raw) === 'unavailable'"
            icon="mdi-key-remove"
            size="16"
            color="grey"
            class="mr-2"
            title="No API key configured"
          />
        </template>
        <template v-slot:title>
          <div class="d-flex align-center">
            <span 
              :style="`color: ${getModelColor(item.raw.id)}; font-weight: 500;`"
              :class="{ 'text-grey': availability && getAvailabilityStatus(item.raw) === 'unavailable' }"
            >
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
              v-if="item.raw.hidden"
              size="x-small"
              variant="outlined"
              color="warning"
              class="ml-2"
            >
              hidden
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

// Model availability info
interface ModelAvailability {
  userProviders: string[];
  adminProviders: string[];
  grantCurrencies: string[];
  canOverspend: boolean;
  availableProviders: string[];
}

const props = withDefaults(defineProps<{
  modelValue: string | null;
  models: Model[];
  availability?: ModelAvailability | null;
  label?: string;
  placeholder?: string;
  variant?: 'outlined' | 'filled' | 'underlined' | 'solo' | 'solo-inverted' | 'solo-filled' | 'plain';
  density?: 'default' | 'comfortable' | 'compact';
  hideDetails?: boolean;
  disabled?: boolean;
  clearable?: boolean;
  showIcon?: boolean;
  showProviderFilter?: boolean;
  excludeHidden?: boolean;
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
  excludeHidden: true,
  availability: null
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
      .filter(m => !props.excludeHidden || !m.hidden)
      .map(m => m.provider)
  );
  return Array.from(providerSet).sort();
});

// Filter models based on search and provider
const filteredModels = computed(() => {
  let models = props.models;
  
  // Exclude hidden if configured
  if (props.excludeHidden) {
    models = models.filter(m => !m.hidden);
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
    'openai-compatible': 'OpenAI Compatible',
    'google': 'Google'
  };
  return providerNames[provider] || provider;
}

// Check if user has their own API key for this model's provider
function hasUserKey(model: Model): boolean {
  if (!props.availability) return false;
  return props.availability.userProviders.includes(model.provider);
}

// Check if there's an admin-configured (subsidized) key for this model's provider
function hasAdminKey(model: Model): boolean {
  if (!props.availability) return false;
  return props.availability.adminProviders.includes(model.provider);
}

// Check if the model is available (either user key, admin key, or can overspend)
function isModelAvailable(model: Model): boolean {
  if (!props.availability) return true; // Default to available if no info
  return hasUserKey(model) || hasAdminKey(model) || props.availability.canOverspend;
}

// Get availability status for display
function getAvailabilityStatus(model: Model): 'user-key' | 'subsidized' | 'unavailable' | null {
  if (!props.availability) return null;
  if (hasUserKey(model)) return 'user-key';
  if (hasAdminKey(model)) return 'subsidized';
  if (props.availability.canOverspend) return 'subsidized'; // Treat overspend as subsidized
  return 'unavailable';
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

.model-item.model-unavailable {
  opacity: 0.6;
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

.text-grey {
  color: rgba(var(--v-theme-on-surface), 0.5) !important;
}
</style>

