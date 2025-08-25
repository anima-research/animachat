<template>
  <v-layout class="rounded rounded-md">
    <!-- Sidebar -->
    <v-navigation-drawer
      v-model="drawer"
      :rail="rail"
      permanent
      @click="rail = false"
    >
      <v-list>
        <v-list-item
          :prepend-avatar="userAvatar"
          :title="store.state.user?.name"
          :subtitle="store.state.user?.email"
          nav
        >
          <template v-slot:append>
            <v-btn
              variant="text"
              icon="mdi-chevron-left"
              @click.stop="rail = !rail"
            />
          </template>
        </v-list-item>
      </v-list>

      <v-divider />

      <v-list density="compact" nav>
        <v-list-item
          prepend-icon="mdi-plus"
          title="New Conversation"
          @click="createNewConversation"
        />
        
        <v-list-item
          prepend-icon="mdi-import"
          title="Import Conversation"
          @click="importDialog = true"
        />
      </v-list>

      <v-divider />

      <v-list density="compact" nav>
        <v-list-subheader>Conversations</v-list-subheader>
        
        <v-list-item
          v-for="conversation in conversations"
          :key="conversation.id"
          :title="conversation.title"
          :subtitle="formatDate(conversation.updatedAt)"
          :to="`/conversation/${conversation.id}`"
          class="conversation-list-item"
        >
          <template v-slot:append>
            <v-menu>
              <template v-slot:activator="{ props }">
                <v-btn
                  icon="mdi-dots-vertical"
                  size="small"
                  variant="text"
                  v-bind="props"
                  @click.prevent
                />
              </template>
              
              <v-list density="compact">
                <v-list-item
                  prepend-icon="mdi-pencil"
                  title="Rename"
                  @click="renameConversation(conversation)"
                />
                <v-list-item
                  prepend-icon="mdi-content-copy"
                  title="Duplicate"
                  @click="duplicateConversation(conversation.id)"
                />
                <v-list-item
                  prepend-icon="mdi-download"
                  title="Export"
                  @click="exportConversation(conversation.id)"
                />
                <v-list-item
                  prepend-icon="mdi-archive"
                  title="Archive"
                  @click="archiveConversation(conversation.id)"
                />
              </v-list>
            </v-menu>
          </template>
        </v-list-item>
      </v-list>

      <template v-slot:append>
        <v-list density="compact" nav>
          <v-list-item
            prepend-icon="mdi-cog"
            title="Settings"
            @click="settingsDialog = true"
          />
          <v-list-item
            prepend-icon="mdi-logout"
            title="Logout"
            @click="logout"
          />
        </v-list>
      </template>
    </v-navigation-drawer>

    <!-- Main Content -->
    <v-main class="d-flex flex-column" style="height: 100vh;">
      <!-- Top Bar -->
      <v-app-bar density="compact" flat>
        <v-app-bar-nav-icon @click="drawer = !drawer" />
        
        <v-toolbar-title>
          {{ currentConversation?.title || 'New Conversation' }}
        </v-toolbar-title>
        
        <v-spacer />
        
        <v-chip 
          v-if="currentConversation?.format === 'standard'"
          class="mr-2" 
          size="small" 
          variant="outlined"
          :color="currentModel?.provider === 'anthropic' ? 'primary' : 'secondary'"
        >
          {{ currentModel?.displayName || 'Select Model' }}
          <v-tooltip activator="parent" location="bottom">
            Provider: {{ currentModel?.provider === 'anthropic' ? 'Anthropic API' : 'AWS Bedrock' }}
            {{ currentModel?.deprecated ? ' (Deprecated)' : '' }}
          </v-tooltip>
        </v-chip>
        
        <v-chip 
          v-else
          class="mr-2" 
          size="small" 
          variant="outlined"
          color="info"
        >
          Multi-Participant Mode
          <v-tooltip activator="parent" location="bottom">
            Configure models and settings for each participant
          </v-tooltip>
        </v-chip>
        
        <v-btn 
          v-if="currentConversation && currentConversation.format !== 'standard'"
          icon="mdi-account-multiple"
          size="small"
          @click="participantsDialog = true"
        />
        
        <v-btn
          icon="mdi-cog-outline"
          size="small"
          @click="conversationSettingsDialog = true"
        />
      </v-app-bar>

      <!-- Messages Area -->
      <v-container
        ref="messagesContainer"
        class="flex-grow-1 overflow-y-auto messages-container"
        style="max-height: calc(100vh - 200px);"
      >
        <div v-if="!currentConversation" class="text-center mt-12">
          <v-icon size="64" color="grey">mdi-message-text-outline</v-icon>
          <h2 class="text-h5 mt-4 text-grey">Select or create a conversation to start</h2>
        </div>
        
        <div v-else>
          <MessageComponent
            v-for="message in messages"
            :key="message.id"
            :message="message"
            :participants="participants"
            @regenerate="regenerateMessage"
            @edit="editMessage"
            @switch-branch="switchBranch"
            @delete="deleteMessage"
          />
          
          <div v-if="isStreaming" class="d-flex align-center mt-4">
            <v-progress-circular
              indeterminate
              size="20"
              width="2"
              class="mr-2"
            />
            <span class="text-caption">Generating response...</span>
          </div>
        </div>
      </v-container>

      <!-- Input Area -->
      <v-container v-if="currentConversation" class="pa-4">
        <div v-if="currentConversation.format !== 'standard'" class="mb-2 d-flex gap-2">
          <v-select
            v-model="selectedParticipant"
            :items="userParticipants"
            item-title="name"
            item-value="id"
            label="Speaking as"
            density="compact"
            variant="outlined"
            hide-details
            class="flex-grow-1"
          />
          <v-select
            v-model="selectedResponder"
            :items="responderOptions"
            item-title="name"
            item-value="id"
            label="Response from"
            density="compact"
            variant="outlined"
            hide-details
            class="flex-grow-1"
          />
        </div>
        
        <v-textarea
          v-model="messageInput"
          :disabled="isStreaming"
          label="Type your message..."
          rows="3"
          auto-grow
          max-rows="10"
          variant="outlined"
          hide-details
          @keydown.enter.exact.prevent="sendMessage"
        >
          <template v-slot:append-inner>
            <v-btn
              :disabled="!messageInput.trim() || isStreaming"
              color="primary"
              icon="mdi-send"
              variant="text"
              @click="sendMessage"
            />
          </template>
        </v-textarea>
      </v-container>
    </v-main>

    <!-- Dialogs -->
    <ImportDialogV2
      v-model="importDialog"
    />
    
    <SettingsDialog
      v-model="settingsDialog"
    />
    
    <ConversationSettingsDialog
      v-model="conversationSettingsDialog"
      :conversation="currentConversation"
      :models="store.state.models"
      @update="updateConversationSettings"
    />
    
    <ParticipantsDialog
      v-model="participantsDialog"
      :conversation="currentConversation"
      :models="store.state.models"
      :current-participants="participants"
      @update="updateParticipants"
    />
  </v-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from '@/store';
