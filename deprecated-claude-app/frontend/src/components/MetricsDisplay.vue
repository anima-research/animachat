<template>
  <div class="metrics-display" 
       @mouseenter="handleMouseEnter" 
       @mouseleave="handleMouseLeave">
    <div class="metrics-bar">
      <!-- Compact metrics in top bar -->
      <div class="metric-item hoverable">
        <Icon icon="mdi:text-box-outline" />
        <span class="metric-value">{{ formatTokens(lastCompletionTokens) || '0 tokens' }}</span>
      </div>
    </div>
    
    <!-- Detailed flyout panel -->
    <Transition name="fade">
      <div v-if="showDetails" class="metrics-details">

        <div class="section-header">
          <Icon icon="mdi:robot" />
          <select v-model="selectedModel" class="model-select">
            <option v-for="opt in modelOptions" :key="opt" :value="opt">
              {{ opt }}
            </option>
          </select>
        </div>

        <div class="details-section">
          <h4>Cost Summary</h4>
          <div class="detail-row highlight">
            <span>Total Cost:</span>
            <span>${{ formatCost(curModelMetrics?.totals?.totalCost || 0) }}</span>
          </div>
          <div class="detail-row highlight">
            <span>Total Saved:</span>
            <span class="savings">${{ formatCost(curModelMetrics?.totals?.totalSavings || 0) }}</span>
          </div>
          <div class="detail-row" v-if="curModelMetrics?.lastCompletion">
            <span>Last Completion Cost:</span>
            <span>${{ formatCost(curModelMetrics.lastCompletion.cost) }}</span>
          </div>
        </div>
        
        <div class="details-section">
          <h4>Token Usage</h4>
          <div class="detail-row">
            <span>Total Tokens:</span>
            <span>{{ formatNumber(totalTokens) }}</span>
          </div>
          <div class="detail-row" v-if="curModelMetrics?.lastCompletion">
            <span>Last Input:</span>
            <span>{{ formatNumber(curModelMetrics.lastCompletion.inputTokens) }}</span>
          </div>
          <div class="detail-row" v-if="curModelMetrics?.lastCompletion">
            <span>Last Output:</span>
            <span>{{ formatNumber(curModelMetrics.lastCompletion.outputTokens) }}</span>
          </div>
          <div class="detail-row" v-if="curModelMetrics?.lastCompletion && curModelMetrics.lastCompletion.cachedTokens > 0">
            <span>Cache Length:</span>
            <span class="cache-highlight">{{ formatNumber(curModelMetrics.lastCompletion.cachedTokens) }}</span>
          </div>
          <div class="detail-row" v-if="curModelMetrics?.lastCompletion?.thinkingTokens">
            <span>Last Thinking:</span>
            <span class="thinking-tokens">{{ formatNumber(curModelMetrics.lastCompletion.thinkingTokens) }}</span>
          </div>
        </div>
        
        <div class="details-section">
          <h4>Session Info</h4>
          <div class="detail-row" v-if="curModelMetrics?.messageCount">
            <span>Messages:</span>
            <span>{{ curModelMetrics?.messageCount || 0 }}</span>
          </div>
          <div class="detail-row">
            <span>Completions:</span>
            <span>{{ curModelMetrics?.totals?.completionCount || 0 }}</span>
          </div>
          <div class="detail-row" v-if="curModelMetrics?.lastCompletion">
            <span>Response Time:</span>
            <span>{{ (curModelMetrics.lastCompletion.responseTime / 1000).toFixed(1) }}s</span>
          </div>
        </div>
        
        <div class="details-section">
          <h4>Context Management</h4>
          <div class="detail-row">
            <span>Strategy:</span>
            <span>{{ curContextManagment?.strategy || 'append' }}</span>
          </div>
          <div class="detail-row" v-if="curContextManagment?.strategy === 'append'">
            <span>Tokens Before Caching:</span>
            <span>{{ formatNumber(curContextManagment?.tokensBeforeCaching ?? 10000) }}</span>
          </div>
          <div class="detail-row" v-if="curContextManagment?.strategy === 'rolling'">
            <span>Max Tokens:</span>
            <span>{{ formatNumber(curContextManagment?.maxTokens ?? 0) }}</span>
          </div>
          <div class="detail-row" v-if="curContextManagment?.strategy === 'rolling'">
            <span>Max Grace Tokens:</span>
            <span>{{ formatNumber(curContextManagment?.maxGraceTokens ?? 0) }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { ConversationMetrics, ContextManagement, ModelConversationMetricsSchema } from '@deprecated-claude/shared';
import { useStore } from '@/store';

const props = defineProps<{
  conversationId: string;
}>();

const store = useStore();
const showDetails = ref(false);
const metrics = ref<ConversationMetrics | null>(null);
let hoverTimer: number | null = null;
const ALL_MODELS_METRICS = "All";
const selectedModel = ref<string>(ALL_MODELS_METRICS);

// Track processed metrics to prevent double-counting
const processedMetricsTimestamps = new Set<string>();

const handleMouseEnter = () => {
  if (hoverTimer) clearTimeout(hoverTimer);
  showDetails.value = true;
};

const handleMouseLeave = () => {
  hoverTimer = setTimeout(() => {
    showDetails.value = false;
  }, 200) as unknown as number;
};

// Fetch metrics
const fetchMetrics = async () => {
  try {
    const response = await fetch(`/api/conversations/${props.conversationId}/metrics`, {
      headers: {
        'Authorization': `Bearer ${store.token}`
      }
    });
    
    if (response.ok) {
      metrics.value = await response.json();
    }
  } catch (error) {
    console.error('Failed to fetch metrics:', error);
  }
};

// Update metrics when conversation changes
watch(() => props.conversationId, () => {
  fetchMetrics();
}, { immediate: true });

// Update metrics when conversation settings change (including context management)
watch(() => store.state.currentConversation?.updatedAt, () => {
  if (store.state.currentConversation?.id === props.conversationId) {
    // Small delay to ensure backend has processed the update
    setTimeout(() => {
      fetchMetrics();
    }, 100);
  }
});

// Listen for metrics updates via WebSocket
watch(() => store.lastMetricsUpdate, async (update) => {
  if (update && update.conversationId === props.conversationId) {
    // Create a unique key for this metrics update to prevent double-counting
    const metricsKey = `${update.metrics.timestamp}-${update.metrics.model}-${update.metrics.inputTokens}-${update.metrics.outputTokens}`;
    
    // Skip if we've already processed this exact update
    if (processedMetricsTimestamps.has(metricsKey)) {
      console.log('[MetricsDisplay] Skipping duplicate metrics update:', metricsKey);
      return;
    }
    processedMetricsTimestamps.add(metricsKey);
    
    // Limit the set size to prevent memory leaks (keep last 100)
    if (processedMetricsTimestamps.size > 100) {
      const firstKey = processedMetricsTimestamps.values().next().value;
      processedMetricsTimestamps.delete(firstKey);
    }
    
    // Update last completion metrics
    if (metrics.value) {
      metrics.value.lastCompletion = update.metrics;
      
      // Update totals
      if (metrics.value.totals) {
        metrics.value.totals.inputTokens += update.metrics.inputTokens;
        metrics.value.totals.outputTokens += update.metrics.outputTokens;
        metrics.value.totals.cachedTokens += update.metrics.cachedTokens;
        metrics.value.totals.totalCost += update.metrics.cost;
        metrics.value.totals.totalSavings += update.metrics.cacheSavings;
        metrics.value.totals.completionCount += 1;
      }
      
      // Update per model totals
      if (metrics.value.perModelMetrics) {
        if (!metrics.value.perModelMetrics[update.metrics.model]) {
          await fetchMetrics(); // new model, refetch metrics to get participant id and such
        }
        else {
          const perModelMetricTotals = metrics.value.perModelMetrics[update.metrics.model].totals;
          perModelMetricTotals.inputTokens += update.metrics.inputTokens;
          perModelMetricTotals.outputTokens += update.metrics.outputTokens;
          perModelMetricTotals.cachedTokens += update.metrics.cachedTokens;
          perModelMetricTotals.totalCost += update.metrics.cost;
          perModelMetricTotals.totalSavings += update.metrics.cacheSavings;
          perModelMetricTotals.completionCount += 1;
          metrics.value.perModelMetrics[update.metrics.model].lastCompletion = update.metrics;
        }
      }
    }
  }
});

// Model picker
const curModelMetrics = computed<ModelConversationMetrics | null>(() => {
  if (!metrics.value) return null;
  if (selectedModel.value == ALL_MODELS_METRICS) return metrics.value; // simply grab the high level summary metrics
  return metrics.value.perModelMetrics[selectedModel.value] ?? null;
});

const curContextManagment = computed<ContextManagement | null>(() => {
  if (!metrics.value) return null;
  if (!curModelMetrics.value || !curModelMetrics.value.contextManagement) return metrics.value.contextManagement; // simply grab the high level context management
  // customized context management
  return curModelMetrics.value.contextManagement;
});


// Computed properties
const modelOptions = computed(() =>
  metrics.value
  ? [ALL_MODELS_METRICS, ...Object.keys(metrics.value.perModelMetrics ?? {}).sort((a, b) => a.localeCompare(b))]
  : []
);

watch(modelOptions, opts => {
  if (opts.length && !selectedModel.value) selectedModel.value = opts[0];
});

const lastCompletionTokens = computed(() => {
  if (!metrics.value?.lastCompletion) {
    // Return total tokens as fallback if no last completion
    return metrics.value?.totals ? 
      (metrics.value.totals.inputTokens + metrics.value.totals.outputTokens) : 0;
  }
  return metrics.value.lastCompletion.inputTokens + metrics.value.lastCompletion.outputTokens;
});

const totalTokens = computed(() => {
  // Show total tree size if available (all branches), otherwise fall back to API usage
  if (metrics.value?.totalTreeTokens) {
    return metrics.value.totalTreeTokens;
  }
  if (!curModelMetrics.value?.totals) return 0;
  return curModelMetrics.value.totals.inputTokens + curModelMetrics.value.totals.outputTokens;
});


// Formatting functions
const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toString();
};

