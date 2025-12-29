<template>
  <v-card-text style="max-height: 600px; overflow-y: auto; padding: 24px;">
    <p class="text-body-2 mb-4">Arc does not accept payments or resell inference. The starting balance is sponsored for access to deprecated models. You can use your API keys or you can obtain research grants from Anima Labs by contacting us on Discord.<br><br>Here you can review your grant balances and capabilities. Grants track credits you've received, spent, or shared with others.</p>
    <div v-if="loading" class="d-flex align-center justify-center py-6">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <v-alert v-else-if="error" type="error" variant="tonal" class="mb-4">
      {{ error }}
      <template #append>
        <v-btn variant="text" size="small" @click="emit('refresh')">Retry</v-btn>
      </template>
    </v-alert>
    <template v-else>
      <section class="mb-4">
        <h4 class="text-h6 mb-3">Available Balances</h4>
        <v-list v-if="totals.length" density="compact">
          <v-list-item v-for="item in totals" :key="item.currency">
            <v-list-item-title>{{ item.currencyLabel }}</v-list-item-title>
            <template #append>
              <span class="font-weight-medium">{{ formatAmount(item.amount) }}</span>
            </template>
          </v-list-item>
        </v-list>
        <p v-else class="text-grey text-body-2 mb-0">No grants recorded yet.</p>
      </section>

      <section>
        <h4 class="text-h6 mb-3">Capabilities</h4>
        <div v-if="capabilityBadges.length" class="d-flex flex-wrap" style="gap: 8px;">
          <v-chip
            v-for="cap in capabilityBadges"
            :key="cap.capability"
            :color="cap.active ? 'primary' : 'grey-lighten-1'"
            variant="flat"
            size="small"
          >
            {{ cap.label }}
            <span v-if="cap.expiresLabel" class="ml-1 text-caption">({{ cap.expiresLabel }})</span>
            <span v-else-if="!cap.active" class="ml-1 text-caption">(revoked)</span>
          </v-chip>
        </div>
        <p v-else class="text-grey text-body-2 mb-0">No grant capabilities assigned.</p>
      </section>

      <section class="mb-4">
        <h4 class="text-h6 mb-3">Redeem Code</h4>
        <div class="d-flex align-center" style="gap: 8px;">
          <v-text-field
            v-model="redeemCode"
            placeholder="Enter invite code"
            density="compact"
            variant="outlined"
            hide-details
            style="max-width: 300px;"
          />
          <v-btn
            color="primary"
            :disabled="!redeemCode.trim() || redeeming"
            :loading="redeeming"
            @click="redeemInvite"
          >
            Redeem
          </v-btn>
        </div>
        <v-alert v-if="redeemMessage" :type="redeemMessage.type" variant="tonal" class="mt-3" closable @click:close="redeemMessage = null">
          {{ redeemMessage.text }}
        </v-alert>
      </section>

      <GrantActions
        v-if="canMint || canSend"
        :can-mint="canMint"
        :can-send="canSend"
        :currencies="availableCurrencies"
        @completed="emit('refresh')"
      />
    </template>
  </v-card-text>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { GrantCapability, UserGrantSummary } from '@deprecated-claude/shared';
import GrantActions from './GrantActions.vue';
import { api } from '@/services/api.js';

const props = defineProps<{ summary: UserGrantSummary | null; loading: boolean; error: string | null }>();
const emit = defineEmits<{ refresh: [] }>();

// Redeem invite state
const redeemCode = ref('');
const redeeming = ref(false);
const redeemMessage = ref<{ type: 'success' | 'error'; text: string } | null>(null);

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
    emit('refresh');
  } catch (error: any) {
    redeemMessage.value = { type: 'error', text: error?.response?.data?.error || 'Failed to redeem invite' };
  } finally {
    redeeming.value = false;
  }
}

const totals = computed(() => props.summary
  ? Object.entries(props.summary.totals)
      .map(([currency, amount]) => ({ currency, currencyLabel: currency === 'credit' ? 'Credits' : currency, amount: Number(amount) || 0 }))
      .sort((a, b) => a.currency.localeCompare(b.currency))
  : []
);
const availableCurrencies = computed(() => {
  const list = props.summary?.availableCurrencies || [];
  return Array.from(new Set(['credit', ...list.filter(currency => typeof currency === 'string' && currency.trim())]))
    .map(currency => currency.trim())
    .filter(Boolean);
});
const capabilityBadges = computed(() => {
  if (!props.summary) return [] as Array<{ capability: string; label: string; active: boolean; expiresLabel: string | null }>;
  const latest = new Map<string, GrantCapability>();
  for (const capability of props.summary.grantCapabilities) {
    latest.set(capability.capability, capability);
  }
  return Array.from(latest.entries())
    .map(([capability, record]) => ({
      capability,
      label: capability.charAt(0).toUpperCase() + capability.slice(1),
      active: record.action === 'granted' && !isExpired(record.expiresAt),
      expiresLabel: record.action === 'granted' ? formatExpiry(record.expiresAt) : null
    }))
    .sort((a, b) => a.capability.localeCompare(b.capability));
});
const activeCapabilities = computed(() => capabilityBadges.value.filter(cap => cap.active).map(cap => cap.capability));
const canMint = computed(() => activeCapabilities.value.includes('mint') || activeCapabilities.value.includes('admin'));
const canSend = computed(() => activeCapabilities.value.includes('send') || activeCapabilities.value.includes('admin'));
function formatAmount(amount: number): string { return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function isExpired(expiresAt?: string): boolean {
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt);
  return !Number.isNaN(expiry.getTime()) && expiry.getTime() < Date.now();
}
function formatExpiry(expiresAt?: string): string | null {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt);
  return Number.isNaN(expiry.getTime()) ? null : `expires ${expiry.toLocaleDateString()}`;
}
</script>
