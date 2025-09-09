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
          <div class="detail-row">
            <span>Cached Tokens:</span>
            <span>{{ formatNumber(curModelMetrics?.totals?.cachedTokens || 0) }}
              <span class="cache-percentage" v-if="(curModelMetrics?.totals?.cachedTokens || 0) > 0">
                ({{ overallCacheEfficiency }}%)
              </span>
            </span>
          </div>
          <div class="detail-row" v-if="curModelMetrics?.lastCompletion">
            <span>Last Input:</span>
            <span>{{ formatNumber(curModelMetrics.lastCompletion.inputTokens) }}</span>
          </div>
          <div class="detail-row" v-if="curModelMetrics?.lastCompletion">
            <span>Last Output:</span>
            <span>{{ formatNumber(curModelMetrics.lastCompletion.outputTokens) }}</span>
          </div>
          <div class="detail-row" v-if="curModelMetrics?.lastCompletion">
            <span>Last Cached:</span>
            <span>{{ formatNumber(curModelMetrics.lastCompletion.cachedTokens) }} 
              <span class="cache-percentage" v-if="curModelMetrics.lastCompletion.cachedTokens > 0">
                ({{ cacheEfficiency }}%)
              </span>
            </span>
          </div>
        </div>
        
        <div class="details-section">
          <h4>Session Info</h4>
          <div class="detail-row">
            <span>Messages:</span>
            <span>{{ curModelMetrics?.totals?.messageCount || 0 }}</span>
          </div>
          <div class="detail-row">
            <span>Completions:</span>
            <span>{{ curModelMetrics?.totals?.completionCount || 0 }}</span>
          </div>
          <div class="detail-row" v-if="curModelMetrics?.lastCompletion">
            <span>Model:</span>
            <span>{{ curModelMetrics.lastCompletion.model }}</span>
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
            <span>{{ metrics?.contextManagement?.strategy || 'append' }}</span>
          </div>
          <div class="detail-row" v-if="metrics?.contextManagement?.parameters?.maxTokens">
            <span>Max Tokens:</span>
            <span>{{ formatNumber(metrics.contextManagement.parameters.maxTokens) }}</span>
          </div>
          <div class="detail-row" v-if="metrics?.contextManagement?.parameters?.maxGraceTokens">
            <span>Grace Tokens:</span>
            <span>{{ formatNumber(metrics.contextManagement.parameters.maxGraceTokens) }}</span>
          </div>
          <div class="detail-row" v-if="metrics?.contextManagement?.parameters?.cacheInterval">
            <span>Cache Interval:</span>
            <span>{{ formatNumber(metrics.contextManagement.parameters.cacheInterval) }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Icon } from '@iconify/vue';
import type { ConversationMetrics } from '@deprecated-claude/shared';
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
watch(() => store.lastMetricsUpdate, (update) => {
  if (update && update.conversationId === props.conversationId) {
    // Update last completion metrics
    if (metrics.value) {
      metrics.value.lastCompletion = update.metrics;
      
      console.log("recieved update");
      console.log(update);
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
      if (metrics.value.perModelMetrics && metrics.value.perModelMetrics[update.metrics.model]) {
        const perModelMetricTotals = metrics.value.perModelMetrics[update.metrics.model].totals;
        perModelMetricTotals.inputTokens += update.metrics.inputTokens;
        perModelMetricTotals.outputTokens += update.metrics.outputTokens;
        perModelMetricTotals.cachedTokens += update.metrics.cachedTokens;
        perModelMetricTotals.totalCost += update.metrics.cost;
        perModelMetricTotals.totalSavings += update.metrics.cacheSavings;
        perModelMetricTotals.completionCount += 1;
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
  if (!curModelMetrics.value?.lastCompletion) return 0;
  return curModelMetrics.value.lastCompletion.inputTokens + curModelMetrics.value.lastCompletion.outputTokens;
});

const totalTokens = computed(() => {
  if (!curModelMetrics.value?.totals) return 0;
  return curModelMetrics.value.totals.inputTokens + curModelMetrics.value.totals.outputTokens;
});

const cacheEfficiency = computed(() => {
  if (!curModelMetrics.value?.lastCompletion || curModelMetrics.value.lastCompletion.inputTokens === 0) return 0;
  return Math.round((curModelMetrics.value.lastCompletion.cachedTokens / curModelMetrics.value.lastCompletion.inputTokens) * 100);
});

const overallCacheEfficiency = computed(() => {
  if (!curModelMetrics.value?.totals || curModelMetrics.value.totals.inputTokens === 0) return 0;
  return Math.round((curModelMetrics.value.totals.cachedTokens / curModelMetrics.value.totals.inputTokens) * 100);
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