const formatTokens = (num: number): string => {
  return formatNumber(num) + ' tokens';
};

const formatCost = (cost: number): string => {
  if (cost < 0.01) return cost.toFixed(4);
  if (cost < 1) return cost.toFixed(3);
  return cost.toFixed(2);
};
</script>

<style scoped>
.metrics-display {
  position: relative;
  display: inline-block;
  overflow: visible !important;
}

.metrics-bar {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.25rem 0;
}

.metric-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  transition: background-color 0.2s;
}

.metric-item.hoverable {
  background-color: rgba(var(--v-theme-on-surface), 0.04);
  cursor: pointer;
  position: relative;
  user-select: none;
}

.metric-item.hoverable:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.08);
}

.metric-value {
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-weight: 500;
}

.metrics-details {
  position: fixed;
  top: 60px;
  right: 20px;
  background-color: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  min-width: 400px;
  z-index: 9999;
  max-height: 80vh;
  overflow-y: auto;
}

.section-header {
    display:flex;
    align-items:center;
    gap:.5rem;
    margin-bottom: .75rem;
}

.model-select {
  padding: .25rem .5rem;
  font-size: .75rem;
  border-radius: 4px;

  /* ── dark look ───────────────────────────── */
  background-color: rgba(var(--v-theme-on-surface), 0.10);   /* match “card” tint */
  color:            rgb(var(--v-theme-on-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));

  /* nicer arrow & consistent border in Safari/Firefox/Edge */
  appearance: none;
}

