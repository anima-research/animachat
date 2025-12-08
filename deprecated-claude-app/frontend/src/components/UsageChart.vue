<template>
  <div class="usage-chart-container">
    <div class="chart-header d-flex align-center justify-space-between mb-3">
      <div class="d-flex align-center">
        <v-icon class="mr-2" size="small">mdi-chart-line</v-icon>
        <span class="text-subtitle-2">{{ title }}</span>
      </div>
      <v-btn-toggle v-model="selectedRange" mandatory density="compact" variant="outlined">
        <v-btn value="7" size="x-small">7d</v-btn>
        <v-btn value="30" size="x-small">30d</v-btn>
        <v-btn value="90" size="x-small">90d</v-btn>
      </v-btn-toggle>
    </div>
    
    <div v-if="loading" class="d-flex align-center justify-center py-8">
      <v-progress-circular indeterminate color="primary" size="32" />
    </div>
    
    <template v-else-if="usageData">
      <!-- All Usage Stats (Personal API Keys) - Show first if available and different from credits -->
      <template v-if="usageData.allUsage && usageData.allUsage.totals.requests > 0">
        <div class="text-caption text-grey mb-2 d-flex align-center">
          <v-icon size="x-small" class="mr-1">mdi-api</v-icon>
          All API Usage (includes personal keys)
        </div>
        <div class="stats-row d-flex flex-wrap mb-3" style="gap: 12px;">
          <div class="stat-card">
            <div class="stat-value">{{ formatNumber(usageData.allUsage.totals.totalTokens) }}</div>
            <div class="stat-label">Total Tokens</div>
          </div>
          <div class="stat-card">
            <div class="stat-value text-primary">{{ formatNumber(usageData.allUsage.totals.inputTokens) }}</div>
            <div class="stat-label">Input</div>
          </div>
          <div class="stat-card">
            <div class="stat-value text-secondary">{{ formatNumber(usageData.allUsage.totals.outputTokens) }}</div>
            <div class="stat-label">Output</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{{ usageData.allUsage.totals.requests }}</div>
            <div class="stat-label">Requests</div>
          </div>
        </div>
        
        <!-- Chart for all usage -->
        <div ref="chartContainer" class="chart-svg-container mb-4"></div>
        
        <!-- Model breakdown for all usage -->
        <div v-if="showModelBreakdown && Object.keys(usageData.allUsage.byModel).length > 0" class="mb-4">
          <div class="text-caption text-grey mb-2">By Model (All Usage)</div>
          <div class="model-breakdown">
            <div 
              v-for="(data, model) in sortedAllModels" 
              :key="model" 
              class="model-row d-flex align-center justify-space-between py-1"
            >
              <span class="text-body-2 model-name">{{ model }}</span>
              <div class="d-flex align-center model-stats">
                <span class="text-caption text-grey">{{ formatNumber(data.totalTokens) }} tok</span>
                <span class="text-caption text-grey">({{ formatNumber(data.cachedTokens) }} cached)</span>
                <span class="text-caption">{{ data.requests }} req</span>
                <span class="text-caption text-warning font-weight-medium">${{ formatCost(data.cost) }}</span>
              </div>
            </div>
          </div>
        </div>
        
        <v-divider class="my-4" />
      </template>
      
      <!-- Credit Usage Stats -->
      <div class="text-caption text-grey mb-2 d-flex align-center">
        <v-icon size="x-small" class="mr-1">mdi-currency-usd</v-icon>
        Credit Usage (platform credits)
      </div>
      <div class="stats-row d-flex flex-wrap mb-4" style="gap: 12px;">
        <div class="stat-card">
          <div class="stat-value">{{ formatNumber(usageData.totals.totalTokens) }}</div>
          <div class="stat-label">Total Tokens</div>
        </div>
        <div class="stat-card">
          <div class="stat-value text-primary">{{ formatNumber(usageData.totals.inputTokens) }}</div>
          <div class="stat-label">Input</div>
        </div>
        <div class="stat-card">
          <div class="stat-value text-secondary">{{ formatNumber(usageData.totals.outputTokens) }}</div>
          <div class="stat-label">Output</div>
        </div>
        <div class="stat-card">
          <div class="stat-value text-success">{{ formatNumber(usageData.totals.cachedTokens) }}</div>
          <div class="stat-label">Cached</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ usageData.totals.requests }}</div>
          <div class="stat-label">Requests</div>
        </div>
        <div class="stat-card">
          <div class="stat-value text-warning">{{ formatCost(usageData.totals.cost) }}</div>
          <div class="stat-label">Credits Used</div>
        </div>
      </div>
      
      <!-- Chart for credit usage (only if no allUsage shown above) -->
      <div v-if="!usageData.allUsage || usageData.allUsage.totals.requests === 0" ref="chartContainer" class="chart-svg-container"></div>
      
      <!-- Model breakdown for credits -->
      <div v-if="showModelBreakdown && Object.keys(usageData.byModel).length > 0" class="mt-4">
        <div class="text-caption text-grey mb-2">By Model (Credits)</div>
        <div class="model-breakdown">
          <div 
            v-for="(data, model) in sortedModels" 
            :key="model" 
            class="model-row d-flex align-center justify-space-between py-1"
          >
            <span class="text-body-2 model-name">{{ model }}</span>
            <div class="d-flex align-center model-stats">
              <span class="text-caption text-grey">{{ formatNumber(data.totalTokens) }} tok</span>
              <span class="text-caption text-grey">({{ formatNumber(data.cachedTokens) }} cached)</span>
              <span class="text-caption">{{ data.requests }} req</span>
              <span class="text-caption text-warning font-weight-medium">${{ formatCost(data.cost) }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
    
    <div v-else class="text-center text-grey py-8">
      <v-icon size="48" class="mb-2 opacity-50">mdi-chart-line-variant</v-icon>
      <div>No usage data available</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import * as d3 from 'd3';

interface UsageDataPoint {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  cost: number;
  requests: number;
}

interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  cost: number;
  requests: number;
}

