<template>
  <v-card-text style="max-height: 600px; overflow-y: auto; padding: 24px;">
    <p class="text-body-2 mb-4">Review your grant balances and capabilities. Grants track credits you've received, spent, or shared with others.</p>
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
    </template>
  </v-card-text>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { GrantCapability, UserGrantSummary } from '@deprecated-claude/shared';
const props = defineProps<{ summary: UserGrantSummary | null; loading: boolean; error: string | null }>();
const emit = defineEmits<{ refresh: [] }>();
const totals = computed(() => props.summary
  ? Object.entries(props.summary.totals)
      .map(([currency, amount]) => ({
        currency,
        currencyLabel: currency === 'credit' ? 'Credits' : currency,
        amount: Number(amount) || 0
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency))
  : []
);

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
