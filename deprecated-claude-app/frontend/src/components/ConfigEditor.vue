<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      <v-icon class="mr-2">mdi-cog</v-icon>
      System Configuration
      <v-spacer />
      <v-btn 
        variant="outlined" 
        size="small" 
        @click="reloadConfig"
        :loading="reloading"
      >
        <v-icon start size="small">mdi-refresh</v-icon>
        Reload from Disk
      </v-btn>
    </v-card-title>
    
    <v-divider />
    
    <v-card-text v-if="loading" class="text-center py-8">
      <v-progress-circular indeterminate color="primary" />
      <p class="mt-2">Loading configuration...</p>
    </v-card-text>
    
    <v-card-text v-else-if="error" class="text-center py-8">
      <v-icon size="48" color="error" class="mb-2">mdi-alert-circle</v-icon>
      <p class="text-error">{{ error }}</p>
      <v-btn @click="fetchConfig" variant="outlined" class="mt-2">Retry</v-btn>
    </v-card-text>
    
    <v-card-text v-else>
      <v-expansion-panels v-model="openPanel">
        <!-- Default Model -->
        <v-expansion-panel value="default-model">
          <v-expansion-panel-title>
            <v-icon class="mr-2">mdi-star</v-icon>
            Default Model
            <v-chip size="small" class="ml-2" color="primary" variant="tonal">
              {{ config.defaultModel || 'Not set' }}
            </v-chip>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-autocomplete
              v-model="config.defaultModel"
              :items="availableModels"
              item-title="displayName"
              item-value="id"
              label="Default model for new conversations"
              density="compact"
              variant="outlined"
              :loading="savingDefaultModel"
            />
            <v-btn 
              color="primary" 
              @click="saveDefaultModel"
              :loading="savingDefaultModel"
              :disabled="!config.defaultModel"
            >
              Save
            </v-btn>
          </v-expansion-panel-text>
        </v-expansion-panel>

        <!-- Initial Grants -->
        <v-expansion-panel value="initial-grants">
          <v-expansion-panel-title>
            <v-icon class="mr-2">mdi-gift</v-icon>
            Initial Grants (New Users)
            <v-chip size="small" class="ml-2" color="success" variant="tonal">
              {{ Object.keys(config.initialGrants || {}).length }} currencies
            </v-chip>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <p class="text-body-2 text-grey mb-4">
              Credits automatically granted to new users on registration.
            </p>
            <v-row v-for="(amount, currency) in config.initialGrants" :key="currency" class="mb-2">
              <v-col cols="5">
                <v-text-field
                  :model-value="currency"
                  readonly
                  density="compact"
                  variant="outlined"
                  label="Currency"
                />
              </v-col>
              <v-col cols="5">
                <v-text-field
                  v-model.number="config.initialGrants[currency]"
                  type="number"
                  density="compact"
                  variant="outlined"
                  label="Amount"
                />
              </v-col>
              <v-col cols="2">
                <v-btn 
                  icon="mdi-delete" 
                  variant="text" 
                  color="error"
                  @click="removeInitialGrant(currency)"
                />
              </v-col>
            </v-row>
            <v-row class="mb-2">
              <v-col cols="5">
                <v-select
                  v-model="newGrantCurrency"
                  :items="availableCurrencies"
                  density="compact"
                  variant="outlined"
                  label="Add currency"
                />
              </v-col>
              <v-col cols="5">
                <v-text-field
                  v-model.number="newGrantAmount"
                  type="number"
                  density="compact"
                  variant="outlined"
                  label="Amount"
                />
              </v-col>
              <v-col cols="2">
                <v-btn 
                  icon="mdi-plus" 
                  variant="text" 
                  color="success"
                  @click="addInitialGrant"
                  :disabled="!newGrantCurrency || !newGrantAmount"
                />
              </v-col>
            </v-row>
            <v-btn 
              color="primary" 
              @click="saveInitialGrants"
              :loading="savingInitialGrants"
              class="mt-2"
            >
              Save Initial Grants
            </v-btn>
          </v-expansion-panel-text>
        </v-expansion-panel>

        <!-- Group Chat Suggested Models -->
        <v-expansion-panel value="suggested-models">
          <v-expansion-panel-title>
            <v-icon class="mr-2">mdi-account-group</v-icon>
            Group Chat Suggested Models
            <v-chip size="small" class="ml-2" color="info" variant="tonal">
              {{ (config.groupChatSuggestedModels || []).length }} models
            </v-chip>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <p class="text-body-2 text-grey mb-4">
              Models shown in the quick-access bar for group chats.
            </p>
            <v-chip-group column>
              <v-chip
                v-for="modelId in config.groupChatSuggestedModels"
                :key="modelId"
                closable
                @click:close="removeSuggestedModel(modelId)"
              >
                {{ getModelDisplayName(modelId) }}
              </v-chip>
            </v-chip-group>
            <v-autocomplete
              v-model="newSuggestedModel"
              :items="availableModels"
              item-title="displayName"
              item-value="id"
              label="Add model"
              density="compact"
              variant="outlined"
              class="mt-4"
              clearable
              @update:model-value="addSuggestedModel"
            />
            <v-btn 
              color="primary" 
              @click="saveSuggestedModels"
              :loading="savingSuggestedModels"
              class="mt-2"
            >
              Save Suggested Models
            </v-btn>
          </v-expansion-panel-text>
        </v-expansion-panel>

        <!-- Model Costs (per provider) -->
        <v-expansion-panel 
          v-for="(profiles, provider) in config.providers" 
          :key="provider"
          :value="`provider-${provider}`"
        >
          <v-expansion-panel-title>
            <v-icon class="mr-2">{{ getProviderIcon(provider) }}</v-icon>
            {{ provider.toUpperCase() }} Model Costs
            <v-chip size="small" class="ml-2" color="warning" variant="tonal">
              {{ getTotalModelCosts(profiles) }} models configured
            </v-chip>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <div v-for="profile in profiles" :key="profile.id" class="mb-6">
              <h4 class="text-subtitle-1 font-weight-medium mb-2">
                {{ profile.name }}
                <v-chip size="x-small" class="ml-2">{{ profile.id }}</v-chip>
              </h4>
              
              <v-table density="compact" class="model-costs-table">
                <thead>
                  <tr>
                    <th style="width: 50px;">Visible</th>
                    <th style="min-width: 320px;">Model ID</th>
                    <th style="width: 70px;">In $/M</th>
                    <th style="width: 70px;">Out $/M</th>
                    <th style="width: 70px;">Bill In</th>
                    <th style="width: 70px;">Bill Out</th>
                    <th style="width: 40px;"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(cost, idx) in profile.modelCosts" :key="idx">
                    <td>
                      <v-checkbox
                        :model-value="!isModelHidden(cost.modelId)"
                        @update:model-value="toggleModelVisibility(cost.modelId, $event)"
                        hide-details
                        density="compact"
                      />
                    </td>
                    <td>
                      <v-text-field
                        v-model="cost.modelId"
                        density="compact"
                        variant="plain"
                        hide-details
                        class="model-id-field"
                      />
                    </td>
                    <td>
                      <v-text-field
                        v-model.number="cost.providerCost.inputTokensPerMillion"
                        type="number"
                        step="0.01"
                        density="compact"
                        variant="plain"
                        hide-details
                        class="cost-field"
                      />
                    </td>
                    <td>
                      <v-text-field
                        v-model.number="cost.providerCost.outputTokensPerMillion"
                        type="number"
                        step="0.01"
                        density="compact"
                        variant="plain"
                        hide-details
                        class="cost-field"
                      />
                    </td>
                    <td>
                      <v-text-field
                        v-model.number="cost.billedCost.inputTokensPerMillion"
                        type="number"
                        step="0.01"
                        density="compact"
                        variant="plain"
                        hide-details
                        class="cost-field"
                      />
                    </td>
                    <td>
                      <v-text-field
                        v-model.number="cost.billedCost.outputTokensPerMillion"
                        type="number"
                        step="0.01"
                        density="compact"
                        variant="plain"
                        hide-details
                        class="cost-field"
                      />
                    </td>
                    <td>
                      <v-btn 
                        icon="mdi-delete" 
                        variant="text" 
                        size="x-small"
                        color="error"
                        @click="removeModelCost(provider, profile.id, idx)"
                      />
                    </td>
                  </tr>
                </tbody>
              </v-table>
              
              <div class="d-flex align-center mt-2" style="gap: 8px;">
                <v-autocomplete
                  v-model="newModelCostId[`${provider}-${profile.id}`]"
                  :items="availableModels.filter(m => m.provider === provider)"
                  item-title="displayName"
                  item-value="providerModelId"
                  label="Add model by provider ID"
                  density="compact"
                  variant="outlined"
                  hide-details
                  style="max-width: 300px;"
                  clearable
                />
                <v-btn 
                  icon="mdi-plus" 
                  variant="tonal" 
                  size="small"
                  color="success"
                  @click="addModelCost(provider, profile.id)"
                  :disabled="!newModelCostId[`${provider}-${profile.id}`]"
                />
              </div>
              
              <v-btn 
                color="primary" 
                @click="saveModelCosts(provider, profile.id, profile.modelCosts)"
                :loading="savingModelCosts[`${provider}-${profile.id}`]"
                class="mt-4"
              >
                Save {{ profile.name }} Costs
              </v-btn>
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-card-text>
    
    <!-- Success/Error Snackbar -->
    <v-snackbar v-model="showSnackbar" :color="snackbarColor" timeout="3000">
      {{ snackbarMessage }}
    </v-snackbar>
  </v-card>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { api } from '@/services/api';

