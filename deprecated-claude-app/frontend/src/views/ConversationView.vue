<template>
  <v-layout class="rounded rounded-md">
    <!-- Sidebar -->
    <v-navigation-drawer
      v-model="drawer"
      permanent
    >
      <v-list>
        <v-list-item
          :title="store.state.user?.name"
          :subtitle="store.state.user?.email"
          nav
        >
          <template v-slot:prepend>
            <div class="mr-3">
              <ArcLogo :size="40" />
            </div>
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
          :to="`/conversation/${conversation.id}`"
          class="conversation-list-item"
          :lines="'three'"
        >
          <template v-slot:title>
            <div class="text-truncate">{{ conversation.title }}</div>
          </template>
          <template v-slot:subtitle>
            <div>
              <div class="text-caption" v-html="getConversationModelsHtml(conversation)"></div>
              <div class="text-caption text-medium-emphasis">{{ formatDate(conversation.updatedAt) }}</div>
            </div>
          </template>
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
            prepend-icon="mdi-help-circle"
            title="Getting Started"
            @click="welcomeDialog = true"
          />
          <v-list-item
            prepend-icon="mdi-information"
            title="About The Arc"
            @click="$router.push('/about')"
          />
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
        
        <!-- Metrics Display -->
        <MetricsDisplay 
          v-if="currentConversation"
          :conversation-id="currentConversation.id"
          class="mr-4"
        />
        
        <!-- Group Chat Mode Button -->
        <v-btn
          v-if="currentConversation?.format === 'standard'"
          size="small"
          variant="text"
          color="primary"
          class="mr-2"
          @click="switchToGroupChat"
        >
          <v-icon size="small" class="mr-1">mdi-account-group</v-icon>
          Group Chat
          <v-tooltip activator="parent" location="bottom">
            Switch to Group Chat mode
          </v-tooltip>
        </v-btn>
        
        <v-chip 
          v-if="currentConversation?.format === 'standard'"
          class="mr-2 clickable-chip" 
          size="small"
          variant="outlined"
          :color="getModelColor(currentConversation?.model)"
          @click="conversationSettingsDialog = true"
        >
          {{ currentModel?.displayName || 'Select Model' }}
          <v-icon size="small" class="ml-1">mdi-cog-outline</v-icon>
          <v-tooltip activator="parent" location="bottom">
            Click to change model and settings
          </v-tooltip>
        </v-chip>
        
        <v-chip 
          v-else
          class="mr-2 clickable-chip" 
          size="small" 
          variant="outlined"
          color="info"
          @click="conversationSettingsDialog = true"
        >
          Group Chat Mode
          <v-icon size="small" class="ml-1">mdi-cog-outline</v-icon>
          <v-tooltip activator="parent" location="bottom">
            Click to configure participants and settings
          </v-tooltip>
        </v-chip>
        
        <!-- Fix branches button (hidden - only for debugging) -->
        <!-- <v-btn
          v-if="currentConversation"
          icon="mdi-wrench"
          size="small"
          color="orange"
          @click="fixConversationBranches"
          title="Fix branch structure issues"
        /> -->
        
        <!-- Import raw messages button (hidden - kept for potential debugging use) -->
        <!-- <v-btn
          v-if="currentConversation"
          icon="mdi-database-import"
          size="small"
          color="green"
          @click="showRawImportDialog = true"
          title="Import raw messages backup"
        /> -->
        
        <!-- Export button (hidden - available in conversation dropdown menu) -->
        <!-- <v-btn
          v-if="currentConversation"
          icon="mdi-export"
          variant="text"
          @click="exportConversation(currentConversation.id)"
          title="Export conversation"
        /> -->
        
        <v-btn
          v-if="allMessages.length > 0"
          :icon="treeDrawer ? 'mdi-graph' : 'mdi-graph-outline'"
          :color="treeDrawer ? 'primary' : undefined"
          variant="text"
          @click="treeDrawer = !treeDrawer"
          title="Toggle conversation tree"
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
            v-for="(message, index) in messages"
            :id="`message-${message.id}`"
            :key="message.id"
            :message="message"
            :participants="participants"
            :is-selected-parent="selectedBranchForParent?.messageId === message.id && 
                                 selectedBranchForParent?.branchId === message.activeBranchId"
            :is-last-message="index === messages.length - 1"
            :is-streaming="isStreaming && message.id === streamingMessageId"
            :has-error="streamingError?.messageId === message.id"
            :error-message="streamingError?.messageId === message.id ? streamingError.error : undefined"
            @regenerate="regenerateMessage"
            @edit="editMessage"
            @switch-branch="switchBranch"
            @delete="deleteMessage"
            @select-as-parent="selectBranchAsParent"
            @stop-auto-scroll="stopAutoScroll"
          />
        </div>
      </v-container>

      <!-- Input Area -->
      <v-container v-if="currentConversation" class="pa-4">
        <!-- Branch selection indicator -->
        <v-alert
          v-if="selectedBranchForParent"
          type="info"
          density="compact"
          class="mb-3"
          closable
          @click:close="cancelBranchSelection"
        >
          <v-icon size="small" class="mr-2">mdi-source-branch</v-icon>
          Branching from selected message. New messages will create alternative branches.
        </v-alert>
        
        <!-- Model Quick Access Bar -->
        <div v-if="currentConversation.format !== 'standard' && (participantsByLastSpoken.length > 0 || suggestedNonParticipantModels.length > 0)" 
             class="mb-3">
          <div class="d-flex align-center gap-2 flex-wrap">
            
            <!-- Existing participants sorted by last spoken -->
            <v-chip
              v-for="participant in participantsByLastSpoken"
              :key="participant.id"
              :color="getModelColor(participant.model || '')"
              size="small"
              variant="outlined"
              @click="triggerParticipantResponse(participant)"
              :disabled="isStreaming"
              class="clickable-chip"
            >
              <v-icon size="x-small" start>{{ getParticipantIcon(participant) }}</v-icon>
              {{ participant.name }}
            </v-chip>
            
            <!-- Divider between participants and suggested models -->
            <v-divider v-if="participantsByLastSpoken.length > 0 && suggestedNonParticipantModels.length > 0" 
                       vertical 
                       class="mx-1" 
                       style="height: 20px" />
            
            <!-- Suggested models that aren't participants yet -->
            <template v-for="model in suggestedNonParticipantModels" :key="model?.id">
              <v-chip
                v-if="model"
                color="grey"
                size="small"
                variant="outlined"
                @click="triggerModelResponse(model)"
                :disabled="isStreaming"
                class="clickable-chip"
              >
                <v-icon size="x-small" start>{{ getProviderIcon(model.provider) }}</v-icon>
                {{ model.shortName || model.displayName }}
                <v-tooltip activator="parent" location="top">
                  Add {{ model.displayName }} to conversation
                </v-tooltip>
              </v-chip>
            </template>
          </div>
        </div>
        
        <div v-if="currentConversation.format !== 'standard'" class="mb-2 d-flex gap-2">
          <v-select
            v-model="selectedParticipant"
            :items="allParticipants"
            item-title="name"
            item-value="id"
            label="Speaking as"
            density="compact"
            variant="outlined"
            hide-details
            class="flex-grow-1"
          >
            <template v-slot:selection="{ item }">
              <div class="d-flex align-center">
                <v-icon 
                  :icon="item.raw.type === 'user' ? 'mdi-account' : 'mdi-robot'"
                  :color="item.raw.type === 'user' ? '#bb86fc' : getModelColor(item.raw.model || '')"
                  size="small"
                  class="mr-2"
                />
                <span :style="item.raw.type === 'user' ? 'color: #bb86fc; font-weight: 500;' : `color: ${getModelColor(item.raw.model || '')}; font-weight: 500;`">
                  {{ item.raw.name }}
                </span>
              </div>
            </template>
            <template v-slot:item="{ props, item }">
              <v-list-item v-bind="props">
                <template v-slot:prepend>
                  <v-icon 
                    :icon="item.raw.type === 'user' ? 'mdi-account' : 'mdi-robot'"
                    :color="item.raw.type === 'user' ? '#bb86fc' : getModelColor(item.raw.model || '')"
                  />
                </template>
                <template v-slot:title>
                  <span :style="item.raw.type === 'user' ? 'color: #bb86fc; font-weight: 500;' : `color: ${getModelColor(item.raw.model || '')}; font-weight: 500;`">
                    {{ item.raw.name }}
                  </span>
                </template>
              </v-list-item>
            </template>
          </v-select>
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
          >
            <template v-slot:selection="{ item }">
              <div class="d-flex align-center">
                <v-icon 
                  :icon="item.raw.type === 'user' ? 'mdi-account' : 'mdi-robot'"
                  :color="item.raw.type === 'user' ? '#bb86fc' : getModelColor(item.raw.model || '')"
                  size="small"
                  class="mr-2"
                />
                <span :style="item.raw.type === 'user' ? 'color: #bb86fc; font-weight: 500;' : `color: ${getModelColor(item.raw.model || '')}; font-weight: 500;`">
                  {{ item.raw.name }}
                </span>
              </div>
            </template>
            <template v-slot:item="{ props, item }">
              <v-list-item v-bind="props">
                <template v-slot:prepend>
                  <v-icon 
                    :icon="item.raw.type === 'user' ? 'mdi-account' : 'mdi-robot'"
                    :color="item.raw.type === 'user' ? '#bb86fc' : getModelColor(item.raw.model || '')"
                  />
                </template>
                <template v-slot:title>
                  <span :style="item.raw.type === 'user' ? 'color: #bb86fc; font-weight: 500;' : `color: ${getModelColor(item.raw.model || '')}; font-weight: 500;`">
                    {{ item.raw.name }}
                  </span>
                </template>
              </v-list-item>
            </template>
          </v-select>
        </div>
        
        <!-- Attachments display -->
        <div v-if="attachments.length > 0" class="mb-2">
          <v-chip
            v-for="(attachment, index) in attachments"
            :key="index"
            closable
            @click:close="removeAttachment(index)"
            class="mr-2 mb-2"
            :style="attachment.isImage ? 'height: auto; padding: 4px;' : ''"
          >
            <template v-if="attachment.isImage">
              <img 
                :src="`data:image/${attachment.fileType};base64,${attachment.content}`" 
                :alt="attachment.fileName"
                style="max-height: 60px; max-width: 100px; margin-right: 8px; border-radius: 4px;"
              />
              <span>{{ attachment.fileName }}</span>
            </template>
            <template v-else>
              <v-icon start>mdi-paperclip</v-icon>
              {{ attachment.fileName }}
            </template>
            <span class="ml-1 text-caption">({{ formatFileSize(attachment.fileSize) }})</span>
          </v-chip>
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
            <!-- File attachment button -->
            <v-btn
              icon="mdi-paperclip"
              color="grey"
              variant="text"
              @click.stop="triggerFileInput($event)"
              title="Attach file"
              class="mr-1"
            />
            
            <v-btn
              :disabled="isStreaming"
              :color="continueButtonColor"
              icon="mdi-robot"
              variant="text"
              :title="currentConversation?.format === 'standard' ? 'Continue (Assistant)' : `Continue (${selectedResponderName})`"
              @click="continueGeneration"
              class="mr-1"
            />
            <v-btn
              :disabled="!messageInput.trim() || isStreaming"
              color="primary"
              icon="mdi-send"
              variant="text"
              @click="sendMessage"
            />
          </template>
        </v-textarea>
        
        <!-- Hidden file input -->
        <input
          ref="fileInput"
          type="file"
          accept=".txt,.md,.csv,.json,.xml,.html,.css,.js,.ts,.py,.java,.cpp,.c,.h,.hpp"
          multiple
          style="display: none"
          @change="handleFileSelect"
        />
      </v-container>
    </v-main>

    <!-- Right sidebar with conversation tree -->
    <v-navigation-drawer
      v-model="treeDrawer"
      location="right"
      :width="400"
      permanent
    >
      <v-toolbar density="compact">
        <v-toolbar-title>Conversation Tree</v-toolbar-title>
        <v-spacer />
        <v-btn
          icon="mdi-close"
          size="small"
          variant="text"
          @click="treeDrawer = false"
        />
      </v-toolbar>
      
      <ConversationTree
        v-if="allMessages.length > 0"
        :messages="allMessages"
        :participants="participants"
        :current-message-id="currentMessageId"
        :current-branch-id="currentBranchId"
        :selected-parent-message-id="selectedBranchForParent?.messageId"
        :selected-parent-branch-id="selectedBranchForParent?.branchId"
        @navigate-to-branch="navigateToTreeBranch"
        class="flex-grow-1"
      />
      
      <v-container v-else class="d-flex align-center justify-center" style="height: calc(100% - 48px);">
        <div class="text-center text-grey">
          <v-icon size="48">mdi-graph-outline</v-icon>
          <div class="mt-2">No messages yet</div>
        </div>
      </v-container>
    </v-navigation-drawer>

    <!-- Dialogs -->
    <ImportDialogV2
      v-model="importDialog"
    />
    
    <!-- Raw Import Dialog -->
    <v-dialog v-model="showRawImportDialog" max-width="600">
      <v-card>
        <v-card-title>Import Raw Messages Backup</v-card-title>
        <v-card-text>
          <v-alert type="warning" class="mb-4">
            This will replace ALL messages in the current conversation with the imported data.
            Make sure you have the right conversation selected!
          </v-alert>
          <v-textarea
            v-model="rawImportData"
            label="Paste the messages JSON array here"
            placeholder='[{"id": "...", "conversationId": "...", "branches": [...], ...}]'
            rows="10"
            variant="outlined"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showRawImportDialog = false">Cancel</v-btn>
          <v-btn 
            color="primary" 
            @click="importRawMessages"
            :disabled="!rawImportData.trim()"
          >
            Import
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    
    <SettingsDialog
      v-model="settingsDialog"
    />
    
    <ConversationSettingsDialog
      v-model="conversationSettingsDialog"
      :conversation="currentConversation"
      :models="store.state.models"
      @update="updateConversationSettings"
      @update-participants="updateParticipants"
    />
    

    
    <WelcomeDialog
      v-model="welcomeDialog"
      @open-settings="settingsDialog = true"
      @open-import="importDialog = true"
      @new-conversation="createNewConversation"
    />
  </v-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from '@/store';
