<template>
  <v-card-text style="max-height: 600px; overflow-y: auto; padding: 24px;">
    <div class="text-body-2 mb-4">
      Add your own models from OpenRouter or connect to custom OpenAI-compatible endpoints (Ollama, LM Studio, vLLM, etc.).
      Your custom models will appear alongside system models in the model selector.
    </div>
    
    <v-list density="compact">
      <v-list-item
        v-for="model in customModels"
        :key="model.id"
        :title="model.displayName"
        :subtitle="`${model.provider} • ${formatContextWindow(model.contextWindow)} ctx • ${formatTokens(model.outputTokenLimit)} max`"
      >
        <template v-slot:prepend>
          <v-avatar :color="getProviderColor(model.provider)" size="32">
            <v-icon :icon="getProviderIcon(model.provider)" size="18" />
          </v-avatar>
        </template>
        
        <template v-slot:append>
          <v-btn
            icon="mdi-lan-connect"
            variant="text"
            size="small"
            :loading="testingModelId === model.id"
            :color="getTestResultColor(model.id)"
            @click="testModel(model)"
            title="Test Connection"
          />
          <v-btn
            icon="mdi-pencil"
            variant="text"
            size="small"
            @click="openEditDialog(model)"
          />
          <v-btn
            icon="mdi-delete"
            variant="text"
            size="small"
            color="error"
            @click="confirmDelete(model)"
          />
        </template>
      </v-list-item>
      
      <v-list-item v-if="customModels.length === 0">
        <v-list-item-title class="text-grey">
          No custom models configured
        </v-list-item-title>
      </v-list-item>
    </v-list>
    
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-3">
      {{ error }}
    </v-alert>
    
    <v-divider class="my-4" />
    
    <h4 class="text-h6 mb-2">{{ editingModel ? 'Edit Custom Model' : 'Add Custom Model' }}</h4>
    
    <!-- Provider Selection -->
    <v-select
      v-model="selectedProvider"
      :items="providers"
      label="Provider"
      variant="outlined"
      density="compact"
      class="mb-3"
    />
    
    <!-- OpenRouter Fields -->
    <template v-if="selectedProvider === 'openrouter'">
      <OpenRouterModelAutocomplete
        v-model="selectedORModel"
        @model-selected="onOpenRouterModelSelected"
        :clearable="true"
        class="mb-3"
      />
    </template>
    
    <!-- Common Fields -->
    <v-text-field
      v-model="formData.displayName"
      label="Display Name"
      variant="outlined"
      density="compact"
      placeholder="e.g., Claude 3 Opus"
      class="mb-2"
    />
    
    <v-text-field
      v-model="formData.shortName"
      label="Short Name"
      variant="outlined"
      density="compact"
      placeholder="e.g., Opus 3"
      class="mb-2"
    />
    
    <v-text-field
      v-model="formData.providerModelId"
      label="Provider Model ID"
      variant="outlined"
      density="compact"
      :placeholder="selectedProvider === 'openrouter' ? 'e.g., anthropic/claude-3-opus' : 'e.g., llama3'"
      :readonly="selectedProvider === 'openrouter' && !!selectedORModel"
      class="mb-2"
    />
    
    <!-- OpenAI-compatible specific fields -->
    <template v-if="selectedProvider === 'openai-compatible'">
      <v-text-field
        v-model="customEndpointData.baseUrl"
        label="Base URL"
        variant="outlined"
        density="compact"
        placeholder="http://localhost:11434"
        class="mb-2"
      />
      
      <v-text-field
        v-model="customEndpointData.apiKey"
        label="API Key (optional)"
        variant="outlined"
        density="compact"
        type="password"
        placeholder="Leave empty if not required"
        class="mb-2"
      />
    </template>
    
    <!-- Model Specifications -->
    <v-row dense class="mb-2">
      <v-col cols="6">
        <v-text-field
          v-model.number="formData.contextWindow"
          label="Context Window"
          variant="outlined"
          density="compact"
          type="number"
          suffix="tokens"
          hide-details
        />
      </v-col>
      <v-col cols="6">
        <v-text-field
          v-model.number="formData.outputTokenLimit"
          label="Max Output"
          variant="outlined"
          density="compact"
          type="number"
          suffix="tokens"
          hide-details
        />
      </v-col>
    </v-row>
    
    <v-checkbox
      v-model="formData.supportsThinking"
      label="Supports Extended Thinking"
      density="compact"
      hide-details
      class="mb-3"
    />
    
    <v-btn
      color="primary"
      variant="elevated"
      block
      @click="saveModel"
      :loading="loading"
      :disabled="!isFormValid"
    >
      {{ editingModel ? 'Update Model' : 'Add Model' }}
    </v-btn>
    
    <v-btn
      v-if="editingModel"
      variant="text"
      block
      @click="cancelEdit"
      :disabled="loading"
      class="mt-2"
    >
      Cancel Edit
    </v-btn>
    
    <!-- Delete Confirmation Dialog -->
    <v-dialog
      v-model="showDeleteDialog"
      max-width="400"
    >
      <v-card>
        <v-card-title>Delete Custom Model?</v-card-title>
        <v-card-text>
          Are you sure you want to delete <strong>{{ modelToDelete?.displayName }}</strong>?
          This action cannot be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showDeleteDialog = false">Cancel</v-btn>
          <v-btn color="error" variant="elevated" @click="deleteModel" :loading="loading">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card-text>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useStore } from '@/store';
