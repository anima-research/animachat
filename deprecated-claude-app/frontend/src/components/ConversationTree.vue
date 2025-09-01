<template>
  <div class="conversation-tree-container">
    <div class="tree-controls pa-2">
      <v-btn
        icon="mdi-fit-to-page-outline"
        size="small"
        variant="text"
        @click="centerTree"
        title="Center view"
      />
      <v-btn
        icon="mdi-magnify-plus"
        size="small"
        variant="text"
        @click="zoomIn"
        title="Zoom in"
      />
      <v-btn
        icon="mdi-magnify-minus"
        size="small"
        variant="text"
        @click="zoomOut"
        title="Zoom out"
      />
    </div>
    <svg ref="svgRef" class="tree-svg"></svg>
    <div v-if="hoveredNode" class="node-tooltip" :style="tooltipStyle">
      <div class="text-caption font-weight-bold">
        <v-icon size="x-small">{{ hoveredNode.role === 'user' ? 'mdi-account' : 'mdi-robot' }}</v-icon>
        {{ hoveredNode.participantName || (hoveredNode.role === 'user' ? 'User' : 'Assistant') }}
      </div>
      <div class="text-caption">{{ hoveredNode.preview }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import * as d3 from 'd3';
import type { Message, MessageBranch } from '@deprecated-claude/shared';

const props = defineProps<{
  messages: Message[];
  currentMessageId?: string;
  currentBranchId?: string;
}>();

const emit = defineEmits<{
  'navigate-to-branch': [messageId: string, branchId: string];
}>();

interface TreeNode {
  id: string;
  messageId: string;
  branchId: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  participantName?: string;
  preview: string;
  isActive: boolean;
  children: TreeNode[];
}

const svgRef = ref<SVGElement>();
const hoveredNode = ref<TreeNode | null>(null);
const tooltipStyle = ref({ left: '0px', top: '0px' });

let svg: d3.Selection<SVGElement, unknown, null, undefined>;
let g: d3.Selection<SVGGElement, unknown, null, undefined>;
let zoom: d3.ZoomBehavior<SVGElement, unknown>;

const treeData = computed(() => {
  if (!props.messages || props.messages.length === 0) return null;
  
  // Build a map of branch ID to message for quick lookup
  const branchToMessage = new Map<string, { message: Message, branch: MessageBranch }>();
  for (const message of props.messages) {
    for (const branch of message.branches) {
      branchToMessage.set(branch.id, { message, branch });
    }
  }
  
  // Find root branches (those with no parent or parent === 'root')
  const rootBranches: TreeNode[] = [];
  const processedBranches = new Set<string>();
  
  // Build tree recursively
  function buildNode(branchId: string): TreeNode | null {
    if (processedBranches.has(branchId)) return null;
    processedBranches.add(branchId);
    
    const data = branchToMessage.get(branchId);
    if (!data) return null;
    
    const { message, branch } = data;
    const content = branch.content || '';
    const preview = content.slice(0, 50) + (content.length > 50 ? '...' : '');
    
    const node: TreeNode = {
      id: `${message.id}-${branch.id}`,
      messageId: message.id,
      branchId: branch.id,
      content,
      role: branch.role,
      participantName: branch.participantName,
      preview,
      isActive: message.activeBranchId === branch.id,
      children: []
    };
    
    // Find children (branches that have this branch as parent)
    for (const [childBranchId, childData] of branchToMessage) {
      if (childData.branch.parentBranchId === branchId) {
        const childNode = buildNode(childBranchId);
        if (childNode) {
          node.children.push(childNode);
        }
      }
    }
    
    return node;
  }
  
  // Build tree from root branches
  for (const message of props.messages) {
    for (const branch of message.branches) {
      if (!branch.parentBranchId || branch.parentBranchId === 'root') {
        const node = buildNode(branch.id);
        if (node) {
          rootBranches.push(node);
        }
      }
    }
  }
  
  // Return single root or create virtual root for multiple roots
  if (rootBranches.length === 1) {
    return rootBranches[0];
  } else if (rootBranches.length > 1) {
    return {
      id: 'virtual-root',
      messageId: '',
      branchId: '',
      content: '',
      role: 'system' as const,
      preview: 'Conversation Start',
      isActive: false,
      children: rootBranches
    };
  }
  
  return null;
});

function initializeTree() {
  if (!svgRef.value || !treeData.value) return;
  
  const width = svgRef.value.clientWidth || 400;
  const height = svgRef.value.clientHeight || 600;
  
  // Clear existing content
  d3.select(svgRef.value).selectAll('*').remove();
  
  svg = d3.select(svgRef.value)
    .attr('width', width)
    .attr('height', height);
  
  g = svg.append('g');
  
  // Set up zoom behavior
  zoom = d3.zoom<SVGElement, unknown>()
    .scaleExtent([0.1, 3])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });
  
  svg.call(zoom);
  
  renderTree();
}