import { api } from '@/services/api';
import type { Conversation, Message, Participant, Model } from '@deprecated-claude/shared';
import MessageComponent from '@/components/MessageComponent.vue';
import ImportDialogV2 from '@/components/ImportDialogV2.vue';
import SettingsDialog from '@/components/SettingsDialog.vue';
import ConversationSettingsDialog from '@/components/ConversationSettingsDialog.vue';
import ArcLogo from '@/components/ArcLogo.vue';
import WelcomeDialog from '@/components/WelcomeDialog.vue';
import ConversationTree from '@/components/ConversationTree.vue';
import MetricsDisplay from '@/components/MetricsDisplay.vue';
import { getModelColor } from '@/utils/modelColors';

const route = useRoute();
const router = useRouter();
const store = useStore();

const drawer = ref(true);
const treeDrawer = ref(false);
const importDialog = ref(false);
const settingsDialog = ref(false);
const conversationSettingsDialog = ref(false);
const showRawImportDialog = ref(false);
const welcomeDialog = ref(false);
const rawImportData = ref('');
const messageInput = ref('');
const isStreaming = ref(false);
const streamingMessageId = ref<string | null>(null);
const autoScrollEnabled = ref(true);
const streamingError = ref<{ messageId: string; error: string } | null>(null);
const attachments = ref<Array<{ fileName: string; fileType: string; fileSize: number; content: string; isImage?: boolean }>>([]);
const fileInput = ref<HTMLInputElement>();

