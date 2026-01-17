<template>
  <div 
    class="event-history-panel" 
    :class="{ 'mobile-overlay': isMobile }"
  >
    <div class="panel-header">
      <h3>Event History</h3>
      <v-btn 
        icon="mdi-close" 
        size="small" 
        variant="text"
        @click="$emit('close')"
      />
    </div>
    
    <div class="panel-content">
      <!-- Unread Section -->
      <div v-if="unreadBranches.length > 0" class="unread-section">
        <div class="section-header">
          <span class="section-title">
            <v-icon size="14" color="warning" class="mr-1">mdi-circle</v-icon>
            Unread ({{ unreadBranches.length }})
          </span>
          <v-btn
            size="x-small"
            variant="text"
            color="warning"
            @click="markAllAsRead"
          >
            Mark all read
          </v-btn>
        </div>
        <div class="unread-list">
          <div
            v-for="branch in unreadBranches"
            :key="branch.branchId"
            class="unread-item"
            @click="handleUnreadClick(branch)"
          >
            <div class="unread-icon">
              <v-icon size="16" color="warning">
                {{ branch.role === 'user' ? 'mdi-account' : 'mdi-robot' }}
              </v-icon>
            </div>
            <div class="unread-content">
              <div class="unread-header">
                <span class="unread-name">{{ getUnreadBranchName(branch) }}</span>
                <span class="unread-time">{{ formatTime(branch.createdAt) }}</span>
              </div>
              <div v-if="branch.content" class="unread-preview">
                {{ branch.content.slice(0, 80) }}{{ branch.content.length > 80 ? '...' : '' }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- History Section -->
      <div v-if="unreadBranches.length > 0 && events.length > 0" class="section-header history-header">
        <span class="section-title">
          <v-icon size="14" class="mr-1">mdi-history</v-icon>
          History
        </span>
      </div>

      <div v-if="loading" class="loading-state">
        <v-progress-circular indeterminate size="24" />
      </div>

      <div v-else-if="events.length === 0 && unreadBranches.length === 0" class="empty-state">
        <v-icon size="32" color="grey">mdi-history</v-icon>
        <p>No events yet</p>
      </div>

      <div v-else-if="events.length > 0" class="events-list">
        <div 
          v-for="(event, index) in events" 
          :key="index"
          class="event-item"
          :class="{ clickable: isClickable(event) }"
          @click="handleEventClick(event)"
        >
          <div class="event-icon">
            <v-icon size="16" :color="getEventColor(event.type)">
              {{ getEventIcon(event.type) }}
            </v-icon>
          </div>
          
          <div class="event-content">
            <div class="event-description">
              {{ getEventDescription(event) }}
            </div>
            <div v-if="getMessagePreview(event)" class="event-preview">
              {{ getMessagePreview(event) }}
            </div>
            <div class="event-meta">
              <span class="event-time">{{ formatTime(event.timestamp) }}</span>
              <v-btn
                v-if="canRestore(event)"
                size="x-small"
                variant="text"
                color="warning"
                class="restore-btn"
                @click.stop="handleRestore(event)"
                :loading="restoringEventId === getEventId(event)"
              >
                <v-icon size="12" class="mr-1">mdi-undo</v-icon>
                Restore
              </v-btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { api } from '@/services/api';
import { useStore } from '@/store';

interface ConversationEvent {
  type: string;
  timestamp: string;
  data: any;
  userName?: string;
  role?: string;
  messageId?: string;
  branchId?: string;
  participantName?: string;
}

interface UnreadBranch {
  messageId: string;
  branchId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  participantId?: string;
  participantName?: string;
  model?: string;
  createdAt: string;
}

const props = defineProps<{
  conversationId: string;
  isMobile: boolean;
}>();

const emit = defineEmits<{
  close: [];
  navigateToMessage: [messageId: string, branchId?: string];
}>();

const events = ref<ConversationEvent[]>([]);
const loading = ref(true);

// Event types to filter out (too noisy or not meaningful to users)
const noisyEventTypes = new Set([
  'message_content_updated',
  'message_branch_updated',
  'active_branch_changed'
]);

async function loadEvents() {
  if (!props.conversationId) return;
  
  loading.value = true;
  try {
    const response = await api.get(`/conversations/${props.conversationId}/events`);
    // Filter out noisy events and reverse to show newest first
    events.value = (response.data || [])
      .filter((e: ConversationEvent) => !noisyEventTypes.has(e.type))
      .reverse();
  } catch (error) {
    console.error('Failed to load events:', error);
  } finally {
    loading.value = false;
  }
}


function getEventIcon(type: string): string {
  switch (type) {
    case 'message_created': return 'mdi-message-plus';
    case 'message_deleted': return 'mdi-message-minus';
    case 'message_restored': return 'mdi-message-plus-outline';
    case 'message_branch_restored': return 'mdi-source-branch-plus';
    case 'message_updated': return 'mdi-message-draw';
    case 'message_content_updated': return 'mdi-message-processing';
    case 'message_branch_added': return 'mdi-source-branch-plus';
    case 'message_branch_deleted': return 'mdi-source-branch-minus';
    case 'message_branch_updated': return 'mdi-source-branch';
    case 'active_branch_changed': return 'mdi-swap-horizontal';
    default: return 'mdi-circle-small';
  }
}

function getEventColor(type: string): string {
  switch (type) {
    case 'message_created': return 'success';
    case 'message_deleted': return 'error';
    case 'message_restored': return 'warning';
    case 'message_branch_deleted': return 'error';
    case 'message_branch_restored': return 'warning';
    case 'message_updated': return 'warning';
    case 'message_content_updated': return 'info';
    case 'message_branch_added': return 'primary';
    case 'active_branch_changed': return 'secondary';
    default: return 'grey';
  }
}

function getEventDescription(event: ConversationEvent): string {
  const byUser = event.userName ? ` by ${event.userName}` : '';
  
  switch (event.type) {
    case 'message_created':
      const role = event.role || event.data?.branches?.[0]?.role || 'unknown';
      const name = event.participantName || (role === 'user' ? 'User' : 'Assistant');
      // For user messages, show who sent it; for assistant messages, show who triggered it
      if (role === 'user') {
        return `${name} sent a message`;
      } else {
        return event.userName ? `${event.userName} triggered ${name}` : `${name} responded`;
      }
    case 'message_deleted':
      return `Message deleted${byUser}`;
    case 'message_restored':
      return `Message restored${byUser}`;
    case 'message_updated':
      return `Message updated${byUser}`;
    case 'message_content_updated':
      return `Message content updated${byUser}`;
    case 'message_branch_added':
      // Check if it's a user edit or AI regeneration based on branch role
      const branchRole = event.data?.branch?.role;
      if (branchRole === 'user') {
        return `Message edited${byUser}`;
      } else if (branchRole === 'assistant') {
        const participantName = event.data?.branch?.participantId ? 'AI' : 'Assistant';
        return event.userName ? `${event.userName} regenerated ${participantName}` : `${participantName} regenerated`;
      }
      return `New branch added${byUser}`;
    case 'message_branch_deleted':
      return `Branch deleted${byUser}`;
    case 'message_branch_restored':
      return `Branch restored${byUser}`;
    case 'message_branch_updated':
      return 'Branch updated';
    case 'active_branch_changed':
      return 'Switched to different branch';
    default:
      return event.type.replace(/_/g, ' ');
  }
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString(undefined, { 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getMessagePreview(event: ConversationEvent): string | null {
  // Get content from the event data
  let content: string | null = null;
  
  if (event.type === 'message_created') {
    content = event.data?.branches?.[0]?.content;
  } else if (event.type === 'message_branch_added') {
    content = event.data?.branch?.content;
  } else if (event.type === 'message_deleted') {
    // Get content from original message (looked up from message_created event)
    content = (event as any).originalMessage?.branches?.[0]?.content;
  } else if (event.type === 'message_branch_deleted') {
    // Get content from original branch (looked up from event history)
    content = (event as any).originalBranch?.content;
  } else if (event.type === 'message_restored') {
    content = event.data?.message?.branches?.[0]?.content;
  }
  
  if (!content) return null;
  
  // Truncate to ~80 chars, clean up whitespace
  const cleaned = content.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 80) return cleaned;
  return cleaned.substring(0, 77) + '...';
}

function isClickable(event: ConversationEvent): boolean {
  // message_created has messageId in enriched data
  // message_branch_added has messageId in data.messageId
  const messageId = event.messageId || event.data?.messageId;
  return (event.type === 'message_created' || event.type === 'message_branch_added') && !!messageId;
}

function handleEventClick(event: ConversationEvent) {
  const messageId = event.messageId || event.data?.messageId;
  const branchId = event.branchId || event.data?.branch?.id;
  
  if (isClickable(event) && messageId) {
    emit('navigateToMessage', messageId, branchId);
    
    // Close panel on mobile after clicking
    if (props.isMobile) {
      emit('close');
    }
  }
}

// Restore functionality
const restoringEventId = ref<string | null>(null);

function canRestore(event: ConversationEvent): boolean {
  // Can restore message if we have original message data
  if (event.type === 'message_deleted' && (event as any).originalMessage) {
    return true;
  }
  // Can restore branch if we have original branch data
  if (event.type === 'message_branch_deleted' && (event as any).originalBranch) {
    return true;
  }
  return false;
}

function getEventId(event: ConversationEvent): string {
  return `${event.type}-${event.timestamp}-${event.data?.messageId || ''}-${event.data?.branchId || ''}`;
}

async function handleRestore(event: ConversationEvent) {
  const eventId = getEventId(event);
  restoringEventId.value = eventId;
  
  try {
    if (event.type === 'message_deleted' && (event as any).originalMessage) {
      // Restore full message
      await api.post(`/conversations/${props.conversationId}/messages/restore`, {
        message: (event as any).originalMessage
      });
    } else if (event.type === 'message_branch_deleted' && (event as any).originalBranch) {
      // Restore branch
      await api.post(`/conversations/${props.conversationId}/branches/restore`, {
        messageId: event.data?.messageId,
        branch: (event as any).originalBranch
      });
    }
    
    // Reload events to update the list
    await loadEvents();
  } catch (error) {
    console.error('Failed to restore:', error);
  } finally {
    restoringEventId.value = null;
  }
}

watch(() => props.conversationId, () => {
  loadEvents();
});

const store = useStore();

// STUBBED: Unread branches calculation disabled pending architecture review
// See .workshop/proposal-realtime-notifications.md
// The calculation has migration issues (everything shows as unread for existing users)
const unreadBranches = computed<UnreadBranch[]>(() => {
  return [];
});

// Get display name for unread branch
function getUnreadBranchName(branch: UnreadBranch): string {
  // For assistant messages, prioritize model name
  if (branch.role === 'assistant') {
    if (branch.model) {
      const modelName = branch.model.split('/').pop() || branch.model;
      return modelName.length > 25 ? modelName.slice(0, 22) + '...' : modelName;
    }
    // Only use participantName if it doesn't look like a UUID
    if (branch.participantName && !branch.participantName.match(/^[0-9a-f]{8}-/i)) {
      return branch.participantName;
    }
    return 'AI';
  }

  // For user messages, use participantName if it's not a UUID
  if (branch.participantName && !branch.participantName.match(/^[0-9a-f]{8}-/i)) {
    return branch.participantName;
  }

  return branch.role === 'user' ? 'User' : 'Unknown';
}

// Handle clicking on unread branch - navigate and mark as read
function handleUnreadClick(branch: UnreadBranch) {
  emit('navigateToMessage', branch.messageId, branch.branchId);
  store.markBranchesAsRead([branch.branchId]);

  if (props.isMobile) {
    emit('close');
  }
}

// Mark all unread as read
function markAllAsRead() {
  const branchIds = unreadBranches.value.map(b => b.branchId);
  store.markBranchesAsRead(branchIds);
}

// Refresh events when new messages arrive
function handleWsMessage() {
  loadEvents();
}

onMounted(() => {
  loadEvents();
  if (store.state.wsService) {
    store.state.wsService.on('message_created', handleWsMessage);
    store.state.wsService.on('message_edited', handleWsMessage);
    store.state.wsService.on('message_deleted', handleWsMessage);
    store.state.wsService.on('message_restored', handleWsMessage);
    store.state.wsService.on('message_branch_restored', handleWsMessage);
  }
});

onUnmounted(() => {
  if (store.state.wsService) {
    store.state.wsService.off('message_created', handleWsMessage);
    store.state.wsService.off('message_edited', handleWsMessage);
    store.state.wsService.off('message_deleted', handleWsMessage);
    store.state.wsService.off('message_restored', handleWsMessage);
    store.state.wsService.off('message_branch_restored', handleWsMessage);
  }
});
</script>

<style scoped lang="scss">
.event-history-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgb(var(--v-theme-surface));
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  width: 320px;
  
  &.mobile-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    z-index: 1000;
    border-left: none;
  }
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  
  h3 {
    font-size: 14px;
    font-weight: 500;
    margin: 0;
    color: rgba(255, 255, 255, 0.9);
  }
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: rgba(255, 255, 255, 0.5);
  
  p {
    margin-top: 12px;
    font-size: 13px;
  }
}

.events-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.event-item {
  display: flex;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  transition: background 0.15s;
  
  &.clickable {
    cursor: pointer;
    
    &:hover {
      background: rgba(255, 255, 255, 0.05);
    }
  }
}

.event-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

.event-content {
  flex: 1;
  min-width: 0;
}

.event-description {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.event-preview {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 4px;
  line-height: 1.3;
  font-style: italic;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.event-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.restore-btn {
  margin-left: auto;
  font-size: 10px !important;
  height: 20px !important;
  padding: 0 6px !important;
}

// Unread section styles
.unread-section {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  margin-bottom: 8px;
}

.history-header {
  margin-top: 8px;
}

.section-title {
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.7);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.unread-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.unread-item {
  display: flex;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  background: rgba(var(--v-theme-warning), 0.08);
  border-left: 3px solid rgb(var(--v-theme-warning));
  transition: background 0.15s;

  &:hover {
    background: rgba(var(--v-theme-warning), 0.15);
  }
}

.unread-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--v-theme-warning), 0.2);
  border-radius: 4px;
}

.unread-content {
  flex: 1;
  min-width: 0;
}

.unread-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.unread-name {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
}

.unread-time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  flex-shrink: 0;
}

.unread-preview {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-top: 4px;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