interface ModelCost {
  modelId: string;
  providerCost: {
    inputTokensPerMillion: number;
    outputTokensPerMillion: number;
  };
  billedCost: {
    inputTokensPerMillion: number;
    outputTokensPerMillion: number;
  };
}

interface ProviderProfile {
  id: string;
  name: string;
  description?: string;
  priority: number;
  modelCosts: ModelCost[];
}

interface ConfigData {
  providers: Record<string, ProviderProfile[]>;
  defaultModel: string;
  groupChatSuggestedModels: string[];
  initialGrants: Record<string, number>;
  currencies: Record<string, { name: string; description: string }>;
}

interface ModelInfo {
  id: string;
  providerModelId: string;
  displayName: string;
  provider: string;
  hidden: boolean;
}

const loading = ref(true);
const reloading = ref(false);
const error = ref<string | null>(null);
const config = reactive<ConfigData>({
  providers: {},
  defaultModel: '',
  groupChatSuggestedModels: [],
  initialGrants: {},
  currencies: {}
});
const availableModels = ref<ModelInfo[]>([]);
const openPanel = ref<string | null>(null);

// Snackbar
const showSnackbar = ref(false);
const snackbarMessage = ref('');
const snackbarColor = ref('success');

// Saving states
const savingDefaultModel = ref(false);
const savingInitialGrants = ref(false);
const savingSuggestedModels = ref(false);
const savingModelCosts = reactive<Record<string, boolean>>({});

