<template>
  <div class="conversation-tree-container">
    <div class="tree-controls pa-2">
      <v-btn
        icon="mdi-crosshairs-gps"
        size="small"
        variant="text"
        @click="centerOnNode"
        title="Center on current node"
      />
      <v-btn
        icon="mdi-fit-to-page-outline"
        size="small"
        variant="text"
        @click="centerTree"
        title="Fit entire tree in view"
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
      <v-btn
        :icon="compactMode ? 'mdi-arrow-expand-vertical' : 'mdi-arrow-collapse-vertical'"
        size="small"
        variant="text"
        @click="toggleCompactMode"
        :title="compactMode ? 'Show all nodes' : 'Compact view'"
      />
      <v-btn
        :icon="alignActivePath ? 'mdi-format-align-center' : 'mdi-format-align-left'"
        size="small"
        variant="text"
        @click="toggleAlignActivePath"
        :title="alignActivePath ? 'Default layout' : 'Align active path'"
        :color="alignActivePath ? 'primary' : undefined"
      />
      <v-btn
        :icon="collapseNonActive ? 'mdi-eye-off' : 'mdi-eye'"
        size="small"
        variant="text"
        @click="toggleCollapseNonActive"
        :title="collapseNonActive ? 'Show all branches' : 'Hide non-active branches'"
        :color="collapseNonActive ? 'primary' : undefined"
      />
    </div>
    <svg ref="svgRef" class="tree-svg"></svg>
    <div v-if="hoveredNode" class="node-tooltip" :style="tooltipStyle">
      <div class="text-caption font-weight-bold">
        <v-icon size="x-small">{{ hoveredNode.role === 'user' ? 'mdi-account' : 'mdi-robot' }}</v-icon>
        {{ hoveredNode.participantName }}
      </div>
      <div class="text-caption">{{ hoveredNode.preview }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import * as d3 from 'd3';
import type { Message, MessageBranch, Bookmark } from '@deprecated-claude/shared';
import { getModelColor } from '@/utils/modelColors';
import { api } from '@/services/api';
import { useStore } from '@/store';

const props = defineProps<{
  messages: Message[];
  participants?: any[]; // Participant type from shared
  currentMessageId?: string;
  currentBranchId?: string;
  selectedParentMessageId?: string;
  selectedParentBranchId?: string;
  readBranchIds?: Set<string>; // Branches user has seen
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
  bookmarkLabel?: string;
  children: TreeNode[];
}

const svgRef = ref<SVGElement>();
const hoveredNode = ref<TreeNode | null>(null);
const tooltipStyle = ref({ left: '0px', top: '0px' });
const compactMode = ref(false);
const compactModeManuallySet = ref(false); // Track if user manually toggled
const alignActivePath = ref(false); // Align active path ancestors vertically
const collapseNonActive = ref(false); // Hide nodes not on active path or immediate children of it
const nodesWithCollapsedDescendants = ref(new Set<string>()); // Track nodes that have hidden children
const store = useStore();
const bookmarks = ref<Bookmark[]>([]);
const lastTreeStructure = ref<string>(''); // Cache structure fingerprint to avoid re-renders during streaming

let svg: d3.Selection<SVGElement, unknown, null, undefined>;
let g: d3.Selection<SVGGElement, unknown, null, undefined>;
let zoom: d3.ZoomBehavior<SVGElement, unknown>;
let branchToMessageMap: Map<string, { message: Message, branch: MessageBranch }> = new Map();

const treeData = computed(() => {
  if (!props.messages || props.messages.length === 0) return null;
  
  // Build a map of branch ID to message for quick lookup
  branchToMessageMap.clear();
  for (const message of props.messages) {
    for (const branch of message.branches) {
      branchToMessageMap.set(branch.id, { message, branch });
    }
  }
  
  // Find root branches (those with no parent or parent === 'root')
  const rootBranches: TreeNode[] = [];
  const processedBranches = new Set<string>();
  
  // Build tree recursively
  function buildNode(branchId: string): TreeNode | null {
    if (processedBranches.has(branchId)) return null;
    processedBranches.add(branchId);
    
    const data = branchToMessageMap.get(branchId);
    if (!data) return null;
    
    const { message, branch } = data;
    const content = branch.content || '';
    const preview = content.slice(0, 100) + (content.length > 100 ? '...' : '');
    
    // Get participant name - similar to MessageComponent logic
    let participantName: string;
    
    if (props.participants && props.participants.length > 0 && branch.participantId) {
      // Look up participant by ID
      const participant = props.participants.find(p => p.id === branch.participantId);
      if (participant) {
        // If participant has empty name, show appropriate continuation format
        if (participant.name === '') {
          if (participant.type === 'assistant' && participant.model) {
            participantName = `${participant.model} (continue)`;
          } else {
            participantName = '(continue)';
          }
        } else {
          participantName = participant.name;
        }
      } else {
        // If we have participants but can't find this one, use role-based fallback
        participantName = branch.role === 'user' ? 'User' : (branch.model || 'Assistant');
      }
    } else if (branch.participantId && !props.participants) {
      // Participants not loaded yet - use role-based naming instead of showing ID
      participantName = branch.role === 'user' ? 'User' : (branch.model || 'Assistant');
    } else {
      // Standard conversation - use role-based naming
      participantName = branch.role === 'user' ? 'User' : (branch.model || 'Assistant');
    }
    
    // Find bookmark for this branch
    const bookmark = bookmarks.value.find(b =>
      b.messageId === message.id && b.branchId === branch.id
    );

    const node: TreeNode = {
      id: `${message.id}-${branch.id}`,
      messageId: message.id,
      branchId: branch.id,
      content,
      role: branch.role,
      participantName,
      preview,
      isActive: message.activeBranchId === branch.id,
      bookmarkLabel: bookmark?.label,
      children: []
    };
    
    // Find children (branches that have this branch as parent)
    for (const [childBranchId, childData] of branchToMessageMap) {
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

// Filter nodes for compact mode - only show branch points and leaves
function filterCompactNodes(originalRoot: d3.HierarchyNode<TreeNode>): d3.HierarchyNode<TreeNode> {
  // Build a simplified tree that collapses linear chains
  function simplifyNode(node: d3.HierarchyNode<TreeNode>): TreeNode | null {
    // Always keep the root
    if (!node.parent) {
      return {
        ...node.data,
        children: node.children ? node.children.map(c => simplifyNode(c)).filter(c => c !== null) as TreeNode[] : []
      };
    }
    
    // Always keep the selected parent node if it exists
    const isSelectedParent = props.selectedParentMessageId && props.selectedParentBranchId &&
                            node.data.messageId === props.selectedParentMessageId &&
                            node.data.branchId === props.selectedParentBranchId;

    // Always keep bookmarked nodes
    const isBookmarked = node.data.bookmarkLabel && node.data.bookmarkLabel.length > 0;

    const hasMultipleChildren = node.children && node.children.length > 1;
    const hasSiblings = node.parent.children && node.parent.children.length > 1;
    const isLeaf = !node.children || node.children.length === 0;

    // Keep this node if it's a decision point, leaf, bookmarked, or selected parent
    if (hasMultipleChildren || hasSiblings || isLeaf || isSelectedParent || isBookmarked) {
      return {
        ...node.data,
        children: node.children ? node.children.map(c => simplifyNode(c)).filter(c => c !== null) as TreeNode[] : []
      };
    }
    
    // This is a linear chain node with exactly one child - skip it
    if (node.children && node.children.length === 1) {
      // Skip this node and return its child instead
      return simplifyNode(node.children[0]);
    }
    
    return null;
  }
  
  const simplifiedTree = simplifyNode(originalRoot);
  if (!simplifiedTree) {
    // Shouldn't happen, but fallback to original
    return originalRoot;
  }
  
  return d3.hierarchy(simplifiedTree);
}

// Filter nodes to only show active path and immediate children of active path nodes
function filterToActivePath(originalRoot: d3.HierarchyNode<TreeNode>): d3.HierarchyNode<TreeNode> {
  // Clear the collapsed descendants tracker
  nodesWithCollapsedDescendants.value = new Set<string>();
  
  // First, build the active path set by tracing from current node to root
  const activePathIds = new Set<string>();
  
  function findActivePath(node: d3.HierarchyNode<TreeNode>): boolean {
    const nodeId = `${node.data.messageId}-${node.data.branchId}`;
    
    // Check if this is the current node
    if (node.data.messageId === props.currentMessageId && 
        node.data.branchId === props.currentBranchId) {
      activePathIds.add(nodeId);
      return true;
    }
    
    // Check children
    if (node.children) {
      for (const child of node.children) {
        if (findActivePath(child)) {
          activePathIds.add(nodeId);
          return true;
        }
      }
    }
    
    return false;
  }
  
  findActivePath(originalRoot);
  
  // Helper to count all descendants in original tree
  function countDescendants(node: d3.HierarchyNode<TreeNode>): number {
    if (!node.children || node.children.length === 0) return 0;
    return node.children.length + node.children.reduce((sum, c) => sum + countDescendants(c), 0);
  }
  
  // Now filter the tree
  function filterNode(node: d3.HierarchyNode<TreeNode>, parentOnActivePath: boolean): TreeNode | null {
    const nodeId = `${node.data.messageId}-${node.data.branchId}`;
    const isOnActivePath = activePathIds.has(nodeId);
    
    // Keep if: on active path OR immediate child of active path node
    if (isOnActivePath || parentOnActivePath) {
      // For children: only recurse if this node is on active path
      // (immediate children of active path are kept but their descendants are not)
      const filteredChildren = node.children 
        ? node.children
            .map(c => filterNode(c, isOnActivePath))
            .filter(c => c !== null) as TreeNode[]
        : [];
      
      // Check if this node has descendants that were filtered out
      const originalDescendantCount = countDescendants(node);
      const filteredDescendantCount = filteredChildren.reduce((sum, c) => {
        // Count children of filtered children (since we kept immediate children)
        const childInOriginal = node.children?.find(
          oc => oc.data.messageId === c.messageId && oc.data.branchId === c.branchId
        );
        return sum + 1 + (childInOriginal ? countDescendants(childInOriginal) : 0);
      }, 0);
      
      // If the node originally had children but now has fewer descendants, mark it
      if (node.children && node.children.length > 0) {
        // Check if any child has descendants that are now hidden
        for (const child of node.children) {
          const childId = `${child.data.messageId}-${child.data.branchId}`;
          const childDescendants = countDescendants(child);
          if (childDescendants > 0 && !activePathIds.has(childId)) {
            // This child has descendants that will be hidden
            nodesWithCollapsedDescendants.value.add(childId);
          }
        }
      }
      
      return {
        ...node.data,
        children: filteredChildren
      };
    }
    
    return null;
  }
  
  const filteredTree = filterNode(originalRoot, false);
  if (!filteredTree) {
    return originalRoot;
  }
  
  return d3.hierarchy(filteredTree);
}

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

function fillColor(d: d3.HierarchyPointNode<TreeNode>) {
  if (d.data.role === 'user') {
    return '#412961'; // Primary theme color for users
  }
  
  // For assistants, use model color
  // Try to get model from the branch data
  const branchData = branchToMessageMap.get(d.data.branchId);
  if (branchData) {
    const { branch } = branchData;
    
    // Try to get model from participant or branch
    let model: string | undefined;
    
    if (props.participants && branch.participantId) {
      const participant = props.participants.find(p => p.id === branch.participantId);
      model = participant?.model;
    }
    
    // Fallback to branch model
    if (!model) {
      model = branch.model;
    }
    
    return getModelColor(model);
  }
  
  return '#757575'; // Default grey
}

function hasBlueOutline(d: d3.HierarchyPointNode<TreeNode>) {
  return (props.selectedParentMessageId && props.selectedParentBranchId &&
         d.data.messageId === props.selectedParentMessageId &&
         d.data.branchId === props.selectedParentBranchId) ||
        (!props.selectedParentMessageId &&
         d.data.messageId === props.currentMessageId &&
         d.data.branchId === props.currentBranchId);
}

// STUBBED: Unread check disabled pending architecture review
function isUnread(d: d3.HierarchyPointNode<TreeNode>): boolean {
  return false;
}



function renderTree() {
  if (!g || !treeData.value) return;
  
  const width = svgRef.value?.clientWidth || 400;
  const height = svgRef.value?.clientHeight || 600;
  
  // Create hierarchy first
  const originalRoot = d3.hierarchy(treeData.value);
  
  // Auto-enable compact mode for large trees (30+ nodes)
  const totalNodes = originalRoot.descendants().length;
  if (totalNodes >= 30 && !compactModeManuallySet.value) {
    compactMode.value = true;
  }
  
  // Apply compact mode filtering if enabled
  let root = originalRoot;
  if (compactMode.value) {
    root = filterCompactNodes(originalRoot);
  }
  
  // Apply collapse non-active filtering if enabled
  if (collapseNonActive.value) {
    root = filterToActivePath(root);
  }
  
  // Count total nodes to determine sizing
  const nodeCount = root.descendants().length;
  
  // Dynamic node size based on tree size
  const baseNodeRadius = Math.max(10, Math.min(20, 400 / Math.sqrt(nodeCount)));
  
  // Create tree layout - vertical orientation
  const treeLayout = d3.tree<TreeNode>()
    .size([width - 100, height - 100])
    .nodeSize([baseNodeRadius * 3, baseNodeRadius * 4]); // Dynamic spacing
  
  let treeNodes = treeLayout(root);
  
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
  
  // Apply custom layout if active path alignment is enabled
  if (alignActivePath.value && activePath.size > 0) {
    // Simple approach: shift each level so the active path node at that level is at x=0
    // This preserves all relative spacing (no overlaps) while aligning the active path
    
    const targetX = 0;
    
    // Group nodes by depth
    const nodesByDepth = new Map<number, d3.HierarchyPointNode<TreeNode>[]>();
    let maxDepth = 0;
    for (const node of treeNodes.descendants()) {
      const depth = node.depth;
      maxDepth = Math.max(maxDepth, depth);
      if (!nodesByDepth.has(depth)) {
        nodesByDepth.set(depth, []);
      }
      nodesByDepth.get(depth)!.push(node);
    }
    
    // Track the last shift applied (for levels below the active path)
    let lastShift = 0;
    
    // For each depth level, find the active path node and calculate shift
    for (let depth = 0; depth <= maxDepth; depth++) {
      const nodes = nodesByDepth.get(depth);
      if (!nodes) continue;
      
      // Find the active path node at this depth
      const activeNode = nodes.find(node => {
        const nodeId = `${node.data.messageId}-${node.data.branchId}`;
        return activePath.has(nodeId);
      });
      
      if (activeNode) {
        // Calculate shift needed to move active node to targetX
        lastShift = targetX - activeNode.x;
      }
      // If no active node at this level, use the last shift (for levels below active path)
      
      // Apply shift to ALL nodes at this depth
      for (const node of nodes) {
        node.x += lastShift;
      }
    }
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
      return activePath.has(targetId) ? '#bb86fc' : '#757575';
    })
    .style('stroke-width', d => {
      const targetId = `${d.target.data.messageId}-${d.target.data.branchId}`;
      return activePath.has(targetId) ? 4 : 3;
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
    .attr('r', baseNodeRadius)
    .style('fill', d => {
      return '#757575'; // Default grey
    })
    .style('fill-opacity', d => {
      return 0.5;
    })
    .style('stroke', d => {
      // Outline based on selected parent or current position
      const nodeId = `${d.data.messageId}-${d.data.branchId}`;
    
      
      if (activePath.has(nodeId)) {
        return '#bb86fc'; // Active path - purple outline
      }
      return 'none';
    })
    .style('stroke-width', d => {
      
      return Math.max(2, baseNodeRadius / 5); // Normal thickness
    })
    .style('cursor', 'pointer')
    .on('click', (event, d) => {
      emit('navigate-to-branch', d.data.messageId, d.data.branchId);
    })
    .on('mouseenter', (event, d) => {
      hoveredNode.value = d.data;
      const [x, y] = d3.pointer(event, svgRef.value);
      
      // Get container dimensions
      const containerWidth = svgRef.value?.clientWidth || 400;
      const containerHeight = svgRef.value?.clientHeight || 600;
      
      // Estimate tooltip dimensions (max-width is 300px in CSS)
      const tooltipMaxWidth = 300;
      const tooltipEstimatedHeight = 80; // Approximate height for 2-3 lines of text
      
      // Calculate position with bounds checking
      let left = x + 10;
      let top = y - 10;
      
      // Check right boundary
      if (left + tooltipMaxWidth > containerWidth) {
        // Position to the left of the cursor instead
        left = x - tooltipMaxWidth - 10;
        // If that would go off the left edge, position at the right edge
        if (left < 0) {
          left = containerWidth - tooltipMaxWidth - 10;
        }
      }
      
      // Check bottom boundary
      if (top + tooltipEstimatedHeight > containerHeight) {
        // Position above the cursor instead
        top = y - tooltipEstimatedHeight - 10;
        // If that would go off the top edge, position at the bottom edge
        if (top < 0) {
          top = containerHeight - tooltipEstimatedHeight - 10;
        }
      }
      
      // Ensure we don't go off the left or top edges
      left = Math.max(10, left);
      top = Math.max(10, top);
      
      tooltipStyle.value = {
        left: `${left}px`,
        top: `${top}px`
      };
    })
    .on('mouseleave', () => {
      hoveredNode.value = null;
    });
  
  // Add icons using SVG paths instead of font icons
  const iconScale = baseNodeRadius / 20; // Scale icons based on node size
  node.each(function(d) {
    const g = d3.select(this);
    if (hasBlueOutline(d)) {
      // draw a larger blue circle
      g.append('circle')
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('r', baseNodeRadius * 1.5)
        .style('fill', 'none')
        .style('stroke', '#2196f3')
        .style('stroke-width', Math.max(2, baseNodeRadius / 5))
        .style('pointer-events', 'none');
    }
    
    if (d.data.role === 'user') {
      // User icon (simplified person shape)
      g.append('path')
        .attr('d', 'M -8,-8 A 8,8 0 0,1 8,-8 A 8,8 0 0,1 8,0 L 8,8 L -8,8 L -8,0 A 8,8 0 0,1 -8,-8')
        .attr('transform', `scale(${iconScale * 0.8})`)
        .style('fill', fillColor(d))
        .style('pointer-events', 'none');
    } else {
      // Robot icon (simplified robot shape)
      g.append('rect')
        .attr('x', -10 * iconScale)
        .attr('y', -10 * iconScale)
        .attr('width', 20 * iconScale)
        .attr('height', 20 * iconScale)
        .attr('rx', 4 * iconScale)
        .style('fill', fillColor(d))
        .style('pointer-events', 'none');
      
      // Robot eyes
      g.append('circle')
        .attr('cx', -5 * iconScale)
        .attr('cy', -3 * iconScale)
        .attr('r', 2 * iconScale)
        .style('fill', 'var(--v-theme-background)')
        .style('pointer-events', 'none');
      
      g.append('circle')
        .attr('cx', 5 * iconScale)
        .attr('cy', -3 * iconScale)
        .attr('r', 2 * iconScale)
        .style('fill', 'var(--v-theme-background)')
        .style('pointer-events', 'none');
    }

    // Add bookmark label if present
    if (d.data.bookmarkLabel) {
      const labelWidth = baseNodeRadius * 4; // Wider to better utilize the spacing
      const labelYOffset = baseNodeRadius + 2; // Position below the node

      // Get the participant color for this node
      const color = fillColor(d);

      // Use foreignObject to enable text wrapping
      const fo = g.append('foreignObject')
        .attr('x', -labelWidth / 2)
        .attr('y', labelYOffset)
        .attr('width', labelWidth)
        .attr('height', 100) // Max height for wrapped text
        .style('pointer-events', 'none');

      fo.append('xhtml:div')
        .style('width', '100%')
        .style('font-size', '11px')
        .style('font-weight', '600')
        .style('color', color)
        .style('text-align', 'center')
        .style('word-wrap', 'break-word')
        .style('overflow-wrap', 'break-word')
        .style('hyphens', 'auto')
        .style('line-height', '1.2')
        .text(d.data.bookmarkLabel);
    }
    
    // Add plus indicator for nodes with collapsed descendants
    if (collapseNonActive.value) {
      const nodeId = `${d.data.messageId}-${d.data.branchId}`;
      if (nodesWithCollapsedDescendants.value.has(nodeId)) {
        const plusSize = baseNodeRadius * 0.5;
        const plusOffset = baseNodeRadius * 0.9;

        // Draw a small circle background
        g.append('circle')
          .attr('cx', plusOffset)
          .attr('cy', plusOffset)
          .attr('r', plusSize * 0.9)
          .style('fill', 'var(--v-theme-surface)')
          .style('stroke', '#888')
          .style('stroke-width', 1)
          .style('pointer-events', 'none');

        // Draw plus sign
        g.append('path')
          .attr('d', `M ${plusOffset - plusSize * 0.5},${plusOffset}
                      L ${plusOffset + plusSize * 0.5},${plusOffset}
                      M ${plusOffset},${plusOffset - plusSize * 0.5}
                      L ${plusOffset},${plusOffset + plusSize * 0.5}`)
          .style('stroke', '#888')
          .style('stroke-width', Math.max(1.5, plusSize * 0.3))
          .style('stroke-linecap', 'round')
          .style('fill', 'none')
          .style('pointer-events', 'none');
      }
    }

    // Add unread indicator (notification dot) for unread branches
    if (isUnread(d)) {
      const dotSize = baseNodeRadius * 0.35;
      const dotOffset = baseNodeRadius * 0.7;

      // Draw an orange notification dot in the top-right
      g.append('circle')
        .attr('cx', dotOffset)
        .attr('cy', -dotOffset)
        .attr('r', dotSize)
        .style('fill', '#ff9800') // Orange/amber color
        .style('stroke', 'var(--v-theme-background)')
        .style('stroke-width', 1.5)
        .style('pointer-events', 'none');
    }
  });

  // Use smart centering: fit entire tree if small, center on node if large
  smartCenter();
}

// Minimum zoom scale threshold - if fitting the tree would zoom out below this, use centerOnNode instead
const MIN_AUTO_FIT_SCALE = 0.4;

// Preferred zoom scale when centering on a node
const CENTER_ON_NODE_SCALE = 0.8;

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

// Calculate what scale centerTree would use without actually applying it
function calculateFitScale(): number {
  if (!g || !svgRef.value) return 1;
  
  const bounds = (g.node() as SVGGElement).getBBox();
  const width = svgRef.value.clientWidth || 400;
  const height = svgRef.value.clientHeight || 600;
  
  const fullWidth = bounds.width;
  const fullHeight = bounds.height;
  
  return 0.9 / Math.max(fullWidth / width, fullHeight / height);
}

// Center view on the currently active/selected node
function centerOnNode() {
  if (!svg || !g || !treeData.value) return;
  
  const width = svgRef.value?.clientWidth || 400;
  const height = svgRef.value?.clientHeight || 600;
  
  // Find the active node (the one with blue outline)
  // Priority: selectedParent if exists, otherwise current message/branch
  let targetMessageId = props.selectedParentMessageId || props.currentMessageId;
  let targetBranchId = props.selectedParentBranchId || props.currentBranchId;
  
  if (!targetMessageId || !targetBranchId) return;
  
  // Find the node element in the SVG
  const nodes = g.selectAll('.node').data() as d3.HierarchyPointNode<TreeNode>[];
  const targetNode = nodes.find(d => 
    d.data.messageId === targetMessageId && 
    d.data.branchId === targetBranchId
  );
  
  if (!targetNode) {
    // Node not found, fall back to centerTree
    centerTree();
    return;
  }
  
  // Get node position (with the +50 offset that's applied in renderTree)
  const nodeX = targetNode.x + 50;
  const nodeY = targetNode.y + 50;
  
  // Determine zoom scale:
  // - If current scale is less than preferred, zoom in to preferred
  // - Otherwise maintain current scale
  const currentTransform = d3.zoomTransform(svg.node()!);
  const currentScale = currentTransform.k;
  const targetScale = Math.max(currentScale, CENTER_ON_NODE_SCALE);
  
  // Calculate translation to center the node
  const translate = [
    width / 2 - targetScale * nodeX,
    height / 2 - targetScale * nodeY
  ];
  
  svg.transition()
    .duration(750)
    .call(
      zoom.transform as any,
      d3.zoomIdentity.translate(translate[0], translate[1]).scale(targetScale)
    );
}

// Smart centering: center on node if tree is large, otherwise fit entire tree
function smartCenter() {
  if (!svg || !g || !treeData.value) return;
  
  const fitScale = calculateFitScale();
  
  if (fitScale < MIN_AUTO_FIT_SCALE) {
    // Tree is too large to fit nicely, center on current node instead
    centerOnNode();
  } else {
    // Tree is small enough, fit entire tree in view
    centerTree();
  }
}

function zoomIn() {
  if (!svg || !zoom) return;
  svg.transition().duration(300).call(zoom.scaleBy as any, 1.3);
}

function zoomOut() {
  if (!svg || !zoom) return;
  svg.transition().duration(300).call(zoom.scaleBy as any, 0.7);
}

function toggleCompactMode() {
  compactMode.value = !compactMode.value;
  compactModeManuallySet.value = true; // User has manually toggled
}

function toggleAlignActivePath() {
  alignActivePath.value = !alignActivePath.value;
}

function toggleCollapseNonActive() {
  collapseNonActive.value = !collapseNonActive.value;
}

// Load bookmarks
async function loadBookmarks() {
  try {
    const conversationId = store.state.currentConversation?.id;
    if (!conversationId) return;

    const response = await api.get(`/bookmarks/conversation/${conversationId}`);
    bookmarks.value = response.data;
  } catch (error) {
    console.error('Failed to load bookmarks:', error);
  }
}

// Generate a fingerprint of tree structure (IDs only, not content)
// This helps us avoid re-rendering during streaming when only content changes
function getTreeStructureFingerprint(): string {
  if (!props.messages || props.messages.length === 0) return '';
  
  // Build fingerprint from: message IDs, branch IDs, parent relationships, active branches
  const parts: string[] = [];
  for (const msg of props.messages) {
    parts.push(`m:${msg.id}:${msg.activeBranchId}`);
    for (const branch of msg.branches) {
      parts.push(`b:${branch.id}:${branch.parentBranchId || 'root'}`);
    }
  }
  // Include bookmarks
  parts.push(`bm:${bookmarks.value.map(b => b.id).join(',')}`);
  
  return parts.join('|');
}

// Check if structure changed and render if needed
function renderIfStructureChanged() {
  const newFingerprint = getTreeStructureFingerprint();
  if (newFingerprint !== lastTreeStructure.value) {
    lastTreeStructure.value = newFingerprint;
    renderTree();
  }
}

// Watch for selection/UI changes - render immediately (no debounce)
watch([
  () => props.currentMessageId,
  () => props.currentBranchId,
  () => props.selectedParentMessageId,
  () => props.selectedParentBranchId,
  () => props.participants,
  () => props.readBranchIds,
  bookmarks,
  compactMode,
  alignActivePath,
  collapseNonActive
], () => {
  renderTree(); // Immediate render for user interactions
});

// Watch for message changes separately - only render if structure changed
// This prevents re-renders during streaming (content-only updates)
watch(() => props.messages, () => {
  renderIfStructureChanged();
}, { deep: true });

// Reset manual flag when messages change significantly (new conversation)
watch(() => props.messages, (newMessages, oldMessages) => {
  // Reset if switching conversations (different first message ID or message count changed significantly)
  if (newMessages.length === 0 || 
      (oldMessages && oldMessages.length > 0 && newMessages.length > 0 && 
       newMessages[0].id !== oldMessages[0].id)) {
    compactModeManuallySet.value = false;
    compactMode.value = false; // Reset to default
  }
});

// Handle resize
let resizeObserver: ResizeObserver;

onMounted(async () => {
  await loadBookmarks();
  initializeTree();

  if (svgRef.value) {
    resizeObserver = new ResizeObserver(() => {
      initializeTree();
    });
    resizeObserver.observe(svgRef.value);
  }
});

// Reload bookmarks when conversation changes
watch(() => store.state.currentConversation?.id, async () => {
  await loadBookmarks();
});

onUnmounted(() => {
  if (resizeObserver && svgRef.value) {
    resizeObserver.unobserve(svgRef.value);
  }
});

// Expose loadBookmarks so parent can trigger reload
defineExpose({
  loadBookmarks
});
</script>

<style scoped>
.conversation-tree-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--v-theme-background);
  overflow: hidden; /* Prevent tooltip from causing overflow */
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
