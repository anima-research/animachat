<template>
  <v-menu
    v-model="menuOpen"
    :close-on-content-click="false"
    location="top"
    offset="8"
  >
    <template v-slot:activator="{ props }">
      <v-btn
        v-bind="props"
        variant="text"
        size="small"
        class="delegate-indicator"
        :color="indicatorColor"
      >
        <v-icon size="small" :color="indicatorColor" class="mr-1">
          {{ hasAnyDelegate ? 'mdi-connection' : 'mdi-connection-off' }}
        </v-icon>
        <span class="text-caption">
          {{ statusText }}
        </span>
        <v-icon size="x-small" class="ml-1">
          {{ menuOpen ? 'mdi-chevron-down' : 'mdi-chevron-up' }}
        </v-icon>
      </v-btn>
    </template>

    <v-card min-width="280" max-width="350">
      <v-card-title class="text-subtitle-2 pb-1 d-flex align-center">
        <v-icon size="small" class="mr-2">mdi-connection</v-icon>
        Delegates
        <v-spacer />
        <v-btn
          icon
          size="x-small"
          variant="text"
          @click="handleRefresh"
          :loading="loading"
        >
          <v-icon size="small">mdi-refresh</v-icon>
        </v-btn>
      </v-card-title>

      <v-divider />

      <v-card-text class="py-2">
        <!-- Loading state -->
        <div v-if="loading && delegates.length === 0" class="text-center py-4">
          <v-progress-circular indeterminate size="24" />
        </div>

        <!-- No delegates -->
        <div v-else-if="delegates.length === 0" class="text-body-2 text-medium-emphasis py-2">
          <v-icon size="small" class="mr-1">mdi-information-outline</v-icon>
          No delegates connected.
          <div class="text-caption mt-1">
            Connect a delegate to use MCP tools.
          </div>
        </div>

        <!-- Delegate list -->
        <v-list v-else density="compact" class="pa-0">
          <v-list-item
            v-for="delegate in delegates"
            :key="delegate.delegateId"
            class="px-1"
          >
            <template v-slot:prepend>
              <v-icon
                :color="isOnline(delegate) ? 'success' : 'grey'"
                size="x-small"
                class="mr-2"
              >
                mdi-circle
              </v-icon>
            </template>

            <v-list-item-title class="text-body-2">
              {{ delegate.delegateId }}
            </v-list-item-title>

            <v-list-item-subtitle class="text-caption d-flex align-center">
              <span>{{ delegate.tools.length }} tools</span>
              <v-chip
                v-if="delegate.capabilities.canShellAccess"
                size="x-small"
                color="warning"
                variant="text"
                class="ml-1"
              >
                shell
              </v-chip>
              <v-chip
                v-if="delegate.capabilities.canFileAccess"
                size="x-small"
                color="info"
                variant="text"
                class="ml-1"
              >
                files
              </v-chip>
            </v-list-item-subtitle>

            <template v-slot:append>
              <span class="text-caption text-medium-emphasis">
                {{ formatConnectedTime(delegate.connectedAt) }}
              </span>
            </template>
          </v-list-item>
        </v-list>

        <!-- Tools summary -->
        <v-divider v-if="allTools.length > 0" class="my-2" />
        <div v-if="allTools.length > 0" class="text-caption text-medium-emphasis d-flex justify-space-between">
          <span>
            <v-icon size="x-small" class="mr-1">mdi-tools</v-icon>
            {{ serverTools.length }} server
          </span>
          <span>
            <v-icon size="x-small" class="mr-1">mdi-puzzle</v-icon>
            {{ delegateTools.length }} MCP
          </span>
          <span>
            <strong>{{ allTools.length }} total</strong>
          </span>
        </div>
      </v-card-text>

      <!-- Last updated -->
      <v-card-actions class="text-caption text-medium-emphasis pa-2 pt-0">
        <span v-if="lastFetched">
          Updated {{ formatTime(lastFetched) }}
        </span>
      </v-card-actions>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useDelegates } from '@/composables/useDelegates';

const menuOpen = ref(false);

const {
  delegates,
  allTools,
  loading,
  lastFetched,
  serverTools,
  delegateTools,
  hasAnyDelegate,
  refresh,
  formatConnectedTime,
  isOnline,
} = useDelegates();

const indicatorColor = computed(() => {
  if (delegates.value.length === 0) return 'grey';
  return 'success';
});

const statusText = computed(() => {
  if (delegates.value.length === 0) return 'No delegate';
  if (delegates.value.length === 1) {
    return `${delegates.value[0].delegateId}`;
  }
  return `${delegates.value.length} delegates`;
});

const handleRefresh = async () => {
  await refresh();
};

const formatTime = (date: Date): string => {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / 60000);

  if (diffSecs < 10) return 'just now';
  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  return date.toLocaleTimeString();
};
</script>

<style scoped>
.delegate-indicator {
  text-transform: none;
  letter-spacing: normal;
}
</style>