// New item inputs
const newGrantCurrency = ref('');
const newGrantAmount = ref(0);
const newSuggestedModel = ref('');
const newModelCostId = reactive<Record<string, string>>({});

const availableCurrencies = ['credit', 'old_sonnets', 'claude3opus', 'haiku', 'gemini', 'gemini-pro', 'openai', 'models-2025'];

function showSuccess(message: string) {
  snackbarMessage.value = message;
  snackbarColor.value = 'success';
  showSnackbar.value = true;
}

function showError(message: string) {
  snackbarMessage.value = message;
  snackbarColor.value = 'error';
  showSnackbar.value = true;
}

async function fetchConfig() {
  loading.value = true;
  error.value = null;
  
  try {
    const [configRes, modelsRes] = await Promise.all([
      api.get('/admin/config'),
      api.get('/admin/models')
    ]);
    
    Object.assign(config, configRes.data);
    availableModels.value = modelsRes.data.models;
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Failed to load configuration';
  } finally {
    loading.value = false;
  }
}

async function reloadConfig() {
  reloading.value = true;
  try {
    await api.post('/admin/config/reload');
    await fetchConfig();
    showSuccess('Configuration reloaded from disk');
  } catch (e: any) {
    showError(e?.response?.data?.error || 'Failed to reload config');
  } finally {
    reloading.value = false;
  }
}

async function saveDefaultModel() {
  savingDefaultModel.value = true;
  try {
    await api.patch('/admin/config', { defaultModel: config.defaultModel });
    showSuccess('Default model saved');
  } catch (e: any) {
    showError(e?.response?.data?.error || 'Failed to save default model');
  } finally {
    savingDefaultModel.value = false;
  }
}

async function saveInitialGrants() {
  savingInitialGrants.value = true;
  try {
    await api.patch('/admin/config', { initialGrants: config.initialGrants });
    showSuccess('Initial grants saved');
  } catch (e: any) {
    showError(e?.response?.data?.error || 'Failed to save initial grants');
  } finally {
    savingInitialGrants.value = false;
  }
}

function addInitialGrant() {
  if (newGrantCurrency.value && newGrantAmount.value > 0) {
    config.initialGrants[newGrantCurrency.value] = newGrantAmount.value;
    newGrantCurrency.value = '';
    newGrantAmount.value = 0;
  }
}