import { api } from '@/services/api';
import type { Conversation, Message, Participant } from '@deprecated-claude/shared';
import MessageComponent from '@/components/MessageComponent.vue';
import ImportDialogV2 from '@/components/ImportDialogV2.vue';
import SettingsDialog from '@/components/SettingsDialog.vue';
import ConversationSettingsDialog from '@/components/ConversationSettingsDialog.vue';
import ParticipantsDialog from '@/components/ParticipantsDialog.vue';

const route = useRoute();
const router = useRouter();
const store = useStore();

const drawer = ref(true);
const rail = ref(false);
const importDialog = ref(false);
const settingsDialog = ref(false);
const conversationSettingsDialog = ref(false);
const participantsDialog = ref(false);
const messageInput = ref('');
const isStreaming = ref(false);
const messagesContainer = ref<HTMLElement>();
const participants = ref<Participant[]>([]);
const selectedParticipant = ref<string>('');
const selectedResponder = ref<string>('');

const conversations = computed(() => store.state.conversations);
const currentConversation = computed(() => store.state.currentConversation);
const messages = computed(() => store.messages);
const currentModel = computed(() => store.currentModel);

const userAvatar = computed(() => {
  const name = store.state.user?.name || '';
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase();
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=BB86FC&color=fff`;
});

const userParticipants = computed(() => {
  return participants.value.filter(p => p.type === 'user' && p.isActive);
});

const assistantParticipants = computed(() => {
  return participants.value.filter(p => p.type === 'assistant' && p.isActive);
});

const responderOptions = computed(() => {
  const options = [{ id: '', name: 'No response' }];
  // Map assistant participants to ensure we show their names
  const assistantOptions = assistantParticipants.value.map(p => ({
    id: p.id,
    name: p.name
  }));
  return options.concat(assistantOptions);
});

// Load initial data
onMounted(async () => {
  await store.loadModels();
  await store.loadConversations();
  store.connectWebSocket();
  
  // Load conversation from route
  if (route.params.id) {
    await store.loadConversation(route.params.id as string);
    await loadParticipants();
    // Scroll to bottom after messages load
    await nextTick();
    // Add small delay for long conversations
    setTimeout(() => {
      scrollToBottom();
    }, 100);
  }
});

// Watch route changes
watch(() => route.params.id, async (newId) => {
  if (newId) {
    await store.loadConversation(newId as string);
    await loadParticipants();
    // Ensure DOM is updated before scrolling
    await nextTick();
    // Add small delay for long conversations
    setTimeout(() => {
      scrollToBottom();
    }, 100);
  }
});

// Watch for new messages to scroll
watch(messages, () => {
  nextTick(() => {
    scrollToBottom(true); // Smooth scroll for new messages
  });
}, { deep: true });

function scrollToBottom(smooth: boolean = false) {
  // For long conversations, we need multiple frames to ensure full render
  const attemptScroll = (attempts: number = 0) => {
    requestAnimationFrame(() => {
      if (messagesContainer.value) {
        const container = messagesContainer.value;
        const previousHeight = container.scrollHeight;
        
        container.scrollTo({
          top: container.scrollHeight,
          behavior: smooth ? 'smooth' : 'instant'
        });
        
        // Check if content is still loading (scroll height is changing)
        if (attempts < 10) { // Increased attempts for very long conversations
          setTimeout(() => {
            if (container.scrollHeight > previousHeight) {
              // Content grew, scroll again
              attemptScroll(attempts + 1);
            }
          }, 50); // Reduced delay for more responsive scrolling
        }
      }
    });
  };
  
  attemptScroll();
}

async function createNewConversation() {
  const model = store.state.models[0]?.id || 'claude-3-5-sonnet-20241022';
  const conversation = await store.createConversation(model);
  router.push(`/conversation/${conversation.id}`);
}

async function sendMessage() {
  const content = messageInput.value.trim();
  if (!content || isStreaming.value) return;
  
  console.log('ConversationView sendMessage:', content);
  console.log('Current visible messages:', messages.value.length);
  
  messageInput.value = '';
  isStreaming.value = true;
  
  try {
    let participantId: string | undefined;
    let responderId: string | undefined;
    
    if (currentConversation.value?.format === 'standard') {
      // For standard format, use default participants
      const defaultUser = participants.value.find(p => p.type === 'user' && p.name === 'User');
      const defaultAssistant = participants.value.find(p => p.type === 'assistant' && p.name === 'Assistant');
      
      participantId = defaultUser?.id;
      responderId = defaultAssistant?.id;
    } else {
      // For other formats, use selected participants
      participantId = selectedParticipant.value || undefined;
      responderId = selectedResponder.value || undefined;
    }
      
    await store.sendMessage(content, participantId, responderId);
  } finally {
    isStreaming.value = false;
  }
}

async function regenerateMessage(messageId: string, branchId: string) {
  isStreaming.value = true;
  try {
    await store.regenerateMessage(messageId, branchId);
  } finally {
    isStreaming.value = false;
  }
}

async function editMessage(messageId: string, branchId: string, content: string) {
  await store.editMessage(messageId, branchId, content);
}

function switchBranch(messageId: string, branchId: string) {
  store.switchBranch(messageId, branchId);
}

async function renameConversation(conversation: Conversation) {
  const newTitle = prompt('Enter new title:', conversation.title);
  if (newTitle && newTitle !== conversation.title) {
    await store.updateConversation(conversation.id, { title: newTitle });
  }
}

async function duplicateConversation(id: string) {
  const duplicate = await store.duplicateConversation(id);
  router.push(`/conversation/${duplicate.id}`);
}

async function exportConversation(id: string) {
  try {
    const response = await fetch(`/api/conversations/${id}/export`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    const data = await response.json();
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Export failed:', error);
  }
}

async function archiveConversation(id: string) {
  if (confirm('Are you sure you want to archive this conversation?')) {
    await store.archiveConversation(id);
    if (currentConversation.value?.id === id) {
      router.push('/conversation');
    }
  }
}

async function updateConversationSettings(updates: Partial<Conversation>) {
  if (currentConversation.value) {
    await store.updateConversation(currentConversation.value.id, updates);
  }
}

async function deleteMessage(messageId: string, branchId: string) {
  if (confirm('Are you sure you want to delete this message and all its replies?')) {
    await store.deleteMessage(messageId, branchId);
  }
}

async function loadParticipants() {
  if (!currentConversation.value) return;
  
  try {
    const response = await api.get(`/participants/conversation/${currentConversation.value.id}`);
    participants.value = response.data;
    
    // Set default selected participant
    if (currentConversation.value.format !== 'standard') {
      const defaultUser = participants.value.find(p => p.type === 'user' && p.isActive);
      if (defaultUser) {
        selectedParticipant.value = defaultUser.id;
      }
      
      // Set default responder to first assistant
      const defaultAssistant = participants.value.find(p => p.type === 'assistant' && p.isActive);
      if (defaultAssistant) {
        selectedResponder.value = defaultAssistant.id;
      }
    }
  } catch (error) {
    console.error('Failed to load participants:', error);
  }
}

async function updateParticipants(updatedParticipants: Participant[]) {
  if (!currentConversation.value) return;
  
  try {
    // Handle updates and deletions
    for (const existing of participants.value) {
      const updated = updatedParticipants.find(p => p.id === existing.id);
      if (!updated) {
        // Participant was deleted
        await api.delete(`/participants/${existing.id}`);
      } else if (JSON.stringify(existing) !== JSON.stringify(updated)) {
        // Participant was updated
        await api.patch(`/participants/${existing.id}`, {
          name: updated.name,
          model: updated.model,
          systemPrompt: updated.systemPrompt,
          settings: updated.settings
        });
      }
    }
    
    // Handle new participants
    for (const participant of updatedParticipants) {
      if (participant.id.startsWith('temp-')) {
        // New participant
        await api.post('/participants', {
          conversationId: currentConversation.value.id,
          name: participant.name,
          type: participant.type,
          model: participant.model,
          systemPrompt: participant.systemPrompt,
          settings: participant.settings
        });
      }
    }
    
    // Reload participants
    await loadParticipants();
  } catch (error) {
    console.error('Failed to update participants:', error);
  }
}

function logout() {
  store.logout();
  router.push('/login');
}

function formatDate(date: Date | string): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  
  return d.toLocaleDateString();
}
</script>

<style scoped>
/* Custom scrollbar styles for better visibility in dark theme */
.overflow-y-auto::-webkit-scrollbar {
  width: 12px;
}

.overflow-y-auto::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.overflow-y-auto::-webkit-scrollbar-thumb {
  background: rgba(187, 134, 252, 0.5); /* Primary color with opacity */
  border-radius: 6px;
  border: 1px solid rgba(187, 134, 252, 0.2);
}

.overflow-y-auto::-webkit-scrollbar-thumb:hover {
  background: rgba(187, 134, 252, 0.7);
  border: 1px solid rgba(187, 134, 252, 0.4);
}

/* Firefox scrollbar */
.overflow-y-auto {
  scrollbar-width: thin;
  scrollbar-color: rgba(187, 134, 252, 0.5) rgba(255, 255, 255, 0.05);
}

/* Ensure container has proper styling and scrollbar is always visible */
.messages-container {
  position: relative;
}

/* Force scrollbar to always show on macOS/webkit */
.messages-container::-webkit-scrollbar {
  -webkit-appearance: none;
  width: 12px;
}

.messages-container {
  overflow-y: scroll !important; /* Force scrollbar to always show */
}
</style>