interface UsageStats {
  daily: UsageDataPoint[];
  totals: UsageTotals;
  byModel: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cost: number;
    requests: number;
  }>;
  // Total usage including personal API keys
  allUsage?: {
    daily: UsageDataPoint[];
    totals: UsageTotals;
    byModel: Record<string, {
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      cost: number;
      requests: number;
    }>;
  };
}

const props = withDefaults(defineProps<{
  title?: string;
  fetchUrl: string;
  showModelBreakdown?: boolean;
}>(), {
  title: 'Token Usage',
  showModelBreakdown: true
});

const loading = ref(false);
const usageData = ref<UsageStats | null>(null);
const selectedRange = ref('30');
const chartContainer = ref<HTMLElement | null>(null);

const sortedModels = computed(() => {
  if (!usageData.value?.byModel) return {};
  
  const entries = Object.entries(usageData.value.byModel)
    .map(([model, data]) => ({
      model,
      ...data,
      totalTokens: data.inputTokens + data.outputTokens
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
  
  const result: Record<string, typeof entries[0]> = {};
  for (const entry of entries) {
    result[entry.model] = entry;
  }
  return result;
});

const sortedAllModels = computed(() => {
  if (!usageData.value?.allUsage?.byModel) return {};
  
  const entries = Object.entries(usageData.value.allUsage.byModel)
    .map(([model, data]) => ({
      model,
      ...data,
      totalTokens: data.inputTokens + data.outputTokens
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
  
  const result: Record<string, typeof entries[0]> = {};
  for (const entry of entries) {
    result[entry.model] = entry;
  }
  return result;
});

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1) + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1) + 'K';
  }
  return num.toLocaleString();
}

function formatCost(cost: number): string {
  return cost.toFixed(2);
}

function fillMissingDays(data: UsageDataPoint[], days: number): UsageDataPoint[] {
  if (data.length === 0) return [];
  
  const filledData: UsageDataPoint[] = [];
  const dataMap = new Map(data.map(d => [d.date, d]));
  
  // Generate all dates in range
  const endDate = new Date();
  endDate.setHours(0, 0, 0, 0);
  const startDate = new Date(endDate.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const existing = dataMap.get(dateStr);
    
    if (existing) {
      filledData.push(existing);
    } else {
      filledData.push({
        date: dateStr,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        totalTokens: 0,
        cost: 0,
        requests: 0
      });
    }
  }
  
  return filledData;
}

async function fetchData() {
  loading.value = true;
  try {
    const token = localStorage.getItem('token');
    const url = `${props.fetchUrl}?days=${selectedRange.value}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch usage data');
    }
    
    usageData.value = await response.json();
    // Wait for DOM to update, then render
    await nextTick();
    // Additional delay to ensure container has layout
    setTimeout(() => {
      setupResizeObserver();
      renderChart();
    }, 50);
  } catch (error) {
    console.error('Error fetching usage data:', error);
    usageData.value = null;
  } finally {
    loading.value = false;
  }
}

function renderChart() {
  if (!chartContainer.value) return;
  
  // Clear previous chart
  d3.select(chartContainer.value).selectAll('*').remove();
  
  // Use allUsage data if available, otherwise fall back to credit usage
  const sourceData = usageData.value?.allUsage?.daily?.length 
    ? usageData.value.allUsage 
    : usageData.value;
  
  const containerWidth = chartContainer.value.clientWidth;
  if (containerWidth <= 0) return;
  
  // Fill in missing days for continuous chart
  const rawData = sourceData?.daily || [];
  const data = fillMissingDays(rawData, parseInt(selectedRange.value));
  
  if (data.length === 0) {
    // Show empty state
    d3.select(chartContainer.value)
      .append('div')
      .style('text-align', 'center')
      .style('padding', '60px 20px')
      .style('color', '#666')
      .text('No usage data for this period');
    return;
  }
  
  const margin = { top: 20, right: 30, bottom: 40, left: 60 };
  const width = containerWidth - margin.left - margin.right;
  const height = 200 - margin.top - margin.bottom;
  
  const svg = d3.select(chartContainer.value)
    .append('svg')
    .attr('width', containerWidth)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);
  
  // Parse dates
  const parseDate = d3.timeParse('%Y-%m-%d');
  const chartData = data.map(d => ({
    ...d,
    dateObj: parseDate(d.date) || new Date(d.date)
  }));
  
  // Scales
  const x = d3.scaleTime()
    .domain(d3.extent(chartData, d => d.dateObj) as [Date, Date])
    .range([0, width]);
  
  const maxTokens = d3.max(chartData, d => d.inputTokens + d.outputTokens) || 1;
  const y = d3.scaleLinear()
    .domain([0, maxTokens * 1.1])
    .range([height, 0]);
  
  // Grid lines
  svg.append('g')
    .attr('class', 'grid')
    .attr('opacity', 0.1)
    .call(d3.axisLeft(y)
      .tickSize(-width)
      .tickFormat(() => '')
    );
  
  // Area for output tokens (stacked on top of input)
  const areaOutput = d3.area<typeof chartData[0]>()
    .x(d => x(d.dateObj))
    .y0(d => y(d.inputTokens))
    .y1(d => y(d.inputTokens + d.outputTokens))
    .curve(d3.curveMonotoneX);
  
  svg.append('path')
    .datum(chartData)
    .attr('fill', '#03DAC6')
    .attr('fill-opacity', 0.6)
    .attr('d', areaOutput);
  
  // Area for input tokens
  const areaInput = d3.area<typeof chartData[0]>()
    .x(d => x(d.dateObj))
    .y0(height)
    .y1(d => y(d.inputTokens))
    .curve(d3.curveMonotoneX);
  
  svg.append('path')
    .datum(chartData)
    .attr('fill', '#BB86FC')
    .attr('fill-opacity', 0.6)
    .attr('d', areaInput);
  
  // Line for total
  const line = d3.line<typeof chartData[0]>()
    .x(d => x(d.dateObj))
    .y(d => y(d.inputTokens + d.outputTokens))
    .curve(d3.curveMonotoneX);
  
  svg.append('path')
    .datum(chartData)
    .attr('fill', 'none')
    .attr('stroke', '#fff')
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0.8)
    .attr('d', line);
  
  // X axis
  svg.append('g')
    .attr('transform', `translate(0,${height})`)
    .attr('class', 'axis-x')
    .call(d3.axisBottom(x)
      .ticks(Math.min(chartData.length, 7))
      .tickFormat(d3.timeFormat('%b %d') as any)
    )
    .selectAll('text')
    .attr('fill', '#888')
    .attr('font-size', '10px');
  
  // Y axis
  svg.append('g')
    .attr('class', 'axis-y')
    .call(d3.axisLeft(y)
      .ticks(5)
      .tickFormat(d => formatNumber(d as number))
    )
    .selectAll('text')
    .attr('fill', '#888')
    .attr('font-size', '10px');
  
  // Style axis lines
  svg.selectAll('.domain').attr('stroke', '#333');
  svg.selectAll('.tick line').attr('stroke', '#333');
  
  // Legend
  const legend = svg.append('g')
    .attr('transform', `translate(${width - 100}, 0)`);
  
  legend.append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', 12)
    .attr('height', 12)
    .attr('fill', '#BB86FC')
    .attr('fill-opacity', 0.6);
  
  legend.append('text')
    .attr('x', 16)
    .attr('y', 10)
    .attr('fill', '#888')
    .attr('font-size', '10px')
    .text('Input');
  
  legend.append('rect')
    .attr('x', 50)
    .attr('y', 0)
    .attr('width', 12)
    .attr('height', 12)
    .attr('fill', '#03DAC6')
    .attr('fill-opacity', 0.6);
  
  legend.append('text')
    .attr('x', 66)
    .attr('y', 10)
    .attr('fill', '#888')
    .attr('font-size', '10px')
    .text('Output');
}

// Watch for range changes
watch(selectedRange, () => {
  fetchData();
});

// Watch for chart container becoming available
watch(chartContainer, (newContainer) => {
  if (newContainer && usageData.value) {
    setupResizeObserver();
    // Small delay to ensure container has layout dimensions
    setTimeout(() => renderChart(), 50);
  }
});

// Handle resize
let resizeObserver: ResizeObserver | null = null;

function setupResizeObserver() {
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
  if (chartContainer.value) {
    resizeObserver = new ResizeObserver(() => {
      renderChart();
    });
    resizeObserver.observe(chartContainer.value);
  }
}

onMounted(() => {
  fetchData();
});

onUnmounted(() => {
  resizeObserver?.disconnect();
});

// Expose refresh method
defineExpose({
  refresh: fetchData
});
</script>

<style scoped>
.usage-chart-container {
  background: rgba(255, 255, 255, 0.02);
  border-radius: 8px;
  padding: 16px;
}

.stats-row {
  display: flex;
  flex-wrap: wrap;
}

.stat-card {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  padding: 8px 12px;
  min-width: 80px;
  flex: 1;
}

.stat-value {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.2;
}

.stat-label {
  font-size: 11px;
  color: #888;
  margin-top: 2px;
}

.chart-svg-container {
  width: 100%;
  min-height: 200px;
}

.model-breakdown {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  padding: 8px 12px;
  max-height: 250px;
  overflow-y: auto;
}

.model-row {
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  flex-wrap: wrap;
}

.model-row:last-child {
  border-bottom: none;
}

.model-name {
  flex: 1;
  min-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-stats {
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.model-stats > span {
  white-space: nowrap;
}

:deep(.axis-x .domain),
:deep(.axis-y .domain) {
  stroke: #333;
}

:deep(.axis-x .tick line),
:deep(.axis-y .tick line) {
  stroke: #333;
}
</style>

