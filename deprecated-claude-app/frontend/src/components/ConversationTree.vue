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
  
  // Create tree layout - vertical orientation
  const treeLayout = d3.tree<TreeNode>()
    .size([width - 100, height - 100]);
  
  // Create hierarchy
  const root = d3.hierarchy(treeData.value);
  const treeNodes = treeLayout(root);
  
  // Clear previous render
  g.selectAll('*').remove();
  
  // Determine which branches are in the active path
  const activePath = new Set<string>();
  let currentNode = treeNodes.descendants().find(d => 
    d.data.messageId === props.currentMessageId && 
    d.data.branchId === props.currentBranchId
  );
  
  // Trace back to root to find active path
  while (currentNode) {
    activePath.add(`${currentNode.data.messageId}-${currentNode.data.branchId}`);
    currentNode = currentNode.parent;
  }
  
  // Add links (edges) - vertical links
  g.selectAll('.link')
    .data(treeNodes.links())
    .enter()
    .append('path')
    .attr('class', 'link')
    .attr('d', d3.linkVertical<any, any>()
      .x(d => d.x + 50)
      .y(d => d.y + 50)
    )
    .style('fill', 'none')
    .style('stroke', d => {
      // Color edges based on whether they're in the active path
      const targetId = `${d.target.data.messageId}-${d.target.data.branchId}`;
      return activePath.has(targetId) ? '#4caf50' : '#ccc';
    })
    .style('stroke-width', d => {
      const targetId = `${d.target.data.messageId}-${d.target.data.branchId}`;
      return activePath.has(targetId) ? 3 : 2;
    });
  
  // Add nodes
  const node = g.selectAll('.node')
    .data(treeNodes.descendants())
    .enter()
    .append('g')
    .attr('class', 'node')
    .attr('transform', d => `translate(${d.x + 50},${d.y + 50})`);
  
  // Add circles for nodes with outlines
  node.append('circle')
    .attr('r', 20)
    .style('fill', d => {
      // Node fill based on role only
      return d.data.role === 'user' ? '#9c27b0' : '#757575';
    })
    .style('stroke', d => {
      // Outline based on current position and active path
      const nodeId = `${d.data.messageId}-${d.data.branchId}`;
      if (d.data.messageId === props.currentMessageId && 
          d.data.branchId === props.currentBranchId) {
        return '#1976d2'; // Current position - blue outline
      }
      if (activePath.has(nodeId)) {
        return '#4caf50'; // Active path - green outline
      }
      return 'none';
    })
    .style('stroke-width', 4)
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
  
  // Add icons using SVG paths instead of font icons
  const iconSize = 24;
  node.each(function(d) {
    const g = d3.select(this);
    
    if (d.data.role === 'user') {
      // User icon (simplified person shape)
      g.append('path')
        .attr('d', 'M -8,-8 A 8,8 0 0,1 8,-8 A 8,8 0 0,1 8,0 L 8,8 L -8,8 L -8,0 A 8,8 0 0,1 -8,-8')
        .attr('transform', 'scale(0.8)')
        .style('fill', 'white')
        .style('pointer-events', 'none');
    } else {
      // Robot icon (simplified robot shape)
      g.append('rect')
        .attr('x', -10)
        .attr('y', -10)
        .attr('width', 20)
        .attr('height', 20)
        .attr('rx', 4)
        .style('fill', 'white')
        .style('pointer-events', 'none');
      
      // Robot eyes
      g.append('circle')
        .attr('cx', -5)
        .attr('cy', -3)
        .attr('r', 2)
        .style('fill', '#757575')
        .style('pointer-events', 'none');
      
      g.append('circle')
        .attr('cx', 5)
        .attr('cy', -3)
        .attr('r', 2)
        .style('fill', '#757575')
        .style('pointer-events', 'none');
    }
  });
  
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
