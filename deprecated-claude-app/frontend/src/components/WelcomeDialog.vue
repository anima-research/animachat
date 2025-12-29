<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="600"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <ArcLogo :size="30" class="mr-2" />
        <span>Welcome to The Arc</span>
      </v-card-title>
      
      <v-card-text>
        <p class="text-body-1 mb-4">
          Let's get you started with The Arc Chat.
        </p>
        
        <!-- Loading state -->
        <div v-if="loading" class="d-flex align-center justify-center py-6">
          <v-progress-circular indeterminate color="primary" />
        </div>
        
        <v-timeline v-else density="compact" side="end" class="welcome-timeline">
          <!-- Step 1: Credits/API Key - Conditional based on grant status -->
          <v-timeline-item
            dot-color="primary"
            size="small"
            :icon="hasCredits ? 'mdi-check' : 'mdi-key'"
          >
            <div>
              <!-- User already has credits -->
              <template v-if="hasCredits">
                <h4 class="text-h6 mb-1">
                  <v-icon color="success" class="mr-1">mdi-check-circle</v-icon>
                  You're have grants!
                </h4>
              <p class="text-body-2 mb-2">
                  You have 
                  <template v-for="(balance, index) in creditBalances" :key="balance.currency">
                    <strong>{{ formatCredits(balance.amount) }}</strong> {{ formatCurrencyName(balance.currency) }}<template v-if="index < creditBalances.length - 1">, </template>
                  </template>
                  credits available.
                </p>
                
                <!-- Currency descriptions -->
                <div class="text-body-2 text-grey mb-2">
                  <div v-for="balance in creditBalances" :key="balance.currency" class="mb-1">
                    <strong>{{ formatCurrencyName(balance.currency) }}:</strong> {{ getCurrencyDescription(balance.currency) }}
                  </div>
                </div>
                
                <!-- Note about other models if no general credits -->
                <v-alert 
                  v-if="!hasGeneralCredits" 
                  type="info" 
                  variant="tonal" 
                  density="compact"
                  class="mb-2"
                >
                  <p class="text-body-2 mb-1">
                    For other models, you can <a href="#" @click.prevent="openSettings" class="text-primary">add your own API key</a>.
              </p>
                  <p class="text-body-2 mb-0">
                    Doing public research or art? <a href="https://discord.gg/anima" target="_blank" class="text-primary">Contact us on Discord</a> for additional grants.
                  </p>
                </v-alert>
              </template>
              
              <!-- User needs credits or API key -->
              <template v-else>
                <h4 class="text-h6 mb-1">1. Get Access</h4>
                <p class="text-body-2 mb-3">
                  To use The Arc, you need either credits or your own API key.
                </p>
                
                <!-- Redeem code section -->
                <div class="mb-3">
                  <p class="text-body-2 font-weight-medium mb-2">
                    <v-icon size="small" class="mr-1">mdi-ticket</v-icon>
                    Have an invite code?
                  </p>
                  <div class="d-flex align-center" style="gap: 8px;">
                    <v-text-field
                      v-model="redeemCode"
                      placeholder="Enter invite code"
                      density="compact"
                      variant="outlined"
                      hide-details
                      style="max-width: 250px;"
                      :disabled="redeeming"
                    />
                    <v-btn
                      color="primary"
                      size="small"
                      :disabled="!redeemCode.trim() || redeeming"
                      :loading="redeeming"
                      @click="redeemInvite"
                    >
                      Redeem
                    </v-btn>
                  </div>
                  <v-alert 
                    v-if="redeemMessage" 
                    :type="redeemMessage.type" 
                    variant="tonal" 
                    class="mt-2" 
                    density="compact"
                    closable 
                    @click:close="redeemMessage = null"
                  >
                    {{ redeemMessage.text }}
                  </v-alert>
                </div>
                
                <v-divider class="my-3" />
                
                <!-- API Key section -->
                <p class="text-body-2 font-weight-medium mb-2">
                  <v-icon size="small" class="mr-1">mdi-key</v-icon>
                  Or use your own API key
                </p>
                <p class="text-body-2 mb-2 text-grey">
                  Anthropic, AWS Bedrock, and OpenRouter are supported.
              </p>
              <v-btn
                variant="outlined"
                size="small"
                color="primary"
                @click="openSettings"
              >
                <v-icon start>mdi-cog</v-icon>
                  Add API Key
              </v-btn>
              </template>
            </div>
          </v-timeline-item>
          
          <!-- Step 2: Export Tool -->
          <v-timeline-item
            dot-color="secondary"
            size="small"
            icon="mdi-download"
          >
            <div>
              <h4 class="text-h6 mb-1">{{ hasCredits ? '1' : '2' }}. Export Your Conversations (Optional)</h4>
              <p class="text-body-2 mb-2">
                Install our Chrome extension to export and continue your Claude.ai conversations.
              </p>
              <v-btn
                variant="outlined"
                size="small"
                color="secondary"
                href="https://github.com/socketteer/Claude-Conversation-Exporter"
                target="_blank"
              >
                <v-icon start>mdi-github</v-icon>
                Get Export Tool
              </v-btn>
            </div>
          </v-timeline-item>
          
          <!-- Step 3: Start Chatting -->
          <v-timeline-item
            dot-color="success"
            size="small"
            icon="mdi-message-plus"
          >
            <div>
              <h4 class="text-h6 mb-1">{{ hasCredits ? '2' : '3' }}. Start Your Journey</h4>
              <p class="text-body-2 mb-2">
                Create a new conversation or import existing ones to begin.
              </p>
              <v-row dense>
                <v-col cols="auto">
                  <v-btn
                    variant="outlined"
                    size="small"
                    color="success"
                    @click="startNewConversation"
                  >
                    <v-icon start>mdi-plus</v-icon>
                    New Chat
                  </v-btn>
                </v-col>
                <v-col cols="auto">
                  <v-btn
                    variant="outlined"
                    size="small"
                    color="success"
                    @click="openImport"
                  >
                    <v-icon start>mdi-import</v-icon>
                    Import
                  </v-btn>
                </v-col>
              </v-row>
            </div>
          </v-timeline-item>
        </v-timeline>
        
        <v-alert
          type="info"
          variant="tonal"
          class="mt-4"
          density="compact"
        >
          <strong>Tip:</strong> You can access this guide anytime from the menu.
        </v-alert>
        
        <v-checkbox
          v-model="dontShowAgain"
          label="Don't show this again"
          density="compact"
          class="mt-2"
        />
      </v-card-text>
      
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="handleClose"
        >
          {{ dontShowAgain ? 'Close' : 'Skip' }}
        </v-btn>
        <v-btn
          color="primary"
          variant="elevated"
          @click="handleGetStarted"
        >
          {{ hasCredits ? 'Start Chatting' : 'Get Started' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import ArcLogo from '@/components/ArcLogo.vue';
import { api } from '@/services/api.js';
import type { UserGrantSummary } from '@deprecated-claude/shared';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'open-settings': [];
  'open-import': [];
  'new-conversation': [];
}>();

const dontShowAgain = ref(false);
const loading = ref(false);
const grantSummary = ref<UserGrantSummary | null>(null);
const currencyConfig = ref<Record<string, { name: string; description: string }>>({});

// Redeem invite state
const redeemCode = ref('');
const redeeming = ref(false);
const redeemMessage = ref<{ type: 'success' | 'error'; text: string } | null>(null);

// Computed properties for grant status
const hasCredits = computed(() => {
  if (!grantSummary.value) return false;
  return Object.values(grantSummary.value.totals).some(amount => Number(amount) > 0);
});

// Get all non-zero credit balances
const creditBalances = computed(() => {
  if (!grantSummary.value) return [];
  return Object.entries(grantSummary.value.totals)
    .map(([currency, amount]) => ({ currency, amount: Number(amount) || 0 }))
    .filter(item => item.amount > 0)
    .sort((a, b) => a.currency.localeCompare(b.currency));
});

function formatCredits(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatCurrencyName(currency: string): string {
  // Capitalize first letter
  return currency.charAt(0).toUpperCase() + currency.slice(1);
}

function getCurrencyDescription(currency: string): string {
  const config = currencyConfig.value[currency.toLowerCase()] || currencyConfig.value[currency];
  if (config?.description) {
    return config.description;
  }
  // Fallback for unknown currencies
  return `For ${formatCurrencyName(currency)} models`;
}

// Check if user has general credits (not model-specific)
const hasGeneralCredits = computed(() => {
  if (!grantSummary.value) return false;
  const generalCredits = grantSummary.value.totals['credit'] || 0;
  return Number(generalCredits) > 0;
});

async function loadGrants() {
  loading.value = true;
  try {
    const response = await api.get('/auth/grants');
    grantSummary.value = response.data;
    currencyConfig.value = response.data.currencyConfig || {};
  } catch (error) {
    console.error('Failed to load grants:', error);
    // Don't show error to user - just assume no credits
    grantSummary.value = null;
    currencyConfig.value = {};
  } finally {
    loading.value = false;
  }
}

async function redeemInvite() {
  if (!redeemCode.value.trim() || redeeming.value) return;
  redeeming.value = true;
  redeemMessage.value = null;
  try {
    const response = await api.post('/invites/claim', { code: redeemCode.value.trim() });
    const { amount, currency } = response.data;
    const currencyLabel = currency === 'credit' ? 'credits' : `${currency} credits`;
    redeemMessage.value = { type: 'success', text: `Received ${amount} ${currencyLabel}!` };
    redeemCode.value = '';
    // Reload grants to update the display
    await loadGrants();
  } catch (error: any) {
    redeemMessage.value = { type: 'error', text: error?.response?.data?.error || 'Failed to redeem invite' };
  } finally {
    redeeming.value = false;
  }
}

function handleClose() {
  if (dontShowAgain.value) {
    localStorage.setItem('hideWelcomeDialog', 'true');
  }
  emit('update:modelValue', false);
}

function handleGetStarted() {
  if (dontShowAgain.value) {
    localStorage.setItem('hideWelcomeDialog', 'true');
  }
  emit('update:modelValue', false);
  if (hasCredits.value) {
    // If user has credits, start a new conversation
    emit('new-conversation');
  } else {
    // Otherwise, open settings to add API key
  emit('open-settings');
  }
}

function openSettings() {
  emit('update:modelValue', false);
  emit('open-settings');
}

function openImport() {
  emit('update:modelValue', false);
  emit('open-import');
}

function startNewConversation() {
  emit('update:modelValue', false);
  emit('new-conversation');
}

// Load grants when dialog opens
watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    loadGrants();
  }
}, { immediate: true });
</script>

<style scoped>
.welcome-timeline {
  padding-top: 0 !important;
}

.welcome-timeline :deep(.v-timeline-item) {
  padding-bottom: 12px !important;
}

.welcome-timeline :deep(.v-timeline-item:last-child) {
  padding-bottom: 0 !important;
}
</style>
