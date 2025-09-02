<template>
  <div class="metrics-display">
    <div class="metrics-bar" @mouseenter="showDetails = true" @mouseleave="showDetails = false">
      <!-- Compact metrics in top bar -->
      <div class="metric-item">
        <Icon icon="mdi:cash-multiple" />
        <span class="metric-value">${{ formatCost(metrics?.totals?.totalCost || 0) }}</span>
      </div>
      
      <div class="metric-item">
        <Icon icon="mdi:cached" />
        <span class="metric-value">${{ formatCost(metrics?.totals?.totalSavings || 0) }} saved</span>
      </div>
      
      <div class="metric-item">
        <Icon icon="mdi:text-box-outline" />
        <span class="metric-value">{{ formatTokens(lastCompletionTokens) }}</span>
      </div>
      
      <div class="metric-item">
        <Icon icon="mdi:cog-outline" />
        <span class="metric-value">{{ metrics?.contextManagement?.strategy || 'append' }}</span>
      </div>
    </div>
    
    <!-- Detailed flyout panel -->
    <Transition name="slide-down">
      <div v-if="showDetails" class="metrics-details">
        <div class="details-section">
          <h4>Last Completion</h4>
          <div class="detail-row" v-if="metrics?.lastCompletion">
            <span>Model:</span>
            <span>{{ metrics.lastCompletion.model }}</span>
          </div>
          <div class="detail-row" v-if="metrics?.lastCompletion">
            <span>Input Tokens:</span>
            <span>{{ formatNumber(metrics.lastCompletion.inputTokens) }}</span>
          </div>
          <div class="detail-row" v-if="metrics?.lastCompletion">
            <span>Output Tokens:</span>
            <span>{{ formatNumber(metrics.lastCompletion.outputTokens) }}</span>
          </div>
          <div class="detail-row" v-if="metrics?.lastCompletion">
            <span>Cached Tokens:</span>
            <span>{{ formatNumber(metrics.lastCompletion.cachedTokens) }} 
              <span class="cache-percentage" v-if="metrics.lastCompletion.cachedTokens > 0">
                ({{ cacheEfficiency }}%)
              </span>
            </span>
          </div>
          <div class="detail-row" v-if="metrics?.lastCompletion">
            <span>Cost:</span>
            <span>${{ formatCost(metrics.lastCompletion.cost) }}</span>
          </div>
          <div class="detail-row" v-if="metrics?.lastCompletion">
            <span>Response Time:</span>
            <span>{{ (metrics.lastCompletion.responseTime / 1000).toFixed(1) }}s</span>
          </div>
        </div>
        
        <div class="details-section">
          <h4>Conversation Totals</h4>
          <div class="detail-row">
            <span>Messages:</span>
            <span>{{ metrics?.totals?.messageCount || 0 }}</span>
          </div>
          <div class="detail-row">
            <span>Total Tokens:</span>
            <span>{{ formatNumber(totalTokens) }}</span>
          </div>
          <div class="detail-row">
            <span>Cached Tokens:</span>
            <span>{{ formatNumber(metrics?.totals?.cachedTokens || 0) }}</span>
          </div>
          <div class="detail-row">
            <span>Total Cost:</span>
            <span>${{ formatCost(metrics?.totals?.totalCost || 0) }}</span>
          </div>
          <div class="detail-row">
            <span>Total Saved:</span>
            <span class="savings">${{ formatCost(metrics?.totals?.totalSavings || 0) }}</span>
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
      
      // Update totals
      if (metrics.value.totals) {
        metrics.value.totals.inputTokens += update.metrics.inputTokens;
        metrics.value.totals.outputTokens += update.metrics.outputTokens;
        metrics.value.totals.cachedTokens += update.metrics.cachedTokens;
        metrics.value.totals.totalCost += update.metrics.cost;
        metrics.value.totals.totalSavings += update.metrics.cacheSavings;
        metrics.value.totals.completionCount += 1;
      }
    }
  }
});

// Computed properties
const lastCompletionTokens = computed(() => {
  if (!metrics.value?.lastCompletion) return 0;
  return metrics.value.lastCompletion.inputTokens + metrics.value.lastCompletion.outputTokens;
});

const totalTokens = computed(() => {
  if (!metrics.value?.totals) return 0;
  return metrics.value.totals.inputTokens + metrics.value.totals.outputTokens;
});

const cacheEfficiency = computed(() => {
  if (!metrics.value?.lastCompletion || metrics.value.lastCompletion.inputTokens === 0) return 0;
  return Math.round((metrics.value.lastCompletion.cachedTokens / metrics.value.lastCompletion.inputTokens) * 100);
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
}

.metrics-bar {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.5rem 1rem;
  background-color: var(--color-surface);
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.metrics-bar:hover {
  background-color: var(--color-surface-hover);
}

.metric-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.metric-value {
  color: var(--color-text-secondary);
  font-weight: 500;
}

.metrics-details {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  min-width: 400px;
  z-index: 1000;
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
  color: var(--color-text-primary);
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.25rem 0;
  font-size: 0.875rem;
}

.detail-row span:first-child {
  color: var(--color-text-secondary);
}

.detail-row span:last-child {
  color: var(--color-text-primary);
  font-weight: 500;
}

.cache-percentage {
  color: var(--color-success);
  font-size: 0.75rem;
}

.savings {
  color: var(--color-success);
}

/* Transition */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.2s ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