function removeInitialGrant(currency: string) {
  delete config.initialGrants[currency];
}

async function saveSuggestedModels() {
  savingSuggestedModels.value = true;
  try {
    await api.patch('/admin/config', { groupChatSuggestedModels: config.groupChatSuggestedModels });
    showSuccess('Suggested models saved');
  } catch (e: any) {
    showError(e?.response?.data?.error || 'Failed to save suggested models');
  } finally {
    savingSuggestedModels.value = false;
  }
}

function addSuggestedModel() {
  if (newSuggestedModel.value && !config.groupChatSuggestedModels.includes(newSuggestedModel.value)) {
    config.groupChatSuggestedModels.push(newSuggestedModel.value);
    newSuggestedModel.value = '';
  }
}

function removeSuggestedModel(modelId: string) {
  const idx = config.groupChatSuggestedModels.indexOf(modelId);
  if (idx !== -1) {
    config.groupChatSuggestedModels.splice(idx, 1);
  }
}

async function saveModelCosts(provider: string, profileId: string, modelCosts: ModelCost[]) {
  const key = `${provider}-${profileId}`;
  savingModelCosts[key] = true;
  try {
    await api.patch('/admin/config', {
      providerModelCosts: { provider, profileId, modelCosts }
    });
    showSuccess(`${provider} model costs saved`);
  } catch (e: any) {
    showError(e?.response?.data?.error || 'Failed to save model costs');
  } finally {
    savingModelCosts[key] = false;
  }
}

function isModelHidden(modelId: string): boolean {
  const model = availableModels.value.find(m => m.id === modelId || m.providerModelId === modelId);
  return model?.hidden ?? false;
}

async function toggleModelVisibility(modelId: string, visible: boolean) {
  const model = availableModels.value.find(m => m.id === modelId || m.providerModelId === modelId);
  if (!model) return;
  
  try {
    await api.patch(`/admin/models/${model.id}/visibility`, { hidden: !visible });
    model.hidden = !visible;
    showSuccess(`Model ${model.displayName} is now ${visible ? 'visible' : 'hidden'}`);
  } catch (e: any) {
    showError(e?.response?.data?.error || 'Failed to update model visibility');
  }
}

function addModelCost(provider: string, profileId: string) {
  const key = `${provider}-${profileId}`;
  const modelId = newModelCostId[key];
  if (!modelId) return;
  
  const profile = config.providers[provider]?.find(p => p.id === profileId);
  if (profile) {
    profile.modelCosts.push({
      modelId,
      providerCost: { inputTokensPerMillion: 3.00, outputTokensPerMillion: 15.00 },
      billedCost: { inputTokensPerMillion: 0.00, outputTokensPerMillion: 0.00 }
    });
    newModelCostId[key] = '';
  }
}

function removeModelCost(provider: string, profileId: string, index: number) {
  const profile = config.providers[provider]?.find(p => p.id === profileId);
  if (profile) {
    profile.modelCosts.splice(index, 1);
  }
}

function getModelDisplayName(modelId: string): string {
  const model = availableModels.value.find(m => m.id === modelId);
  return model?.displayName || modelId;
}

function getProviderIcon(provider: string): string {
  const icons: Record<string, string> = {
    anthropic: 'mdi-alpha-a-circle',
    bedrock: 'mdi-aws',
    openrouter: 'mdi-router-wireless',
    google: 'mdi-google',
    'openai-compatible': 'mdi-api'
  };
  return icons[provider] || 'mdi-cloud';
}

function getTotalModelCosts(profiles: ProviderProfile[]): number {
  return profiles.reduce((sum, p) => sum + (p.modelCosts?.length || 0), 0);
}

onMounted(() => {
  fetchConfig();
});
</script>

<style scoped>
.model-costs-table {
  background: transparent;
}

.model-costs-table th {
  font-size: 0.65rem;
  text-transform: uppercase;
  opacity: 0.7;
  white-space: nowrap;
}

.model-id-field {
  font-family: monospace;
  font-size: 0.75rem;
  min-width: 300px;
}

.model-id-field :deep(.v-field__input) {
  font-size: 0.75rem;
}

.cost-field {
  width: 65px;
}

.cost-field :deep(.v-field__input) {
  font-size: 0.75rem;
  padding: 2px 4px;
}

.model-costs-table :deep(.v-field__input) {
  min-height: 28px;
  padding: 2px 6px;
}

.model-costs-table td {
  padding: 2px 4px !important;
}
</style>

