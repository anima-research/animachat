<template>
  <div class="pricing-page">
    <div class="breadcrumb">
      <a href="/anima/index.html">anima</a> /
      <a href="/about">arc</a> /
      models
    </div>

    <v-container class="pricing-content" fluid>
      <v-row justify="center">
        <v-col cols="12" lg="10" xl="8">
          <v-card class="pa-6">
            <v-card-title class="text-h4 font-weight-bold">Model Pricing</v-card-title>
            <v-card-subtitle class="mb-4">
              Configured system models and the current pricing per input and output token.
            </v-card-subtitle>

            <v-alert
              v-if="error"
              type="error"
              variant="tonal"
              class="mb-4"
            >
              {{ error }}
            </v-alert>

            <div v-if="loading" class="d-flex justify-center py-8">
              <v-progress-circular indeterminate color="primary" />
            </div>

            <div v-else>
              <v-alert
                v-if="!models.length"
                type="info"
                variant="tonal"
                class="mb-4"
              >
                No models are configured in the system configuration.
              </v-alert>

              <v-expansion-panels v-model="expandedPanels" multiple>
                <template v-for="(model, index) in orderedModels" :key="model.id">
                  <v-expansion-panel class="mb-3">
                    <v-expansion-panel-title>
                      <div class="d-flex flex-column">
                        <span class="text-h6">{{ model.displayName }}</span>
                        <span class="text-caption text-medium-emphasis">
                          Provider: {{ model.provider }} • Context: {{ model.contextWindow.toLocaleString() }} tokens
                        </span>
                        <div
                          v-if="visibleCurrencies(model.currencies).length"
                          class="currency-chips"
                        >
                          <v-chip
                            v-for="currency in visibleCurrencies(model.currencies)"
                            :key="currency"
                            size="x-small"
                            color="primary"
                            class="currency-chip"
                            variant="tonal"
                          >
                            {{ currency }}
                          </v-chip>
                        </div>
                      </div>
                    <v-chip
                      v-if="model.hidden"
                      color="warning"
                      size="small"
                      class="ml-auto"
                    >
                      hidden
                    </v-chip>
                  </v-expansion-panel-title>
                  <v-expansion-panel-text>
                    <div class="model-meta mb-4">
                      <div class="meta-item">
                        <span class="meta-label">Model ID</span>
                        <span class="meta-value">{{ model.providerModelId }}</span>
                      </div>
                      <div class="meta-item">
                        <span class="meta-label">Output token limit</span>
                        <span class="meta-value">{{ model.outputTokenLimit.toLocaleString() }}</span>
                      </div>
                      <div class="meta-item">
                        <span class="meta-label">Thinking support</span>
                        <span class="meta-value">{{ model.supportsThinking ? 'yes' : 'no' }}</span>
                      </div>
                    </div>

                    <v-alert
                      v-if="!model.pricing.length"
                      type="warning"
                      variant="tonal"
                    >
                      Pricing has not been configured for this model.
                    </v-alert>

                    <v-table v-else density="comfortable">
                      <thead>
                        <tr>
                          <th class="text-left">Profile</th>
                          <th class="text-left">Priority</th>
                          <th class="text-left">Provider input</th>
                          <th class="text-left">Provider output</th>
                          <th class="text-left">Billed input</th>
                          <th class="text-left">Billed output</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="tier in model.pricing" :key="tier.profileId">
                          <td>{{ tier.profileName }}</td>
                          <td>{{ tier.profilePriority }}</td>
                          <td>
                            {{ formatTokenPrice(tier.providerCost?.perToken.input) }}
                            <span class="per-million">({{ formatPerMillion(tier.providerCost?.perMillion.input) }}/M)</span>
                          </td>
                          <td>
                            {{ formatTokenPrice(tier.providerCost?.perToken.output) }}
                            <span class="per-million">({{ formatPerMillion(tier.providerCost?.perMillion.output) }}/M)</span>
                          </td>
                          <td>
                            {{ formatTokenPrice(tier.billedCost?.perToken.input) }}
                            <span class="per-million">({{ formatPerMillion(tier.billedCost?.perMillion.input) }}/M)</span>
                          </td>
                          <td>
                            {{ formatTokenPrice(tier.billedCost?.perToken.output) }}
                            <span class="per-million">({{ formatPerMillion(tier.billedCost?.perMillion.output) }}/M)</span>
                          </td>
                        </tr>
                      </tbody>
                    </v-table>
                  </v-expansion-panel-text>
                  </v-expansion-panel>
                  <v-divider
                    v-if="index === pricedModels.length - 1 && otherModels.length"
                    class="my-4"
                  />
                </template>
              </v-expansion-panels>
            </div>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { api } from '@/services/api';

interface ModelPricingCost {
  perToken: { input: number | null; output: number | null };
  perMillion: { input: number | null; output: number | null };
}

interface ModelPricingTier {
  profileId: string;
  profileName: string;
  profilePriority: number;
  providerCost: ModelPricingCost | null;
  billedCost: ModelPricingCost | null;
}

interface ModelPricingSummary {
  id: string;
  displayName: string;
  provider: string;
  providerModelId: string;
  hidden: boolean;
  contextWindow: number;
  outputTokenLimit: number;
  supportsThinking: boolean;
  pricing: ModelPricingTier[];
  currencies: string[];
}

const models = ref<ModelPricingSummary[]>([]);
const loading = ref(true);
const error = ref('');
const expandedPanels = ref<number[]>([]);

const pricedModels = computed(() => models.value.filter(model => model.pricing.length));
const otherModels = computed(() => models.value.filter(model => !model.pricing.length));
const orderedModels = computed(() => pricedModels.value.concat(otherModels.value));

watch(
  models,
  () => {
    expandedPanels.value = pricedModels.value.map((_, index) => index);
  },
  { immediate: true, deep: true },
);

function formatTokenPrice(value: number | null): string {
  if (value === null) {
    return '—';
  }
  if (value >= 0.01) {
    return `$${value.toFixed(2)}`;
  }
  if (value >= 0.001) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(8)}`;
}

function formatPerMillion(value: number | null): string {
  if (value === null) {
    return '—';
  }
  return `$${value.toFixed(2)}`;
}

function visibleCurrencies(currencies?: string[]): string[] {
  return (currencies || []).filter(currency => currency !== 'credit');
}

async function loadPricing() {
  loading.value = true;
  error.value = '';
  try {
    const response = await api.get('/public/models');
    models.value = response.data.models || [];
  } catch (err) {
    console.error('Failed to load model pricing', err);
    error.value = 'Unable to load model pricing data.';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadPricing();
});
</script>

<style scoped>
.pricing-page {
  min-height: 100vh;
  background: radial-gradient(circle at top, rgba(187, 134, 252, 0.15), transparent 45%),
    #0e0e0e;
  color: #f5f5f5;
  padding-bottom: 64px;
}

.breadcrumb {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 16px 0;
  font-family: 'IBM Plex Mono', monospace;
  text-transform: lowercase;
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.9rem;
}

.breadcrumb a {
  color: rgba(187, 134, 252, 0.9);
  text-decoration: none;
}

.pricing-content {
  padding-top: 24px;
}

.model-meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}

.meta-item {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 12px;
}

.meta-label {
  display: block;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 4px;
}

.meta-value {
  font-size: 0.95rem;
  font-weight: 500;
}

.per-million {
  display: block;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
}

.currency-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.currency-chip {
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
</style>
