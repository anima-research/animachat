<template>
  <v-container class="model-test-view">
    <v-row justify="center">
      <v-col cols="12" md="8" lg="6">
        <v-card class="pa-6">
          <v-card-title class="text-h4 mb-4">
            <v-icon icon="mdi-test-tube" class="mr-2" />
            OpenRouter Model Autocomplete Test
          </v-card-title>
          
          <v-card-text>
            <p class="text-body-1 mb-4">
              This page demonstrates the OpenRouter model autocomplete component. 
              It fetches and caches all available models from OpenRouter, allowing users to search and select models easily.
            </p>
            
            <v-divider class="my-4" />
            
            <h3 class="text-h6 mb-3">Try it out:</h3>
            
            <OpenRouterModelAutocomplete
              v-model="selectedModel"
              :clearable="true"
              @model-selected="onModelSelected"
            />
            
            <v-divider class="my-4" />
            
            <div v-if="selectedModel" class="mt-4">
              <h3 class="text-h6 mb-3">Selected Model Details:</h3>
              
              <v-card variant="outlined" class="pa-4">
                <div class="model-details">
                  <div class="detail-row">
                    <span class="detail-label">ID:</span>
                    <code class="detail-value">{{ selectedModel.id }}</code>
                  </div>
                  
                  <div class="detail-row" v-if="selectedModel.name">
                    <span class="detail-label">Name:</span>
                    <span class="detail-value">{{ selectedModel.name }}</span>
                  </div>
                  
                  <div class="detail-row" v-if="selectedModel.description">
                    <span class="detail-label">Description:</span>
                    <span class="detail-value">{{ selectedModel.description }}</span>
                  </div>
                  
                  <div class="detail-row" v-if="selectedModel.context_length">
                    <span class="detail-label">Context Length:</span>
                    <span class="detail-value">{{ selectedModel.context_length.toLocaleString() }} tokens</span>
                  </div>
                  
                  <div class="detail-row" v-if="selectedModel.top_provider">
                    <span class="detail-label">Max Completion:</span>
                    <span class="detail-value">
                      {{ selectedModel.top_provider.max_completion_tokens?.toLocaleString() || 'N/A' }} tokens
                    </span>
                  </div>
                  
                  <div class="detail-row" v-if="selectedModel.pricing">
                    <span class="detail-label">Pricing (Input):</span>
                    <span class="detail-value">${{ selectedModel.pricing.prompt }} per token</span>
                  </div>
                  
                  <div class="detail-row" v-if="selectedModel.pricing">
                    <span class="detail-label">Pricing (Output):</span>
                    <span class="detail-value">${{ selectedModel.pricing.completion }} per token</span>
                  </div>
                  
                  <div class="detail-row" v-if="selectedModel.architecture">
                    <span class="detail-label">Modality:</span>
                    <span class="detail-value">{{ selectedModel.architecture.modality || 'N/A' }}</span>
                  </div>
                  
                  <div class="detail-row" v-if="selectedModel.architecture">
                    <span class="detail-label">Tokenizer:</span>
                    <span class="detail-value">{{ selectedModel.architecture.tokenizer || 'N/A' }}</span>
                  </div>
                </div>
                
                <v-divider class="my-4" />
                
                <div class="text-caption text-grey">
                  <strong>Raw JSON:</strong>
                </div>
                <pre class="raw-json mt-2">{{ JSON.stringify(selectedModel, null, 2) }}</pre>
              </v-card>
            </div>
            
            <div v-else class="mt-4 text-center text-grey">
              <v-icon icon="mdi-arrow-up" size="large" class="mb-2" />
              <p>Select a model above to see its details</p>
            </div>
          </v-card-text>
          
          <v-card-actions>
            <v-spacer />
            <v-btn
              color="primary"
              variant="text"
              to="/"
            >
              Back to Home
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { OpenRouterModel } from '@deprecated-claude/shared';
import OpenRouterModelAutocomplete from '@/components/OpenRouterModelAutocomplete.vue';

const selectedModel = ref<OpenRouterModel | null>(null);

function onModelSelected(model: OpenRouterModel) {
  console.log('Model selected:', model);
}
</script>

<style scoped>
.model-test-view {
  padding-top: 2rem;
  padding-bottom: 2rem;
}

.model-details {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.detail-label {
  font-weight: 600;
  min-width: 140px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.detail-value {
  flex: 1;
  word-break: break-word;
}

.detail-value code {
  background: rgba(var(--v-theme-on-surface), 0.05);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.875rem;
}

.raw-json {
  background: rgba(var(--v-theme-on-surface), 0.05);
  padding: 12px;
  border-radius: 4px;
  font-size: 0.75rem;
  overflow-x: auto;
  max-height: 400px;
  overflow-y: auto;
}
</style>