// Branch selection state
const selectedBranchForParent = ref<{ messageId: string; branchId: string } | null>(null);
const messagesContainer = ref<HTMLElement>();
const participants = ref<Participant[]>([]);
const selectedParticipant = ref<string>('');
const selectedResponder = ref<string>('');

const conversations = computed(() => store.state.conversations);
const currentConversation = computed(() => store.state.currentConversation);
const messages = computed(() => store.messages);
const allMessages = computed(() => store.state.allMessages); // Get ALL messages for tree view

// For tree view - identify current position
const currentMessageId = computed(() => {
  const visibleMessages = messages.value;
  if (visibleMessages.length > 0) {
    const lastMessage = visibleMessages[visibleMessages.length - 1];
    return lastMessage.id;
  }
  return undefined;
});

const currentBranchId = computed(() => {
  const visibleMessages = messages.value;
  if (visibleMessages.length > 0) {
    const lastMessage = visibleMessages[visibleMessages.length - 1];
    return lastMessage.activeBranchId;
  }
  return undefined;
});
const currentModel = computed(() => store.currentModel);


const selectedResponderName = computed(() => {
  const responder = assistantParticipants.value.find(p => p.id === selectedResponder.value);
  return responder?.name || 'Assistant';
});

// Allow sending as any participant type (user or assistant)
const allParticipants = computed(() => {
  return participants.value.filter(p => p.isActive);
});

