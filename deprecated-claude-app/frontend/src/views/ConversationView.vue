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
        
        <v-btn
          icon="mdi-cog-outline"
          size="small"
          @click="conversationSettingsDialog = true"
        />
      </v-app-bar>

      <!-- Messages Area -->
      <v-container
        ref="messagesContainer"
        class="flex-grow-1 overflow-y-auto"
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
            @regenerate="regenerateMessage"
            @edit="editMessage"
            @switch-branch="switchBranch"
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
    <ImportDialog
      v-model="importDialog"
      @imported="onConversationImported"
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
  </v-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from '@/store';
import type { Conversation, Message } from '@deprecated-claude/shared';
import MessageComponent from '@/components/MessageComponent.vue';
import ImportDialog from '@/components/ImportDialog.vue';
import SettingsDialog from '@/components/SettingsDialog.vue';
import ConversationSettingsDialog from '@/components/ConversationSettingsDialog.vue';

const route = useRoute();
const router = useRouter();
const store = useStore();

const drawer = ref(true);
const rail = ref(false);
const importDialog = ref(false);
const settingsDialog = ref(false);
const conversationSettingsDialog = ref(false);
const messageInput = ref('');
const isStreaming = ref(false);
const messagesContainer = ref<HTMLElement>();

const conversations = computed(() => store.state.conversations);
const currentConversation = computed(() => store.state.currentConversation);
const messages = computed(() => store.messages);
const currentModel = computed(() => store.currentModel);

const userAvatar = computed(() => {
  const name = store.state.user?.name || '';
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase();
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=BB86FC&color=fff`;
});

// Load initial data
onMounted(async () => {
  await store.loadModels();
  await store.loadConversations();
  store.connectWebSocket();
  
  // Load conversation from route
  if (route.params.id) {
    await store.loadConversation(route.params.id as string);
  }
});

// Watch route changes
watch(() => route.params.id, async (newId) => {
  if (newId) {
    await store.loadConversation(newId as string);
    scrollToBottom();
  }
});

// Watch for new messages to scroll
watch(messages, () => {
  nextTick(() => {
    scrollToBottom();
  });
}, { deep: true });

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

async function createNewConversation() {
  const model = store.state.models[0]?.id || 'claude-3-opus-20240229';
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
    await store.sendMessage(content);
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

function onConversationImported(conversation: Conversation) {
  router.push(`/conversation/${conversation.id}`);
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