import type { UserDefinedModel, CreateUserModel, OpenRouterModel } from '@deprecated-claude/shared';
import OpenRouterModelAutocomplete from './OpenRouterModelAutocomplete.vue';

const store = useStore();
const customModels = computed(() => store.state.customModels);

const providers = [
  { title: 'OpenRouter', value: 'openrouter' },
  { title: 'OpenAI-compatible', value: 'openai-compatible' }
];

const showDeleteDialog = ref(false);
const editingModel = ref<UserDefinedModel | null>(null);
const modelToDelete = ref<UserDefinedModel | null>(null);
const selectedProvider = ref<'openrouter' | 'openai-compatible'>('openrouter');
const selectedORModel = ref<OpenRouterModel | null>(null);
const loading = ref(false);
const error = ref('');
const testingModelId = ref<string | null>(null);
const testResults = ref<Map<string, { success: boolean; message?: string; error?: string }>>(new Map());

const formData = ref({
  displayName: '',
  shortName: '',
  provider: 'openrouter' as 'openrouter' | 'openai-compatible',
  providerModelId: '',
  contextWindow: 100000,
  outputTokenLimit: 4096,
  supportsThinking: false
});

const customEndpointData = ref({
  baseUrl: '',
  apiKey: ''
});

const isFormValid = computed(() => {
  if (!formData.value.displayName || !formData.value.shortName || !formData.value.providerModelId) {
    return false;
  }
  
  if (formData.value.contextWindow < 1000 || formData.value.outputTokenLimit < 100) {
    return false;
  }
  
  if (selectedProvider.value === 'openai-compatible') {
    if (!customEndpointData.value.baseUrl) {
      return false;
    }
    try {
      new URL(customEndpointData.value.baseUrl);
    } catch {
      return false;
    }
  }
  
  return true;
});

watch(selectedProvider, (newProvider) => {
  formData.value.provider = newProvider;
  // Clear form when switching providers
  if (!editingModel.value) {
    resetForm();
    selectedProvider.value = newProvider; // Keep the selection
  }
});

function openEditDialog(model: UserDefinedModel) {
  editingModel.value = model;
  formData.value = {
    displayName: model.displayName,
    shortName: model.shortName,
    provider: model.provider,
    providerModelId: model.providerModelId,
    contextWindow: model.contextWindow,
    outputTokenLimit: model.outputTokenLimit,
    supportsThinking: model.supportsThinking || false
  };
  
  selectedProvider.value = model.provider;
  
  if (model.customEndpoint) {
    customEndpointData.value = {
      baseUrl: model.customEndpoint.baseUrl,
      apiKey: model.customEndpoint.apiKey || ''
    };
  }
}