const assistantParticipants = computed(() => {
  return participants.value.filter(p => p.type === 'assistant' && p.isActive);
});

const responderOptions = computed(() => {
  const options = [{ id: '', name: 'No response', type: 'none' as any, model: '' }];
  // Include full participant objects to have access to type and model
  const assistantOptions = assistantParticipants.value.map(p => ({
    id: p.id,
    name: p.name === '' ? '(raw continuation)' : p.name,
    type: p.type,
    model: p.model || ''
  }));
  return options.concat(assistantOptions);
});

const continueButtonColor = computed(() => {
  if (currentConversation.value?.format === 'standard') {
    // For standard conversations, use the model color
    return getModelColor(currentConversation.value?.model);
  }
  
  // For multi-participant, find the selected responder and get their color
  if (selectedResponder.value) {
    const responder = participants.value.find(p => p.id === selectedResponder.value);
    if (responder && responder.type === 'assistant') {
      return getModelColor(responder.model);
    }
  }
  
  // Default fallback
  return '#9e9e9e';
});

// Track participants by last speaking order
const participantsByLastSpoken = computed(() => {
  if (!currentConversation.value || currentConversation.value.format === 'standard') {
    return [];
  }
  
  const participantLastSpoken = new Map<string, Date>();
  
  // Go through all messages in reverse order to find last time each participant spoke
  const allMsgs = [...messages.value].reverse();
  for (const message of allMsgs) {
    for (const branch of message.branches) {
      if (branch.participantId && !participantLastSpoken.has(branch.participantId)) {
        // Ensure createdAt is a Date object
        const createdAt = branch.createdAt instanceof Date 
          ? branch.createdAt 
          : new Date(branch.createdAt);
        participantLastSpoken.set(branch.participantId, createdAt);
      }
    }
  }
  
  // Get assistant participants and sort by last spoken (most recent first)
  const assistants = participants.value
    .filter(p => p.type === 'assistant')
    .map(p => ({
      participant: p,
      lastSpoken: participantLastSpoken.get(p.id) || new Date(0)
    }))
    .sort((a, b) => b.lastSpoken.getTime() - a.lastSpoken.getTime())
    .map(item => item.participant);
    
  return assistants;
});

// System configuration
const systemConfig = ref<{ features?: any; groupChatSuggestedModels?: string[] }>({});

// Get suggested models that aren't already participants
const suggestedNonParticipantModels = computed(() => {
  if (!currentConversation.value || currentConversation.value.format === 'standard') {
    return [];
  }
  
  const suggestedModelIds = systemConfig.value.groupChatSuggestedModels || [];
  
  const participantModelIds = new Set(participants.value
    .filter(p => p.type === 'assistant')
    .map(p => p.model)
    .filter(Boolean));
    
  return suggestedModelIds
    .filter(modelId => !participantModelIds.has(modelId))
    .map(modelId => store.state.models.find(m => m.id === modelId))
    .filter(Boolean);
});

// Watch for new conversations and load their participants
watch(conversations, (newConversations) => {
  for (const conversation of newConversations) {
    if (conversation.format === 'prefill' && !conversationParticipantsCache.value[conversation.id]) {
      loadConversationParticipants(conversation.id);
    }
  }
});

