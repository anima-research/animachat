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
      <div v-if="loading" class="loading-state">
        <v-progress-circular indeterminate size="24" />
      </div>
      
      <div v-else-if="events.length === 0" class="empty-state">
        <v-icon size="32" color="grey">mdi-history</v-icon>
        <p>No events yet</p>
      </div>
      
      <div v-else class="events-list">
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
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
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
    case 'message_branch_deleted': return 'error';
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

watch(() => props.conversationId, () => {
  loadEvents();
});

const store = useStore();

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
  }
});

onUnmounted(() => {
  if (store.state.wsService) {
    store.state.wsService.off('message_created', handleWsMessage);
    store.state.wsService.off('message_edited', handleWsMessage);
    store.state.wsService.off('message_deleted', handleWsMessage);
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
  gap: 8px;
  margin-top: 4px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}
</style>