function cancelEdit() {
  editingModel.value = null;
  resetForm();
  error.value = '';
}

function resetForm() {
  formData.value = {
    displayName: '',
    shortName: '',
    provider: selectedProvider.value,
    providerModelId: '',
    contextWindow: 100000,
    outputTokenLimit: 4096,
    supportsThinking: false
  };
  
  customEndpointData.value = {
    baseUrl: '',
    apiKey: ''
  };
  
  selectedORModel.value = null;
}

function onOpenRouterModelSelected(model: OpenRouterModel) {
  formData.value.displayName = model.name || model.id;
  formData.value.shortName = extractShortName(model.name || model.id);
  formData.value.providerModelId = model.id;
  formData.value.contextWindow = model.context_length || 100000;
  formData.value.outputTokenLimit = model.top_provider?.max_completion_tokens || 4096;
}

function extractShortName(name: string): string {
  const parts = name.split(' ');
  if (parts.length <= 2) return name;
  return parts.slice(0, 2).join(' ');
}

async function saveModel() {
  loading.value = true;
  error.value = '';
  
  try {
    const modelData: CreateUserModel = {
      ...formData.value,
      provider: selectedProvider.value,
      customEndpoint: selectedProvider.value === 'openai-compatible' 
        ? {
            baseUrl: customEndpointData.value.baseUrl,
            apiKey: customEndpointData.value.apiKey || undefined
          }
        : undefined
    };
    
    if (editingModel.value) {
      await store.updateCustomModel(editingModel.value.id, modelData);
    } else {
      await store.createCustomModel(modelData);
    }
    
    cancelEdit();
  } catch (err: any) {
    error.value = err.message || 'Failed to save model';
  } finally {
    loading.value = false;
  }
}

function confirmDelete(model: UserDefinedModel) {
  modelToDelete.value = model;
  showDeleteDialog.value = true;
}

async function deleteModel() {
  if (!modelToDelete.value) return;
  
  loading.value = true;
  try {
    await store.deleteCustomModel(modelToDelete.value.id);
    showDeleteDialog.value = false;
    modelToDelete.value = null;
  } catch (err: any) {
    error.value = err.message || 'Failed to delete model';
  } finally {
    loading.value = false;
  }
}

function getProviderColor(provider: string): string {
  const colors: Record<string, string> = {
    'openrouter': 'purple',
    'openai-compatible': 'blue'
  };
  return colors[provider] || 'grey';
}

function getProviderIcon(provider: string): string {
  const icons: Record<string, string> = {
    'openrouter': 'mdi-router-wireless',
    'openai-compatible': 'mdi-api'
  };
  return icons[provider] || 'mdi-cube';
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
  return tokens.toString();
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
  return tokens.toString();
}

async function testModel(model: UserDefinedModel) {
  testingModelId.value = model.id;
  error.value = '';
  
  try {
    const result = await store.testCustomModel(model.id);
    testResults.value.set(model.id, result);
    
    if (result.success) {
      console.log(`✅ Test successful for ${model.displayName}:`, result.response);
    } else {
      console.error(`❌ Test failed for ${model.displayName}:`, result.error);
      error.value = result.error || 'Test failed';
    }
    
    // Clear result after 5 seconds
    setTimeout(() => {
      testResults.value.delete(model.id);
    }, 5000);
  } catch (err: any) {
    error.value = err.message || 'Failed to test model';
  } finally {
    testingModelId.value = null;
  }
}

function getTestResultColor(modelId: string): string | undefined {
  const result = testResults.value.get(modelId);
  if (!result) return undefined;
  return result.success ? 'success' : 'error';
}

onMounted(async () => {
  loading.value = true;
  try {
    await store.loadCustomModels();
    console.log('Loaded custom models:', customModels.value);
  } finally {
    loading.value = false;
  }
});
</script>

