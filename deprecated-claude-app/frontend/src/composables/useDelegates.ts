import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { getConnectedDelegates, getAvailableTools, type DelegateInfo, type ToolInfo } from '@/services/api';
import { useStore } from '@/store';

// Singleton state - shared across all components using this composable
const delegates = ref<DelegateInfo[]>([]);
const allTools = ref<ToolInfo[]>([]);
const loading = ref(false);  // Only true during FIRST load, never again
const initialLoadDone = ref(false);  // Ensures spinner shows only once
const error = ref<string | null>(null);
const lastFetched = ref<Date | null>(null);

// Notification state for delegate status changes
const notification = ref<{
  show: boolean;
  type: 'connected' | 'disconnected' | 'tools_updated';
  delegateId: string;
  message: string;
} | null>(null);

// Track active instances for cleanup
let activeInstances = 0;
let wsHandlerRegistered = false;

/**
 * Composable for managing delegate connections and tools.
 * Uses singleton pattern - state is shared across all components.
 * Listens to WebSocket events for real-time updates instead of polling.
 */
export function useDelegates() {
  const store = useStore();

  // Fetch delegates from API
  const fetchDelegates = async (): Promise<void> => {
    try {
      error.value = null;
      const result = await getConnectedDelegates();
      delegates.value = result.delegates;
      lastFetched.value = new Date();
    } catch (err) {
      console.error('[useDelegates] Failed to fetch delegates:', err);
      error.value = err instanceof Error ? err.message : 'Failed to fetch delegates';
    }
  };

  // Fetch all available tools
  const fetchTools = async (): Promise<void> => {
    try {
      const result = await getAvailableTools();
      allTools.value = result.tools;
    } catch (err) {
      console.error('[useDelegates] Failed to fetch tools:', err);
    }
  };

  // Fetch both delegates and tools
  // Shows spinner only on first load, never again
  const refresh = async (showLoading = true): Promise<void> => {
    // Only show loading spinner on FIRST load ever
    if (showLoading && !initialLoadDone.value) {
      loading.value = true;
    }
    await Promise.all([fetchDelegates(), fetchTools()]);
    loading.value = false;
    initialLoadDone.value = true;
  };

  // Debounce timer for tool fetching
  let toolFetchTimeout: ReturnType<typeof setTimeout> | null = null;

  // Handle WebSocket delegate status events
  const handleDelegateStatusChanged = (data: any) => {
    const { status, delegateId, toolCount } = data;

    // Show notification only for meaningful events
    // Skip: 'connected' with 0 tools (will get tools_updated right after)
    // Skip: 'tools_updated' (too frequent, silent update is better)
    if (status === 'connected' && toolCount > 0) {
      notification.value = {
        show: true,
        type: 'connected',
        delegateId,
        message: `Delegate "${delegateId}" connected with ${toolCount} tools`,
      };
      // Auto-hide notification after 5 seconds
      setTimeout(() => {
        if (notification.value?.delegateId === delegateId) {
          notification.value = null;
        }
      }, 5000);
    } else if (status === 'disconnected') {
      notification.value = {
        show: true,
        type: 'disconnected',
        delegateId,
        message: `Delegate "${delegateId}" disconnected. MCP tools unavailable.`,
      };
      // Auto-hide notification after 5 seconds
      setTimeout(() => {
        if (notification.value?.delegateId === delegateId) {
          notification.value = null;
        }
      }, 5000);
    }
    // 'tools_updated' - silent update, no notification

    if (data.delegates) {
      // Build new delegates list
      const newDelegates = data.delegates.map((d: any) => ({
        delegateId: d.delegateId,
        userId: '', // Not needed for display
        tools: Array(d.toolCount).fill({ name: '', description: '', source: 'delegate' }),
        connectedAt: d.connectedAt,
        capabilities: {
          managedInstall: false,
          canFileAccess: d.capabilities?.includes('file_access') ?? false,
          canShellAccess: d.capabilities?.includes('shell_access') ?? false,
        },
      }));

      // Only update if actually changed (prevents unnecessary re-renders)
      const currentIds = delegates.value.map(d => `${d.delegateId}:${d.tools.length}`).sort().join(',');
      const newIds = newDelegates.map((d: any) => `${d.delegateId}:${d.tools.length}`).sort().join(',');

      if (currentIds !== newIds) {
        delegates.value = newDelegates;
        lastFetched.value = new Date();
      }

      // Debounce tool fetching - only fetch if tools actually changed
      if (toolFetchTimeout) {
        clearTimeout(toolFetchTimeout);
      }
      toolFetchTimeout = setTimeout(async () => {
        const oldToolNames = allTools.value.map(t => t.name).sort().join(',');
        await fetchTools();
        const newToolNames = allTools.value.map(t => t.name).sort().join(',');
        // No need to set refreshing - silent update
        toolFetchTimeout = null;
      }, 500);  // Increased debounce to 500ms
    }
  };

  // Dismiss notification
  const dismissNotification = () => {
    notification.value = null;
  };

  // Setup WebSocket listener
  const setupWsListener = () => {
    if (wsHandlerRegistered) return;

    const wsService = store.state.wsService;
    if (wsService) {
      wsService.on('delegate_status_changed', handleDelegateStatusChanged);
      wsHandlerRegistered = true;
    }
  };

  // Cleanup WebSocket listener
  const cleanupWsListener = () => {
    if (!wsHandlerRegistered) return;

    const wsService = store.state.wsService;
    if (wsService) {
      wsService.off('delegate_status_changed', handleDelegateStatusChanged);
      wsHandlerRegistered = false;
    }
  };

  // Computed properties
  const onlineDelegates = computed(() => {
    const now = Date.now();
    return delegates.value.filter(d => {
      const connectedAt = new Date(d.connectedAt).getTime();
      return now - connectedAt < 60 * 60 * 1000; // Within last hour
    });
  });

  const totalDelegateTools = computed(() => {
    return delegates.value.reduce((sum, d) => sum + d.tools.length, 0);
  });

  const serverTools = computed(() => {
    return allTools.value.filter(t => t.source === 'server');
  });

  const delegateTools = computed(() => {
    return allTools.value.filter(t => t.source === 'delegate');
  });

  const hasAnyDelegate = computed(() => delegates.value.length > 0);

  // Helper to format connected time
  const formatConnectedTime = (connectedAt: string): string => {
    const now = Date.now();
    const connected = new Date(connectedAt).getTime();
    const diffMs = now - connected;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return new Date(connectedAt).toLocaleDateString();
  };

  // Check if delegate is online
  const isOnline = (delegate: DelegateInfo): boolean => {
    const connectedAt = new Date(delegate.connectedAt).getTime();
    const now = Date.now();
    return now - connectedAt < 60 * 60 * 1000; // Within last hour
  };

  // Watch for wsService availability
  watch(
    () => store.state.wsService,
    (wsService) => {
      if (wsService && activeInstances > 0) {
        setupWsListener();
      }
    },
    { immediate: true }
  );

  // Lifecycle management
  onMounted(async () => {
    activeInstances++;

    // Initial fetch only once (first component mount)
    if (!initialLoadDone.value && !loading.value) {
      await refresh();
    }

    // Setup WebSocket listener
    setupWsListener();
  });

  onUnmounted(() => {
    activeInstances--;

    // Cleanup if no more instances
    if (activeInstances === 0) {
      cleanupWsListener();
    }
  });

  return {
    // State
    delegates,
    allTools,
    loading,      // Only true during FIRST load (shows spinner once)
    error,
    lastFetched,
    notification,

    // Computed
    onlineDelegates,
    totalDelegateTools,
    serverTools,
    delegateTools,
    hasAnyDelegate,

    // Methods
    refresh,
    fetchDelegates,
    fetchTools,
    formatConnectedTime,
    isOnline,
    dismissNotification,
  };
}
