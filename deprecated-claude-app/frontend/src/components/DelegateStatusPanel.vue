<template>
  <v-card variant="outlined" class="delegate-status-panel">
    <v-card-title class="text-subtitle-1 d-flex align-center">
      <v-icon size="small" class="mr-2">mdi-connection</v-icon>
      Connected Delegates
      <v-chip
        v-if="delegates.length > 0"
        size="x-small"
        color="success"
        class="ml-2"
      >
        {{ delegates.length }}
      </v-chip>
    </v-card-title>

    <v-card-text class="py-2">
      <div v-if="loading && delegates.length === 0" class="text-center py-4">
        <v-progress-circular indeterminate size="24" />
      </div>

      <div v-else-if="delegates.length === 0" class="text-body-2 text-medium-emphasis">
        No delegates connected. Delegates provide remote tool execution capabilities.
      </div>

      <v-list v-else density="compact" class="pa-0">
        <v-list-item
          v-for="delegate in delegates"
          :key="delegate.delegateId"
          class="px-0"
        >
          <template v-slot:prepend>
            <v-icon
              :color="isOnline(delegate) ? 'success' : 'grey'"
              size="small"
            >
              {{ isOnline(delegate) ? 'mdi-circle' : 'mdi-circle-outline' }}
            </v-icon>
          </template>

          <v-list-item-title class="text-body-2">
            {{ delegate.delegateId }}
          </v-list-item-title>

          <v-list-item-subtitle class="text-caption">
            {{ delegate.tools.length }} tool{{ delegate.tools.length === 1 ? '' : 's' }}
            <span v-if="delegate.capabilities.canShellAccess" class="ml-1">
              <v-chip size="x-small" color="warning" variant="text">shell</v-chip>
            </span>
            <span v-if="delegate.capabilities.canFileAccess" class="ml-1">
              <v-chip size="x-small" color="info" variant="text">files</v-chip>
            </span>
          </v-list-item-subtitle>

          <template v-slot:append>
            <v-tooltip location="top">
              <template v-slot:activator="{ props }">
                <span v-bind="props" class="text-caption text-medium-emphasis">
                  {{ formatConnectedTime(delegate.connectedAt) }}
                </span>
              </template>
              Connected at {{ new Date(delegate.connectedAt).toLocaleString() }}
            </v-tooltip>
          </template>
        </v-list-item>
      </v-list>
    </v-card-text>

    <v-card-actions v-if="!loading || delegates.length > 0">
      <v-btn
        size="small"
        variant="text"
        @click="handleRefresh"
        :loading="manualRefreshing"
      >
        <v-icon size="small" class="mr-1">mdi-refresh</v-icon>
        Refresh
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useDelegates } from '@/composables/useDelegates';

const emit = defineEmits<{
  'delegates-updated': [delegates: any[]];
}>();

const manualRefreshing = ref(false);

const {
  delegates,
  loading,
  refresh,
  formatConnectedTime,
  isOnline,
} = useDelegates();

// Notify parent when delegates change
watch(delegates, (newDelegates) => {
  emit('delegates-updated', newDelegates);
}, { immediate: true });

const handleRefresh = async () => {
  manualRefreshing.value = true;
  await refresh(false);  // Silent refresh - no loading spinner
  manualRefreshing.value = false;
};
</script>

<style scoped>
.delegate-status-panel {
  max-width: 400px;
}
</style>