// Load initial data
onMounted(async () => {
  await store.loadModels();
  await store.loadSystemConfig();
  await store.loadConversations();
  
  // Set local systemConfig from store
  if (store.state.systemConfig) {
    systemConfig.value = store.state.systemConfig;
  }
  
  store.connectWebSocket();
  
  // Set up WebSocket listeners for streaming after a small delay
  nextTick(() => {
    if (store.state.wsService) {
      store.state.wsService.on('message_created', (data: any) => {
        // A new message was created, start tracking streaming
        if (data.message && data.message.branches?.length > 0) {
          const lastBranch = data.message.branches[data.message.branches.length - 1];
          if (lastBranch.role === 'assistant') {
            streamingMessageId.value = data.message.id;
            isStreaming.value = true;
            autoScrollEnabled.value = true; // Re-enable auto-scroll for new messages
            streamingError.value = null; // Clear any previous errors
          }
        }
      });
      
      store.state.wsService.on('stream', (data: any) => {
        // Streaming content update
        if (data.messageId === streamingMessageId.value) {
          // Check if streaming is complete
          if (data.isComplete) {
            isStreaming.value = false;
            streamingMessageId.value = null;
          } else {
            // Still streaming
            if (!isStreaming.value) {
              isStreaming.value = true;
            }
          }
        }
      });
      
      store.state.wsService.on('error', (data: any) => {
        // Handle streaming errors
        console.error('WebSocket error:', data);
        
        // If we're currently streaming, mark it as failed
        if (isStreaming.value && streamingMessageId.value) {
          streamingError.value = {
            messageId: streamingMessageId.value,
            error: data.error || 'Failed to generate response'
          };
          isStreaming.value = false;
          // Don't clear streamingMessageId so we can show the error on the right message
        }
      });
    }
  });
  
  // Load participants for multi-participant conversations
  for (const conversation of conversations.value) {
    if (conversation.format === 'prefill') {
      loadConversationParticipants(conversation.id);
    }
  }
  
  // Show welcome dialog on first visit
  const hideWelcome = localStorage.getItem('hideWelcomeDialog');
  if (!hideWelcome) {
    welcomeDialog.value = true;
  }
  
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
  if (autoScrollEnabled.value) {
    nextTick(() => {
      scrollToBottom(true); // Smooth scroll for new messages
    });
  }
}, { deep: true });

function scrollToBottom(smooth: boolean = false) {
  // For long conversations, we need multiple frames to ensure full render
  const attemptScroll = (attempts: number = 0) => {
    requestAnimationFrame(() => {
      if (messagesContainer.value) {
        const container = messagesContainer.value;
        // Vuetify components expose their DOM element via $el
        const element = (container as any).$el || container;
        
        if (element && element.scrollTo) {
          const previousHeight = element.scrollHeight;
          
          element.scrollTo({
            top: element.scrollHeight,
            behavior: smooth ? 'smooth' : 'instant'
          });
          
          // Check if content is still loading (scroll height is changing)
          if (attempts < 10) { // Increased attempts for very long conversations
            setTimeout(() => {
              const el = (messagesContainer.value as any)?.$el || messagesContainer.value;
              if (el && el.scrollHeight > previousHeight) {
                // Content grew, scroll again
                attemptScroll(attempts + 1);
              }
            }, 50); // Reduced delay for more responsive scrolling
          }
        }
      }
    });
  };
  
  attemptScroll();
}

async function createNewConversation() {
  // Use default model from system config, or fallback to first model or hardcoded default
  const defaultModel = store.state.systemConfig?.defaultModel || 
                      store.state.models[0]?.id || 
                      'claude-3.5-sonnet';
  const conversation = await store.createConversation(defaultModel);
  router.push(`/conversation/${conversation.id}`);
  // Load participants for the new conversation
  await loadParticipants();
  
  // Automatically open the settings dialog for the new conversation
  // Use nextTick to ensure the route has changed and currentConversation is updated
  await nextTick();
  conversationSettingsDialog.value = true;
}

async function sendMessage() {
  const content = messageInput.value.trim();
  if (!content || isStreaming.value) return;
  
  console.log('ConversationView sendMessage:', content);
  console.log('Current visible messages:', messages.value.length);
  console.log('Selected parent branch:', selectedBranchForParent.value);
  
  const attachmentsCopy = [...attachments.value];
  messageInput.value = '';
  attachments.value = [];
  
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
    
    // Pass the selected parent branch if one is selected
    const parentBranchId = selectedBranchForParent.value?.branchId;
      
    await store.sendMessage(content, participantId, responderId, attachmentsCopy, parentBranchId);
    
    // Clear selection after successful send
    if (selectedBranchForParent.value) {
      selectedBranchForParent.value = null;
    }
  } catch (error) {
    console.error('Failed to send message:', error);
    messageInput.value = content; // Restore input on error
  }
}

async function continueGeneration() {
  if (isStreaming.value) return;
  
  console.log('ConversationView continueGeneration');
  console.log('Selected parent branch:', selectedBranchForParent.value);
  
  try {
    let responderId: string | undefined;
    
    if (currentConversation.value?.format === 'standard') {
      // For standard format, use default assistant
      const defaultAssistant = participants.value.find(p => p.type === 'assistant' && p.name === 'Assistant');
      responderId = defaultAssistant?.id;
    } else {
      // For other formats, use selected responder
      responderId = selectedResponder.value || undefined;
    }
    
    // Pass the selected parent branch if one is selected
    const parentBranchId = selectedBranchForParent.value?.branchId;
    
    // Send empty message to trigger AI response
    await store.continueGeneration(responderId, parentBranchId);
    
    // Clear selection after successful continue
    if (selectedBranchForParent.value) {
      selectedBranchForParent.value = null;
    }
  } catch (error) {
    console.error('Failed to continue generation:', error);
  }
}