/* menu background/foreground when it opens */
.model-select option {
  background: rgb(var(--v-theme-surface));
  color:      rgb(var(--v-theme-on-surface));
}

/* hover / focus ring */
.model-select:hover,
.model-select:focus {
  background-color: rgba(var(--v-theme-on-surface), 0.16);
  outline: none;
}

.details-section {
  margin-bottom: 1.5rem;
}

.details-section:last-child {
  margin-bottom: 0;
}

.details-section h4 {
  margin: 0 0 0.75rem 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.25rem 0;
  font-size: 0.875rem;
}

.detail-row span:first-child {
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.detail-row span:last-child {
  color: rgb(var(--v-theme-on-surface));
  font-weight: 500;
}

.detail-row.highlight {
  background-color: rgba(var(--v-theme-on-surface), 0.06);
  padding: 0.5rem 0.75rem;
  margin: 0 -0.75rem;
  border-radius: 6px;
  font-size: 0.9375rem;
}

.detail-row.highlight span:last-child {
  font-weight: 600;
}

.cache-percentage {
  color: rgb(var(--v-theme-success));
  font-size: 0.75rem;
}

.thinking-tokens {
  color: rgb(var(--v-theme-primary));
}

.savings {
  color: rgb(var(--v-theme-success));
}

/* Transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
