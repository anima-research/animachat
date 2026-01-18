<template>
  <div v-if="notifications.length > 0" class="branch-activity-indicator">
    <v-menu
      v-model="menuOpen"
      location="bottom end"
      :close-on-content-click="false"
    >
      <template v-slot:activator="{ props }">
        <v-badge
          :content="notifications.length"
          color="warning"
          class="activity-badge"
        >
          <v-btn
            v-bind="props"
            icon
            size="small"
            variant="text"
            class="activity-btn"
          >
            <v-icon size="20">mdi-source-branch</v-icon>
          </v-btn>
        </v-badge>
      </template>

      <v-card min-width="280" max-width="350" class="notifications-card">
        <v-card-title class="text-subtitle-2 py-2 d-flex align-center justify-space-between">
          <span>Activity on other branches</span>
          <v-btn
            size="x-small"
            variant="text"
            color="warning"
            @click.stop="clearAll"
          >
            Clear all
          </v-btn>
        </v-card-title>
        <v-divider />
        <v-list density="compact" class="notifications-list">
          <v-list-item
            v-for="notif in notifications"
            :key="notif.branchId"
            @click="navigateToNotification(notif)"
            class="notification-item"
          >
            <template v-slot:prepend>
              <v-icon
                :icon="notif.role === 'user' ? 'mdi-account' : 'mdi-robot'"
                size="18"
                class="mr-2"
              />
            </template>
            <v-list-item-title class="text-body-2 d-flex align-center justify-space-between">
              <span>{{ getParticipantName(notif) }}</span>
              <span class="text-caption text-medium-emphasis ml-2">{{ formatRelativeTime(notif.createdAt) }}</span>
            </v-list-item-title>
            <v-list-item-subtitle class="text-caption notification-content">
              {{ truncate(notif.content, 60) }}
            </v-list-item-subtitle>
          </v-list-item>
        </v-list>
      </v-card>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useStore } from '@/store';

const emit = defineEmits<{
  navigate: [messageId: string, branchId: string]
}>();

const store = useStore();
const menuOpen = ref(false);

const notifications = computed(() => {
  return Array.from(store.state.hiddenBranchActivities.values());
});

function getParticipantName(notif: { participantId: string | null; role: string; model: string | null }): string {
  // Try to find in current conversation participants
  const conversation = store.state.currentConversation;
  if (notif.participantId && conversation?.participants) {
    const participant = conversation.participants.find(p => p.id === notif.participantId);
    if (participant) return participant.name;
  }

  // For assistant messages, fall back to model name or "AI"
  if (notif.role === 'assistant') {
    if (notif.model) {
      // Extract a short model name (e.g., "claude-3-opus" -> "claude-3-opus")
      // If it's a very long model string, truncate it
      const modelName = notif.model.split('/').pop() || notif.model;
      return modelName.length > 25 ? modelName.slice(0, 22) + '...' : modelName;
    }
    return 'AI';
  }

  // For user messages without participant, just say "User"
  if (notif.role === 'user') {
    return 'User';
  }

  return 'Unknown';
}

function truncate(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

function formatRelativeTime(date: Date | string | undefined): string {
  if (!date) return '';
  const now = Date.now();
  const then = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(then).toLocaleDateString();
}

function navigateToNotification(notif: { messageId: string; branchId: string }) {
  emit('navigate', notif.messageId, notif.branchId);
  menuOpen.value = false;
}

function clearAll() {
  store.state.hiddenBranchActivities.clear();
  menuOpen.value = false;
}
</script>

<style scoped>
.branch-activity-indicator {
  display: flex;
  align-items: center;
}

.activity-badge {
  cursor: pointer;
}

.activity-btn {
  opacity: 0.9;
}

.activity-btn:hover {
  opacity: 1;
}

.notifications-card {
  background: rgb(var(--v-theme-surface));
}

.notifications-list {
  max-height: 300px;
  overflow-y: auto;
}

.notification-item {
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: border-color 0.15s ease;
}

.notification-item:hover {
  border-left-color: rgb(var(--v-theme-warning));
}

.notification-content {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