function renderTree() {
  if (!g || !treeData.value) return;
  
  const width = svgRef.value?.clientWidth || 400;
  const height = svgRef.value?.clientHeight || 600;
  
  // Create tree layout
  const treeLayout = d3.tree<TreeNode>()
    .size([height - 100, width - 100]);
  
  // Create hierarchy
  const root = d3.hierarchy(treeData.value);
  const treeNodes = treeLayout(root);
  
  // Clear previous render
  g.selectAll('*').remove();
  
  // Add links (edges)
  g.selectAll('.link')
    .data(treeNodes.links())
    .enter()
    .append('path')
    .attr('class', 'link')
    .attr('d', d3.linkHorizontal<any, any>()
      .x(d => d.y + 50)
      .y(d => d.x + 50)
    )
    .style('fill', 'none')
    .style('stroke', '#ccc')
    .style('stroke-width', 2);
  
  // Add nodes
  const node = g.selectAll('.node')
    .data(treeNodes.descendants())
    .enter()
    .append('g')
    .attr('class', 'node')
    .attr('transform', d => `translate(${d.y + 50},${d.x + 50})`);
  
  // Add circles for nodes
  node.append('circle')
    .attr('r', 20)
    .style('fill', d => {
      const nodeData = d.data;
      if (nodeData.messageId === props.currentMessageId && 
          nodeData.branchId === props.currentBranchId) {
        return '#1976d2'; // Current node - primary color
      }
      if (nodeData.isActive) {
        return '#4caf50'; // Active branch - green
      }
      return nodeData.role === 'user' ? '#9c27b0' : '#757575'; // Purple for user, grey for assistant
    })
    .style('cursor', 'pointer')
    .on('click', (event, d) => {
      emit('navigate-to-branch', d.data.messageId, d.data.branchId);
    })
    .on('mouseenter', (event, d) => {
      hoveredNode.value = d.data;
      const [x, y] = d3.pointer(event, svgRef.value);
      tooltipStyle.value = {
        left: `${x + 10}px`,
        top: `${y - 10}px`
      };
    })
    .on('mouseleave', () => {
      hoveredNode.value = null;
    });
  
  // Add icons
  node.append('text')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .style('fill', 'white')
    .style('font-family', 'Material Design Icons')
    .style('font-size', '20px')
    .style('pointer-events', 'none')
    .text(d => d.data.role === 'user' ? '\uF0004' : '\uF0599'); // MDI account and robot icons
  
  // Center the tree initially
  centerTree();
}

function centerTree() {
  if (!svg || !g || !treeData.value) return;
  
  const bounds = (g.node() as SVGGElement).getBBox();
  const width = svgRef.value?.clientWidth || 400;
  const height = svgRef.value?.clientHeight || 600;
  
  const fullWidth = bounds.width;
  const fullHeight = bounds.height;
  const midX = bounds.x + fullWidth / 2;
  const midY = bounds.y + fullHeight / 2;
  
  const scale = 0.9 / Math.max(fullWidth / width, fullHeight / height);
  const translate = [width / 2 - scale * midX, height / 2 - scale * midY];
  
  svg.transition()
    .duration(750)
    .call(
      zoom.transform as any,
      d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
    );
}

function zoomIn() {
  if (!svg || !zoom) return;
  svg.transition().duration(300).call(zoom.scaleBy as any, 1.3);
}

function zoomOut() {
  if (!svg || !zoom) return;
  svg.transition().duration(300).call(zoom.scaleBy as any, 0.7);
}

// Watch for changes and re-render
watch([() => props.messages, () => props.currentMessageId, () => props.currentBranchId], () => {
  renderTree();
}, { deep: true });

// Handle resize
let resizeObserver: ResizeObserver;

onMounted(() => {
  initializeTree();
  
  if (svgRef.value) {
    resizeObserver = new ResizeObserver(() => {
      initializeTree();
    });
    resizeObserver.observe(svgRef.value);
  }
});

onUnmounted(() => {
  if (resizeObserver && svgRef.value) {
    resizeObserver.unobserve(svgRef.value);
  }
});
</script>

<style scoped>
.conversation-tree-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--v-theme-background);
}

.tree-controls {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 10;
  background: rgba(var(--v-theme-surface), 0.9);
  border-radius: 4px;
  display: flex;
  gap: 4px;
}

.tree-svg {
  width: 100%;
  height: 100%;
}

.node-tooltip {
  position: absolute;
  background: var(--v-theme-surface);
  border: 1px solid rgba(0, 0, 0, 0.1);
  padding: 8px;
  border-radius: 4px;
  pointer-events: none;
  z-index: 20;
  max-width: 300px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}
</style>
