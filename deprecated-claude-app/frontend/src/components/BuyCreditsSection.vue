<template>
  <!-- Renders nothing until billing is confirmed enabled, so this is safe to
       ship before Stripe is configured. -->
  <section v-if="enabled" class="mb-4">
    <h4 class="text-h6 mb-3">Buy Credits</h4>

    <!-- Post-redirect status from Stripe Checkout -->
    <v-alert
      v-if="returnMessage"
      :type="returnMessage.type"
      variant="tonal"
      class="mb-3"
      closable
      @click:close="returnMessage = null"
    >
      {{ returnMessage.text }}
    </v-alert>

    <p class="text-body-2 text-grey mb-3">
      1 credit = ${{ usdPerCredit.toFixed(2) }} of model usage.
      <span v-if="markup > 1">Priced at ${{ pricePerCredit.toFixed(2) }} per credit.</span>
    </p>

    <!-- Preset amounts (in whole credits) -->
    <div v-if="presets.length" class="d-flex flex-wrap mb-3" style="gap: 8px;">
      <v-btn
        v-for="preset in presets"
        :key="preset"
        :variant="credits === preset ? 'flat' : 'outlined'"
        :color="credits === preset ? 'primary' : undefined"
        size="small"
        @click="credits = preset"
      >
        {{ preset }}
      </v-btn>
    </div>

    <div class="d-flex align-center" style="gap: 8px;">
      <v-text-field
        v-model.number="credits"
        type="number"
        :min="minCredits"
        :max="maxCredits"
        step="1"
        suffix="credits"
        density="compact"
        variant="outlined"
        hide-details
        style="max-width: 200px;"
      />
      <v-btn
        color="primary"
        :disabled="!isValid || submitting"
        :loading="submitting"
        @click="purchase"
      >
        Purchase
      </v-btn>
    </div>

    <p v-if="isValid" class="text-caption text-grey mt-2 mb-0">
      Total: ${{ totalCost }}
    </p>
    <p v-else-if="credits" class="text-caption text-error mt-2 mb-0">
      Enter a whole number of credits between {{ minCredits }} and {{ maxCredits }}.
    </p>

    <v-alert v-if="error" type="error" variant="tonal" class="mt-3" closable @click:close="error = null">
      {{ error }}
    </v-alert>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '@/services/api';
import type { BillingConfig } from '@deprecated-claude/shared';

const emit = defineEmits<{ refresh: [] }>();

const config = ref<BillingConfig | null>(null);
const credits = ref<number | null>(null);
const submitting = ref(false);
const error = ref<string | null>(null);
const returnMessage = ref<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);

const enabled = computed(() => config.value?.enabled === true);
const usdPerCredit = computed(() => config.value?.usdPerCredit ?? 1);
const markup = computed(() => config.value?.creditMarkup ?? 1);
const pricePerCredit = computed(() => usdPerCredit.value * markup.value);
const minCredits = computed(() => config.value?.minCredits ?? 1);
const maxCredits = computed(() => config.value?.maxCredits ?? 100000);
const presets = computed(() => config.value?.presetsCredits ?? []);

const isValid = computed(() => {
  const c = Number(credits.value);
  return Number.isInteger(c) && c >= minCredits.value && c <= maxCredits.value;
});

const totalCost = computed(() => {
  if (!isValid.value) return '0.00';
  return (Number(credits.value) * pricePerCredit.value).toFixed(2);
});

async function loadConfig() {
  try {
    const response = await api.get('/billing/config');
    config.value = response.data;
    if (!credits.value && presets.value.length) {
      credits.value = presets.value[0];
    }
  } catch (err: any) {
    // The "billing not configured" case is NOT an error — /config returns 200 with
    // { enabled: false }, and the section stays hidden via the `enabled` gate. So
    // anything reaching here is a real failure (401 expired token, 5xx, network).
    // We still can't render pricing we don't have, so the section stays hidden, but
    // we surface a warning rather than vanishing silently with no trace.
    config.value = null;
    console.warn('[billing] failed to load billing config; Buy Credits hidden:', err?.response?.status ?? err?.message ?? err);
  }
}

async function purchase() {
  if (!isValid.value || submitting.value) return;
  submitting.value = true;
  error.value = null;
  try {
    const response = await api.post('/billing/checkout', { credits: Number(credits.value) });
    const url = response.data?.url;
    if (!url) throw new Error('No checkout URL returned');
    window.location.href = url; // hand off to Stripe Checkout
  } catch (err: any) {
    error.value = err?.response?.data?.error || err?.message || 'Failed to start checkout';
    submitting.value = false;
  }
  // On success we navigate away, so no need to reset submitting.
}

// Handle the redirect back from Stripe Checkout (success_url / cancel_url carry
// ?purchase=success|cancelled). Show a message, refresh balances, clean the URL.
function handleReturn() {
  const params = new URLSearchParams(window.location.search);
  const purchase = params.get('purchase');
  if (!purchase) return;

  if (purchase === 'success') {
    returnMessage.value = {
      type: 'success',
      text: 'Payment received — your credits will appear shortly.',
    };
    emit('refresh');
  } else if (purchase === 'cancelled') {
    returnMessage.value = { type: 'info', text: 'Checkout cancelled — no charge was made.' };
  }

  // Strip the query param so a refresh doesn't re-trigger the message.
  params.delete('purchase');
  const query = params.toString();
  const newUrl = window.location.pathname + (query ? `?${query}` : '') + window.location.hash;
  window.history.replaceState({}, '', newUrl);
}

onMounted(() => {
  loadConfig();
  handleReturn();
});
</script>
