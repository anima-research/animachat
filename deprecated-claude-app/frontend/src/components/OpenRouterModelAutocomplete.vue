<template>
  <div class="openrouter-autocomplete">
    <v-autocomplete
      :model-value="selectedModel"
      v-model:search="search"
      :items="filteredModels"
      :loading="loading"
      item-title="name"
      item-value="id"
      label="OpenRouter Model"
      placeholder="Start typing to search models..."
      variant="outlined"
      density="compact"
      :clearable="clearable"
      :disabled="disabled"
      no-filter
      return-object
      @update:model-value="onModelSelected"
    >
      <template v-slot:prepend-inner>
        <v-icon icon="mdi-cloud-search" size="small" color="primary" />
      </template>
      
      <template v-slot:item="{ props, item }">
        <v-list-item
          v-bind="props"
          :title="item.raw.name || item.raw.id"
          :subtitle="getModelSubtitle(item.raw)"
          class="model-item"
        >
          <template v-slot:append>
            <div class="model-info">
              <v-chip
                v-if="item.raw.context_length"
                size="x-small"
                variant="text"
                class="mr-1"
              >
                {{ formatContextLength(item.raw.context_length) }}
              </v-chip>
              <v-chip
                v-if="item.raw.pricing"
                size="x-small"
                variant="text"
                color="success"
              >
                {{ formatPricing(item.raw.pricing) }}
              </v-chip>
            </div>
          </template>
        </v-list-item>
      </template>
      
      <template v-slot:no-data>
        <v-list-item>
          <v-list-item-title class="text-center text-grey">
            <span v-if="loading">Loading models...</span>
            <span v-else-if="search">No models found matching "{{ search }}"</span>
            <span v-else>Start typing to search OpenRouter models</span>
          </v-list-item-title>
        </v-list-item>
      </template>
      
      <template v-slot:append-inner>
        <v-tooltip location="top" v-if="!loading && openRouterModels.length > 0">
          <template v-slot:activator="{ props }">
            <v-icon
              v-bind="props"
              icon="mdi-information-outline"
              size="small"
              color="info"
            />
          </template>
          {{ openRouterModels.length }} models available
        </v-tooltip>
      </template>
    </v-autocomplete>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import type { OpenRouterModel } from '@deprecated-claude/shared';
import { useStore } from '@/store';

const props = defineProps<{
  modelValue: OpenRouterModel | null;
  clearable?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: OpenRouterModel | null];
  'model-selected': [model: OpenRouterModel];
}>();

const store = useStore();
const search = ref('');
const loading = ref(false);
const selectedModel = ref<OpenRouterModel | null>(props.modelValue);

const openRouterModels = computed(() => store.state.openRouterModels);

// Filter models based on search (name and ID only, not description)
const filteredModels = computed(() => {
  if (!search.value) {
    // Show popular/featured models when no search
    return openRouterModels.value.slice(0, 20);
  }
  
  const searchLower = search.value.toLowerCase();
  return openRouterModels.value.filter(model => {
    const name = (model.name || model.id).toLowerCase();
    const id = model.id.toLowerCase();
    
    return name.includes(searchLower) || id.includes(searchLower);
  }).slice(0, 50); // Limit results for performance
});

// Load OpenRouter models on mount
onMounted(async () => {
  if (openRouterModels.value.length === 0) {
    loading.value = true;
    try {
      await store.loadOpenRouterModels();
    } finally {
      loading.value = false;
    }
  }
});

// Watch for external changes to modelValue
watch(() => props.modelValue, (newVal) => {
  selectedModel.value = newVal;
});

function onModelSelected(model: OpenRouterModel | null) {
  selectedModel.value = model;
  emit('update:modelValue', model);
  if (model) {
    emit('model-selected', model);
  }
}

function getModelSubtitle(model: OpenRouterModel): string {
  const parts: string[] = [];
  
  if (model.architecture?.modality) {
    parts.push(model.architecture.modality);
  }
  
  if (model.description && model.description.length > 0) {
    const shortDesc = model.description.slice(0, 60);
    parts.push(shortDesc + (model.description.length > 60 ? '...' : ''));
  }
  
  return parts.join(' • ');
}

function formatContextLength(length: number): string {
  if (length >= 1000000) {
    return `${(length / 1000000).toFixed(1)}M`;
  }
  if (length >= 1000) {
    return `${(length / 1000).toFixed(0)}K`;
  }
  return length.toString();
}

function formatPricing(pricing: { prompt?: string | number; completion?: string | number }): string {
  const prompt = typeof pricing.prompt === 'number' ? pricing.prompt : parseFloat(pricing.prompt || '0');
  const completion = typeof pricing.completion === 'number' ? pricing.completion : parseFloat(pricing.completion || '0');
  
  // Convert to $/1M tokens if the numbers are very small (assuming they're per token)
  const promptPer1M = prompt < 0.01 ? (prompt * 1000000) : prompt;
  const completionPer1M = completion < 0.01 ? (completion * 1000000) : completion;
  
  return `$${promptPer1M.toFixed(2)}/$${completionPer1M.toFixed(2)}`;
}
</script>

<style scoped>
.openrouter-autocomplete {
  width: 100%;
}

.model-item {
  padding: 8px 0;
}

.model-info {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.selected-model-card {
  border-left: 3px solid rgb(var(--v-theme-primary));
}

.model-stats {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
}

:deep(.v-autocomplete .v-field__input) {
  cursor: text;
}
</style>