async function triggerModelResponse(model: Model) {
  if (isStreaming.value || !currentConversation.value) return;
  
  console.log('Triggering response from model:', model.displayName);
  
  try {
    // Check if this model is already a participant
    let participant = participants.value.find(p => 
      p.type === 'assistant' && p.model === model.id
    );
    
    if (!participant) {
      // Create a new participant for this model
      console.log('Creating new participant for model:', model.displayName);
      
      const response = await fetch(`/api/participants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          conversationId: currentConversation.value.id,
          name: model.shortName || model.displayName,
          type: 'assistant',
          model: model.id,
          settings: {
            temperature: 1.0,
            maxTokens: 1024
          }
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to create participant');
      }
      
      participant = await response.json();
      
      // Reload participants to ensure UI is in sync
      await loadParticipants();
    }
    
    // Set the responder to this participant
    if (participant) {
      selectedResponder.value = participant.id;
      
      // Trigger the response
      await continueGeneration();
    }
  } catch (error) {
    console.error('Error triggering model response:', error);
  }
}

async function triggerParticipantResponse(participant: Participant) {
  if (isStreaming.value || !currentConversation.value) return;
  
  console.log('Triggering response from participant:', participant.name);
  
  // Set the responder to this participant
  selectedResponder.value = participant.id;
  
  // Trigger the response
  await continueGeneration();
}

async function regenerateMessage(messageId: string, branchId: string) {
  await store.regenerateMessage(messageId, branchId);
}

async function editMessage(messageId: string, branchId: string, content: string) {
  // Pass the currently selected responder for multi-participant mode
  let responderId: string | undefined;
  
  if (currentConversation.value?.format === 'standard') {
    // For standard format, use default assistant
    const defaultAssistant = participants.value.find(p => p.type === 'assistant' && p.name === 'Assistant');
    responderId = defaultAssistant?.id;
  } else {
    // For other formats, use selected responder
    responderId = selectedResponder.value || undefined;
  }
  
  await store.editMessage(messageId, branchId, content, responderId);
}

function switchBranch(messageId: string, branchId: string) {
  store.switchBranch(messageId, branchId);
}

async function navigateToTreeBranch(messageId: string, branchId: string) {
  console.log('Navigating to branch:', messageId, branchId);
  
  // Build path from target branch back to root
  const pathToRoot: { messageId: string, branchId: string }[] = [];
  
  // Find the target branch and trace back to root
  let currentBranchId: string | undefined = branchId;
  
  while (currentBranchId && currentBranchId !== 'root') {
    // Find the message containing this branch
    const message = allMessages.value.find(m => 
      m.branches.some(b => b.id === currentBranchId)
    );
    
    if (!message) {
      console.error('Could not find message for branch:', currentBranchId);
      break;
    }
    
    // Add to path
    pathToRoot.unshift({ messageId: message.id, branchId: currentBranchId });
    
    // Find the branch to get its parent
    const branch = message.branches.find(b => b.id === currentBranchId);
    if (!branch) break;
    
    currentBranchId = branch.parentBranchId;
  }
  
  console.log('Path to switch:', pathToRoot);
  
  // Switch branches along the path
  for (const { messageId: msgId, branchId: brId } of pathToRoot) {
    const message = allMessages.value.find(m => m.id === msgId);
    if (message && message.activeBranchId !== brId) {
      console.log('Switching branch:', msgId, brId);
      store.switchBranch(msgId, brId);
    }
  }
  
  // Wait for DOM to update, then scroll to the clicked message
  await nextTick();
  setTimeout(() => {
    const messageElement = document.getElementById(`message-${messageId}`);
    if (messageElement) {
      messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Add a brief highlight effect
      messageElement.classList.add('highlight-message');
      setTimeout(() => {
        messageElement.classList.remove('highlight-message');
      }, 2000);
    }
  }, 100); // Small delay to ensure messages are rendered
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

// Attachment handling functions
function triggerFileInput(event: Event) {
  console.log('triggerFileInput called, event:', event);
  event.preventDefault();
  event.stopPropagation();
  
  // Create a new file input and click it immediately
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt,.md,.csv,.json,.xml,.html,.css,.js,.ts,.py,.java,.cpp,.c,.h,.hpp,.jpg,.jpeg,.png,.gif,.webp,.svg';
  input.multiple = true;
  input.style.display = 'none';
  
  input.addEventListener('change', handleFileSelect);
  
  document.body.appendChild(input);
  input.click();
  
  // Clean up after a short delay
  setTimeout(() => {
    document.body.removeChild(input);
  }, 100);
}

async function handleFileSelect(event: Event) {
  console.log('handleFileSelect called');
  const input = event.target as HTMLInputElement;
  if (!input.files) {
    console.log('No files selected');
    return;
  }
  
  console.log(`Processing ${input.files.length} files`);
  for (const file of Array.from(input.files)) {
    console.log(`Reading file: ${file.name} (${file.size} bytes)`);
    
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
    const isImage = imageExtensions.includes(fileExtension);
    
    let content: string;
    if (isImage) {
      // Read image as base64
      content = await readFileAsBase64(file);
    } else {
      // Read text files as text
      content = await readFileAsText(file);
    }
    
    attachments.value.push({
      fileName: file.name,
      fileType: fileExtension,
      fileSize: file.size,
      content,
      isImage
    });
    console.log(`Added ${isImage ? 'image' : 'text'} attachment: ${file.name}`);
  }
  
  console.log(`Total attachments: ${attachments.value.length}`);
  // Reset input
  input.value = '';
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      // Extract base64 data (remove data:image/...;base64, prefix)
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function removeAttachment(index: number) {
  attachments.value.splice(index, 1);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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
    
    // If format changed, reload participants to get the new defaults
    if ('format' in updates) {
      await loadParticipants();
    }
  }
}

async function switchToGroupChat() {
  if (!currentConversation.value) return;
  
  // Update the conversation format to 'prefill' (multi-participant)
  await updateConversationSettings({ format: 'prefill' });
  
  // Open the settings dialog to configure participants
  conversationSettingsDialog.value = true;
}

async function deleteMessage(messageId: string, branchId: string) {
  if (confirm('Are you sure you want to delete this message and all its replies?')) {
    await store.deleteMessage(messageId, branchId);
  }
}

function selectBranchAsParent(messageId: string, branchId: string) {
  // Toggle selection - if already selected, deselect
  if (selectedBranchForParent.value?.messageId === messageId && 
      selectedBranchForParent.value?.branchId === branchId) {
    selectedBranchForParent.value = null;
  } else {
    selectedBranchForParent.value = { messageId, branchId };
  }
}

function stopAutoScroll() {
  autoScrollEnabled.value = false;
}

function cancelBranchSelection() {
  selectedBranchForParent.value = null;
}

function getProviderIcon(provider: string): string {
  switch (provider) {
    case 'anthropic':
      return 'mdi-asterisk';
    case 'bedrock':
      return 'mdi-aws';
    case 'openrouter':
      return 'mdi-router';
    case 'openai':
    case 'openai-compatible':
      return 'mdi-camera-iris';
    default:
      return 'mdi-robot-outline';
  }
}

function getParticipantIcon(participant: Participant): string {
  if (participant.type === 'user') {
    return 'mdi-account';
  }
  
  // For assistants, find the model to get the provider
  const model = store.state.models.find(m => m.id === participant.model);
  if (model) {
    return getProviderIcon(model.provider);
  }
  
  return 'mdi-robot-outline';
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
        // Participant was deleted (only if not a temp ID)
        if (!existing.id.startsWith('temp-')) {
          await api.delete(`/participants/${existing.id}`);
        }
      } else if (!existing.id.startsWith('temp-')) {
        // Check if participant was actually updated by comparing relevant fields
        const hasChanges = 
          existing.name !== updated.name ||
          existing.model !== updated.model ||
          existing.systemPrompt !== updated.systemPrompt ||
          existing.settings?.temperature !== updated.settings?.temperature ||
          existing.settings?.maxTokens !== updated.settings?.maxTokens;
        
        if (hasChanges) {
          // Participant was updated
          const updateData = {
            name: updated.name,
            model: updated.model,
            systemPrompt: updated.systemPrompt,
            settings: updated.settings
          };
          
          console.log('Updating participant:', existing.id, updateData);
          
          try {
            await api.patch(`/participants/${existing.id}`, updateData);
          } catch (error: any) {
            console.error('Failed to update participant:', error.response?.data || error);
            throw error;
          }
        }
      }
    }
    
    // Handle new participants
    for (const participant of updatedParticipants) {
      if (participant.id.startsWith('temp-')) {
        // New participant
        const createData = {
          conversationId: currentConversation.value.id,
          name: participant.name,
          type: participant.type,
          model: participant.model,
          systemPrompt: participant.systemPrompt,
          settings: participant.settings
        };
        
        console.log('Creating participant:', createData);
        
        try {
          await api.post('/participants', createData);
        } catch (error: any) {
          console.error('Failed to create participant:', error.response?.data || error);
          throw error;
        }
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

// Cache for conversation participants to avoid repeated API calls
const conversationParticipantsCache = ref<Record<string, any[]>>({});

// Branch structure analysis function (disabled - only reports issues, doesn't fix)
// async function fixConversationBranches() {
//   if (!currentConversation.value) return;
  
//   const conversationId = currentConversation.value.id;
//   console.log(`Analyzing branch structure for conversation: ${conversationId}`);
  
//   try {
//     const token = localStorage.getItem('token');
//     if (!token) {
//       alert('Not authenticated');
//       return;
//     }
    
//     const response = await fetch(`http://localhost:3010/api/conversations/${conversationId}/fix-branches`, {
//       method: 'POST',
//       headers: {
//         'Authorization': `Bearer ${token}`,
//         'Content-Type': 'application/json'
//       }
//     });
    
//     const result = await response.json();
    
//     if (response.ok) {
//       console.log('Branch structure analysis:', result);
//       alert(`Branch structure analysis complete!\n\nCheck console for details.`);
      
//       // Reload the conversation to see any changes
//       await store.loadConversation(conversationId);
//     } else {
//       console.error('Failed to analyze branches:', result);
//       alert(`Failed to analyze branches: ${result.error || 'Unknown error'}`);
//     }
//   } catch (error) {
//     console.error('Error analyzing branches:', error);
//     alert('Error analyzing branches. Check console for details.');
//   }
// }

async function importRawMessages() {
  if (!currentConversation.value || !rawImportData.value.trim()) return;
  
  const conversationId = currentConversation.value.id;
  
  try {
    // Parse the JSON to validate it
    const messages = JSON.parse(rawImportData.value);
    if (!Array.isArray(messages)) {
      alert('Invalid format: Expected a JSON array of messages');
      return;
    }
    
    console.log(`Importing ${messages.length} messages to conversation ${conversationId}`);
    
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Not authenticated');
      return;
    }
    
    const response = await fetch(`http://localhost:3010/api/import/messages-raw`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        conversationId,
        messages
      })
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('Messages imported:', result);
      alert(`Successfully imported ${result.importedMessages} messages!`);
      
      // Clear the input and close dialog
      rawImportData.value = '';
      showRawImportDialog.value = false;
      
      // Reload the conversation to see the imported messages
      await store.loadConversation(conversationId);
    } else {
      console.error('Failed to import messages:', result);
      alert(`Failed to import messages: ${result.error || 'Unknown error'}`);
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      alert('Invalid JSON format. Please check your input.');
    } else {
      console.error('Error importing messages:', error);
      alert('Error importing messages. Check console for details.');
    }
  }
}

async function loadConversationParticipants(conversationId: string) {
  if (conversationParticipantsCache.value[conversationId]) {
    return conversationParticipantsCache.value[conversationId];
  }
  
  try {
    const response = await api.get(`/participants/conversation/${conversationId}`);
    const participants = response.data;
    conversationParticipantsCache.value[conversationId] = participants;
    return participants;
  } catch (error) {
    console.error('Failed to load participants for conversation:', conversationId, error);
    return [];
  }
}

function getConversationModelsHtml(conversation: Conversation): string {
  if (!conversation) return '';
  
  // For standard conversations, show the model name
  if (conversation.format === 'standard' || !conversation.format) {
    const model = store.state.models.find(m => m.id === conversation.model);
    const modelName = model ? model.displayName
      .replace('Claude ', '')
      .replace(' (Bedrock)', ' B')
      .replace(' (OpenRouter)', ' OR') : conversation.model;
    
    const color = getModelColor(conversation.model);
    return `<span style="color: ${color}; font-weight: 500;">${modelName}</span>`;
  }
  
  // For multi-participant conversations, try to show participant models
  const cachedParticipants = conversationParticipantsCache.value[conversation.id];
  if (cachedParticipants) {
    const assistants = cachedParticipants.filter(p => p.type === 'assistant' && p.isActive);
    if (assistants.length > 0) {
      const modelSpans = assistants.map(a => {
        const model = store.state.models.find(m => m.id === a.model);
        const modelName = model ? model.displayName
          .replace('Claude ', '')
          .replace(' (Bedrock)', ' B')
          .replace(' (OpenRouter)', ' OR') : (a.model || 'Default');
        
        const color = getModelColor(a.model);
        return `<span style="color: ${color}; font-weight: 500;">${modelName}</span>`;
      });
      
      return modelSpans.join(' • ');
    }
  }
  
  return '<span style="color: #757575; font-weight: 500;">Group Chat</span>';
}

function getConversationModels(conversation: Conversation): string {
  if (!conversation) return '';
  
  // For standard conversations, show the model name
  if (conversation.format === 'standard' || !conversation.format) {
    const model = store.state.models.find(m => m.id === conversation.model);
    if (model) {
      // Shorten the display name if needed
      return model.displayName
        .replace('Claude ', '')
        .replace(' (Bedrock)', ' B')
        .replace(' (OpenRouter)', ' OR');
    }
    return conversation.model;
  }
  
  // For multi-participant conversations, try to show participant models
  const cachedParticipants = conversationParticipantsCache.value[conversation.id];
  if (cachedParticipants) {
    const assistants = cachedParticipants.filter(p => p.type === 'assistant' && p.isActive);
    if (assistants.length > 0) {
      const modelNames = assistants.map(a => {
        const model = store.state.models.find(m => m.id === a.model);
        if (model) {
          return model.displayName
            .replace('Claude ', '')
            .replace(' (Bedrock)', ' B')
            .replace(' (OpenRouter)', ' OR');
        }
        return a.model || 'Default';
      });
      
      // Remove duplicates and join
      const uniqueModels = [...new Set(modelNames)];
      return `👥 ${uniqueModels.join(', ')}`;
    }
  }
  
  // Fallback - load participants async and trigger re-render
  loadConversationParticipants(conversation.id).then(() => {
    // This will trigger a re-render when the data is loaded
    conversationParticipantsCache.value = { ...conversationParticipantsCache.value };
  });
  
  return '👥 Group Chat';
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

/* Clickable chip styles */
.clickable-chip {
  cursor: pointer;
  transition: all 0.2s ease;
}

.clickable-chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.highlight-message {
  animation: highlight-pulse 2s ease-out;
}

@keyframes highlight-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(25, 118, 210, 0.7);
  }
  50% {
    box-shadow: 0 0 20px 10px rgba(25, 118, 210, 0.3);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(25, 118, 210, 0);
  }
}

.clickable-chip:active {
  transform: translateY(0);
}
</style>
