<template>
  <v-layout class="rounded rounded-md">
    <!-- Sidebar -->
    <v-navigation-drawer
      v-if="!isMobile || mobilePanel === 'sidebar'"
      v-model="drawer"
      :permanent="!isMobile"
      :temporary="isMobile"
      :scrim="isMobile"
      class="sidebar-drawer"
      :class="{ 'sidebar-drawer--mobile': isMobile }"
    >
      <div class="d-flex flex-column h-100">
        <!-- Fixed header section -->
        <div class="sidebar-header">
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
              <template v-slot:append v-if="isMobile">
                <v-btn
                  icon="mdi-close"
                  variant="text"
                  size="small"
                  @click="closeMobileSidebar"
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
            
            <v-list-item
              prepend-icon="mdi-share-variant"
              title="Manage Shares"
              @click="manageSharesDialog = true"
            />
          </v-list>

          <v-divider />
        </div>

        <!-- Scrollable conversations section -->
        <div class="sidebar-conversations flex-grow-1">
          <v-list density="compact" nav>
            <v-list-subheader>Conversations</v-list-subheader>
            
            <v-list-item
              v-for="conversation in conversations"
              :key="conversation.id"
              :to="`/conversation/${conversation.id}`"
              class="conversation-list-item"
              :lines="'three'"
              @click="handleConversationClick(conversation.id)"
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
                      prepend-icon="mdi-share-variant"
                      title="Share"
                      @click="shareConversation(conversation)"
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
        </div>

        <!-- Fixed footer section -->
        <div class="sidebar-footer">
          <v-divider />
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
        </div>
      </div>
    </v-navigation-drawer>

    <!-- Main Content -->
    <v-main
      v-if="!isMobile || mobilePanel === 'conversation'"
      class="d-flex flex-column"
      style="height: 100vh;"
    >
      <!-- Top Bar -->
      <v-app-bar density="compact">
        <v-app-bar-nav-icon v-if="!isMobile" @click="drawer = !drawer" />
        <v-btn
          v-else
          icon="mdi-menu"
          variant="text"
          @click="mobilePanel = 'sidebar'"
          title="Show conversation list"
        />

        <!-- Breadcrumb navigation with fixed title and scrollable bookmarks -->
        <div v-if="currentConversation" class="d-flex align-center breadcrumb-container">
          <!-- Conversation Title (always visible) -->
          <div
            class="conversation-title cursor-pointer"
            @click="scrollToTop"
          >
            {{ currentConversation.title || 'New Conversation' }}
          </div>

          <!-- Scrollable bookmarks section -->
          <div v-if="bookmarksInActivePath.length > 0" class="d-flex align-center bookmarks-scroll-container">
            <v-icon icon="mdi-map-marker-right" size="small" class="mx-0" />
            <div ref="bookmarksScrollRef" class="bookmarks-scroll">
              <div class="d-flex align-center">
                <template v-for="(bookmark, index) in bookmarksInActivePath" :key="bookmark.id">
                  <span
                    :ref="el => bookmarkRefs[index] = el as HTMLElement"
                    class="bookmark-item cursor-pointer"
                    :class="{ 'bookmark-current': index === currentBookmarkIndex }"
                    @click="scrollToMessage(bookmark.messageId)"
                  >
                    {{ bookmark.label }}
                  </span>
                  <v-icon
                    v-if="index < bookmarksInActivePath.length - 1"
                    icon="mdi-chevron-right"
                    size="small"
                    class="mx-0"
                    :style="{ opacity: index < currentBookmarkIndex ? 0.4 : 1 }"
                  />
                </template>
              </div>
            </div>
          </div>
        </div>

        <v-spacer class="breadcrumb-spacer"/>
        
        <v-chip 
          class="mr-2 clickable-chip" 
          size="small"
          variant="outlined"
          :color="currentConversation?.format === 'standard' ? getModelColor(currentConversation?.model) : 'info'"
          @click="conversationSettingsDialog = true"
        >
          <v-icon v-if="currentConversation?.format !== 'standard'" class="mr-2">mdi-account-group</v-icon>
          {{ currentConversation?.format !== 'standard' ? 'Group Chat' : currentModel?.displayName || 'Select Model' }}
          <v-icon size="small" class="ml-1">mdi-cog-outline</v-icon>
          <v-tooltip activator="parent" location="bottom">
            Click to change model and settings
          </v-tooltip>
        </v-chip>
        
        <!-- Metrics Display -->
        <MetricsDisplay 
          v-if="currentConversation"
          :conversation-id="currentConversation.id"
          class="mr-2"
        />
        
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
        style="max-height: calc(100vh - 160px);"
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
            :error-suggestion="streamingError?.messageId === message.id ? streamingError.suggestion : undefined"
            @regenerate="regenerateMessage"
            @edit="editMessage"
            @switch-branch="switchBranch"
            @delete="deleteMessage"
            @select-as-parent="selectBranchAsParent"
            @stop-auto-scroll="stopAutoScroll"
            @bookmark-changed="handleBookmarkChanged"
          />
        </div>
      </v-container>

      <!-- Input Area -->
      <v-container v-if="currentConversation" class="pa-4" style="padding-top: 0 !important">
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
        
        <!-- MOBILE CONTROLS -->
        <template v-if="isMobile">
          <!-- Quick access pills - horizontally scrollable -->
          <div v-if="currentConversation.format !== 'standard' && (participantsByLastSpoken.length > 0 || suggestedNonParticipantModels.length > 0)" 
               class="mobile-quick-access mb-2">
            <div class="mobile-pills-scroll">
              <v-chip
                v-for="participant in participantsByLastSpoken"
                :key="participant.id"
                :color="getModelColor(participant.model || '')"
                size="small"
                variant="outlined"
                @click="triggerParticipantResponse(participant)"
                :disabled="isStreaming"
                class="mobile-pill"
              >
                <v-icon size="x-small" start>{{ getParticipantIcon(participant) }}</v-icon>
                {{ participant.name === '' ? (participant.model?.split(' ').pop() || 'Continue') : participant.name }}
              </v-chip>
              
              <template v-for="model in suggestedNonParticipantModels" :key="model?.id">
                <v-chip
                  v-if="model"
                  color="grey"
                  size="small"
                  variant="outlined"
                  @click="triggerModelResponse(model)"
                  :disabled="isStreaming"
                  class="mobile-pill"
                >
                  <v-icon size="x-small" start>mdi-plus</v-icon>
                  {{ model.shortName || model.displayName }}
                </v-chip>
              </template>
            </div>
          </div>
          
          <!-- Main control row: Settings + Responder dropdown + Send -->
          <div class="mobile-main-controls mb-2">
            <v-btn
              icon
              size="small"
              variant="tonal"
              color="primary"
              @click="conversationSettingsDialog = true"
              class="mobile-settings-btn"
            >
              <v-icon>{{ currentConversation?.format !== 'standard' ? 'mdi-account-group' : 'mdi-cog' }}</v-icon>
            </v-btn>
            
            <v-select
              v-if="currentConversation.format !== 'standard'"
              v-model="selectedResponder"
              :items="responderOptions"
              item-title="name"
              item-value="id"
              label="Response from"
              density="compact"
              variant="outlined"
              hide-details
              class="mobile-responder-select"
            >
              <template v-slot:selection="{ item }">
                <div class="d-flex align-center">
                  <v-icon 
                    :icon="item.raw.type === 'user' ? 'mdi-account' : 'mdi-robot'"
                    :color="item.raw.type === 'user' ? '#bb86fc' : getModelColor(item.raw.model || '')"
                    size="small"
                    class="mr-1"
                  />
                  <span class="text-truncate" :style="item.raw.type === 'user' ? 'color: #bb86fc;' : `color: ${getModelColor(item.raw.model || '')};`">
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
                </v-list-item>
              </template>
            </v-select>
            
            <!-- Standard mode: show model chip -->
            <v-chip 
              v-else
              variant="outlined"
              :color="getModelColor(currentConversation?.model)"
              @click="conversationSettingsDialog = true"
              class="mobile-model-chip"
            >
              {{ currentModel?.shortName || currentModel?.displayName || 'Model' }}
            </v-chip>
            
            <v-btn
              :disabled="isStreaming"
              :color="continueButtonColor"
              icon="mdi-send"
              variant="tonal"
              size="small"
              @click="continueGeneration"
            />
          </div>
          
          <!-- Speaking as (collapsible, shown only when needed) -->
          <div v-if="currentConversation.format !== 'standard'" class="mobile-speaking-as mb-2">
            <v-btn
              variant="text"
              size="x-small"
              density="compact"
              class="text-caption"
              @click="showMobileSpeakingAs = !showMobileSpeakingAs"
            >
              Speaking as: {{ selectedParticipantName }}
              <v-icon size="x-small" class="ml-1">{{ showMobileSpeakingAs ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
            </v-btn>
            <v-select
              v-if="showMobileSpeakingAs"
              v-model="selectedParticipant"
              :items="allParticipants"
              item-title="name"
              item-value="id"
              density="compact"
              variant="outlined"
              hide-details
              class="mt-1"
            >
              <template v-slot:selection="{ item }">
                <div class="d-flex align-center">
                  <v-icon 
                    :icon="item.raw.type === 'user' ? 'mdi-account' : 'mdi-robot'"
                    :color="item.raw.type === 'user' ? '#bb86fc' : getModelColor(item.raw.model || '')"
                    size="small"
                    class="mr-1"
                  />
                  <span :style="item.raw.type === 'user' ? 'color: #bb86fc;' : `color: ${getModelColor(item.raw.model || '')};`">
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
                </v-list-item>
              </template>
            </v-select>
          </div>
        </template>
        
        <!-- DESKTOP CONTROLS -->
        <template v-else>
          <!-- Model Quick Access Bar -->
          <div v-if="currentConversation.format !== 'standard' && (participantsByLastSpoken.length > 0 || suggestedNonParticipantModels.length > 0)" 
               class="mb-0 d-flex align-center justify-space-around">
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
                style="margin: 0 2px 0 2px; pointer-events: auto;"
                :ripple="false"
                link
              >
                <v-icon size="x-small" start>{{ getParticipantIcon(participant) }}</v-icon>
                {{ participant.name === '' 
                  ? `${participant.model} (continue)`
                  : participant.name }}
                <v-tooltip activator="parent" location="top">
                  {{ participant.name === '' ? `Continue with ${participant.model}` : `Response from ${participant.name}` }}
                </v-tooltip>
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
                  style="margin: 0 2px 0 2px; pointer-events: auto;"
                  :ripple="false"
                  link
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
          
          <div class="mb-2 d-flex gap-2 align-center justify-center">
            <v-chip 
              class="mr-2 clickable-chip" 
              variant="outlined"
              :color="currentConversation?.format === 'standard' ? getModelColor(currentConversation?.model) : 'info'"
              @click="conversationSettingsDialog = true"
            >
              <v-icon v-if="currentConversation?.format !== 'standard'" class="mr-2">mdi-account-group</v-icon>
              {{ currentConversation?.format !== 'standard' ? '' : currentModel?.displayName || 'Select Model' }}
              <v-icon size="small" class="ml-1">mdi-cog-outline</v-icon>
              <v-tooltip activator="parent" location="bottom">
                Click to change model and settings
              </v-tooltip>
            </v-chip>
            <v-select
              v-if="currentConversation.format !== 'standard'"
              v-model="selectedResponder"
              :items="responderOptions"
              item-title="name"
              item-value="id"
              label="Response from"
              density="compact"
              variant="outlined"
              hide-details
              class="flex-grow-1 mr-2"
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
            <v-btn
              :disabled="isStreaming"
              :color="continueButtonColor"
              icon="mdi-send"
              variant="text"
              :title="currentConversation?.format === 'standard' ? 'Continue (Assistant)' : `Continue (${selectedResponderName})`"
              @click="continueGeneration"
              class="mr-2"
            />
            <v-select
              v-if="currentConversation.format !== 'standard'"
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
          </div>
        </template>
        
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
          max-rows="15"
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
              :disabled="!messageInput || isStreaming"
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
      v-if="treeDrawer && (!isMobile || mobilePanel === 'conversation')"
      location="right"
      :width="400"
      permanent
      class="tree-drawer"
    >

      <ConversationTree
        v-if="allMessages.length > 0"
        ref="conversationTreeRef"
        :messages="allMessages"
        :participants="participants"
        :current-message-id="currentMessageId"
        :current-branch-id="currentBranchId"
        :selected-parent-message-id="selectedBranchForParent?.messageId"
        :selected-parent-branch-id="selectedBranchForParent?.branchId"
        @navigate-to-branch="navigateToTreeBranch"
        class="flex-grow-1"
        style="overflow-y: hidden"

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
    
    <ShareDialog
      v-model="shareDialog"
      :conversation="currentConversation"
      :current-branch-id="currentBranchId"
    />
    
    <ManageSharesDialog
      v-model="manageSharesDialog"
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
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { isEqual } from 'lodash-es';
import { useStore } from '@/store';
import { api } from '@/services/api';
import type { Conversation, Message, Participant, Model, Bookmark } from '@deprecated-claude/shared';
import { UpdateParticipantSchema } from '@deprecated-claude/shared';
import MessageComponent from '@/components/MessageComponent.vue';
import ImportDialogV2 from '@/components/ImportDialogV2.vue';
import SettingsDialog from '@/components/SettingsDialog.vue';
import ConversationSettingsDialog from '@/components/ConversationSettingsDialog.vue';
import ShareDialog from '@/components/ShareDialog.vue';
import ManageSharesDialog from '@/components/ManageSharesDialog.vue';
import ArcLogo from '@/components/ArcLogo.vue';
import WelcomeDialog from '@/components/WelcomeDialog.vue';
import ConversationTree from '@/components/ConversationTree.vue';
import MetricsDisplay from '@/components/MetricsDisplay.vue';
import { getModelColor } from '@/utils/modelColors';

const route = useRoute();
const router = useRouter();
const store = useStore();

type MobilePanel = 'sidebar' | 'conversation';
const MOBILE_BREAKPOINT = 1024;

// DEBUG: Verify new code is loaded
console.log('🔧 ConversationView loaded - UI bug fixes version - timestamp:', new Date().toISOString());

const drawer = ref(true);
const isMobile = ref(false);
const mobilePanel = ref<MobilePanel>('sidebar');
const treeDrawer = ref(false);
const importDialog = ref(false);
const settingsDialog = ref(false);
const conversationSettingsDialog = ref(false);
const shareDialog = ref(false);
const manageSharesDialog = ref(false);
const showRawImportDialog = ref(false);
const welcomeDialog = ref(false);
const rawImportData = ref('');
const messageInput = ref('');
const isStreaming = ref(false);
const streamingMessageId = ref<string | null>(null);
const autoScrollEnabled = ref(true);
const isSwitchingBranch = ref(false);
const streamingError = ref<{ messageId: string; error: string; suggestion?: string } | null>(null);
const attachments = ref<Array<{ fileName: string; fileType: string; fileSize: number; content: string; isImage?: boolean }>>([]);
const fileInput = ref<HTMLInputElement>();
const updateMobileState = () => {
  if (typeof window === 'undefined') {
    return;
  }
  const wasMobile = isMobile.value;
  isMobile.value = window.innerWidth < MOBILE_BREAKPOINT;
  
  // Sync drawer state when transitioning to/from mobile
  if (isMobile.value && !wasMobile) {
    // Just became mobile - set panel and drawer state
    mobilePanel.value = route.params.id ? 'conversation' : 'sidebar';
    drawer.value = mobilePanel.value === 'sidebar';
  } else if (!isMobile.value && wasMobile) {
    // Just became desktop - drawer should always be open
    drawer.value = true;
  }
};

// Branch selection state
const selectedBranchForParent = ref<{ messageId: string; branchId: string } | null>(null);
const messagesContainer = ref<HTMLElement>();
const participants = ref<Participant[]>([]);
const selectedParticipant = ref<string>('');
const selectedResponder = ref<string>('');
const showMobileSpeakingAs = ref(false);
const conversationTreeRef = ref<InstanceType<typeof ConversationTree>>();
const bookmarks = ref<Bookmark[]>([]);
const bookmarksScrollRef = ref<HTMLElement>();
const bookmarkRefs = ref<HTMLElement[]>([]);
const isUserScrollingBookmarks = ref(false);
const currentBookmarkIndex = ref(0);

// Sort conversations by updatedAt on the client side for real-time updates
const conversations = computed(() => {
  return [...store.state.conversations].sort((a, b) => {
    const dateA = new Date(a.updatedAt).getTime();
    const dateB = new Date(b.updatedAt).getTime();
    return dateB - dateA; // Most recent first
  });
});
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

// Get bookmarks in the order they appear in the active conversation path
const bookmarksInActivePath = computed(() => {
  const visibleMessages = messages.value;
  const result: Array<Bookmark & { messageId: string; branchId: string }> = [];

  for (const message of visibleMessages) {
    const bookmark = bookmarks.value.find(
      b => b.messageId === message.id && b.branchId === message.activeBranchId
    );
    if (bookmark) {
      result.push({
        ...bookmark,
        messageId: message.id,
        branchId: message.activeBranchId
      });
    }
  }

  return result;
});

const selectedResponderName = computed(() => {
  const responder = assistantParticipants.value.find(p => p.id === selectedResponder.value);
  return responder?.name || 'Assistant';
});

const selectedParticipantName = computed(() => {
  const participant = allParticipants.value.find(p => p.id === selectedParticipant.value);
  return participant?.name || 'User';
});

watch(isMobile, (mobile) => {
  if (mobile) {
    mobilePanel.value = route.params.id ? 'conversation' : 'sidebar';
    drawer.value = mobilePanel.value === 'sidebar';
  } else {
    drawer.value = true;
  }
});

watch(mobilePanel, (panel) => {
  if (!isMobile.value) {
    return;
  }
  drawer.value = panel === 'sidebar';
});

// Allow sending as any participant type (user or assistant)
const allParticipants = computed(() => {
  return participants.value.filter(p => p.isActive).map(p => ({
    ...p,
    name: p.name === '' 
      ? (p.type === 'assistant' && p.model ? `${p.model} (continue)` : '(continue)')
      : p.name
  }));
});

const assistantParticipants = computed(() => {
  return participants.value.filter(p => p.type === 'assistant' && p.isActive);
});

const responderOptions = computed(() => {
  const options = [{ id: '', name: 'No response', type: 'none' as any, model: '' }];
  // Include full participant objects to have access to type and model
  const assistantOptions = assistantParticipants.value.map(p => ({
    id: p.id,
    name: p.name === '' 
      ? (p.model ? `${p.model} (continue)` : '(continue)')
      : p.name === 'A' 
      ? `A (${p.model})`
      : p.name,
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
  if (!currentConversation.value || currentConversation.value.format === 'standard' || participants.value.length > 3) {
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

// Watch for new conversations - no longer pre-loading participants
// The sidebar now uses embedded summaries from the backend
watch(conversations, (newConversations) => {
  console.log(`[ConversationView] Loaded ${newConversations.length} conversations with embedded summaries`);
});

// Load initial data
onMounted(async () => {
  if (typeof window !== 'undefined') {
    updateMobileState();
    window.addEventListener('resize', updateMobileState);
    if (isMobile.value) {
      mobilePanel.value = route.params.id ? 'conversation' : 'sidebar';
      drawer.value = mobilePanel.value === 'sidebar';
    }
  }

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
          
          // Update the conversation's updatedAt timestamp to move it to the top
          if (currentConversation.value) {
            const conv = store.state.conversations.find(c => c.id === currentConversation.value!.id);
            if (conv) {
              conv.updatedAt = new Date();
              console.log(`[WebSocket] Updated conversation ${conv.id} timestamp for sorting`);
            }
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
      
      // Listen for conversation updates (e.g., title changes, settings)
      store.state.wsService.on('conversation_updated', (data: any) => {
        console.log('[WebSocket] Conversation updated:', data);
        
        const conv = store.state.conversations.find(c => c.id === data.id);
        if (conv && data.updates) {
          // Update the conversation with new data
          Object.assign(conv, data.updates);
          
          // If updatedAt is included, ensure it's a Date object
          if (data.updates.updatedAt) {
            conv.updatedAt = new Date(data.updates.updatedAt);
          }
        }
      });
      
      // Listen for participant updates
      store.state.wsService.on('participant_created', (data: any) => {
        console.log('[WebSocket] Participant created:', data);
        
        // Invalidate cache for the conversation
        if (data.participant?.conversationId) {
          participantCache.invalidate(data.participant.conversationId);
          
          // Update embedded summary in conversation list
          const conv = conversations.value.find(c => c.id === data.participant.conversationId);
          if (conv && data.participant.type === 'assistant' && data.participant.model) {
            const models = (conv as any).participantModels || [];
            if (!models.includes(data.participant.model)) {
              models.push(data.participant.model);
              (conv as any).participantModels = models;
            }
          }
          
          // Reload if it's the current conversation
          if (currentConversation.value?.id === data.participant.conversationId) {
            loadParticipants();
          }
        }
      });
      
      store.state.wsService.on('participant_updated', (data: any) => {
        console.log('[WebSocket] Participant updated:', data);
        
        // Invalidate cache for the conversation
        const participantId = data.participantId;
        const participant = participants.value.find(p => p.id === participantId);
        if (participant) {
          participantCache.invalidate(participant.conversationId);
          
          // Update embedded summary if model changed
          if (data.updates?.model) {
            const conv = conversations.value.find(c => c.id === participant.conversationId);
            if (conv && conv.format === 'prefill') {
              // Rebuild the model list
              const updatedParticipants = participants.value.map(p => 
                p.id === participantId ? { ...p, ...data.updates } : p
              );
              (conv as any).participantModels = updatedParticipants
                .filter(p => p.type === 'assistant' && p.isActive)
                .map(p => p.model)
                .filter(Boolean);
            }
          }
          
          // Reload if it's the current conversation
          if (currentConversation.value?.id === participant.conversationId) {
            loadParticipants();
          }
        }
      });
      
      store.state.wsService.on('participant_deleted', (data: any) => {
        console.log('[WebSocket] Participant deleted:', data);
        
        // Find the conversation this participant belonged to
        const participant = participants.value.find(p => p.id === data.participantId);
        if (participant) {
          participantCache.invalidate(participant.conversationId);
          
          // Update embedded summary
          const conv = conversations.value.find(c => c.id === participant.conversationId);
          if (conv && conv.format === 'prefill') {
            const remainingParticipants = participants.value
              .filter(p => p.id !== data.participantId && p.type === 'assistant' && p.isActive);
            (conv as any).participantModels = remainingParticipants
              .map(p => p.model)
              .filter(Boolean);
          }
          
          // Reload if it's the current conversation
          if (currentConversation.value?.id === participant.conversationId) {
            loadParticipants();
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
            error: data.error || 'Failed to generate response',
            suggestion: data.suggestion
          };
          isStreaming.value = false;
          // Don't clear streamingMessageId so we can show the error on the right message
        }
      });
    }
  });
  
  // Note: loadConversationParticipants was removed - sidebar now uses embedded summaries
  
  // Show welcome dialog on first visit
  const hideWelcome = localStorage.getItem('hideWelcomeDialog');
  if (!hideWelcome) {
    welcomeDialog.value = true;
  }
  
  // Load conversation from route
  if (route.params.id) {
    await store.loadConversation(route.params.id as string);
    await loadParticipants();
    await loadBookmarks();
    // Scroll to bottom after messages load
    await nextTick();
    // Add small delay for long conversations
    setTimeout(() => {
      scrollToBottom();
    }, 100);

    if (isMobile.value) {
      mobilePanel.value = 'conversation';
      drawer.value = false;
    }
  }

});

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateMobileState);
  }
});

// Watch route changes
watch(() => route.params.id, async (newId) => {
  if (isMobile.value) {
    mobilePanel.value = newId ? 'conversation' : 'sidebar';
  }
  if (newId) {
    // Clear selected branch when switching conversations
    if (selectedBranchForParent.value) {
      cancelBranchSelection();
    }

    await store.loadConversation(newId as string);
    await loadParticipants();
    await loadBookmarks();
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
  // Don't auto-scroll if we're switching branches via the navigation arrows
  if (autoScrollEnabled.value && !isSwitchingBranch.value) {
    nextTick(() => {
      scrollToBottom(true); // Smooth scroll for new messages
    });
  }
}, { deep: true });

// Set up scroll sync for breadcrumb navigation
let scrollTimeout: number;
watch(messagesContainer, (container) => {
  if (container) {
    // Vuetify components expose their DOM element via $el
    const element = (container as any).$el || container;

    if (element && element.addEventListener) {
      const handleScroll = () => {
        // Debounce the sync to avoid too many calls
        clearTimeout(scrollTimeout);
        scrollTimeout = window.setTimeout(() => {
          syncBreadcrumbScroll();
        }, 50);
      };

      element.addEventListener('scroll', handleScroll);
    }
  }
});

// Track when user is manually scrolling bookmarks to prevent sync
let userScrollTimeout: number;
watch(bookmarksScrollRef, (scrollEl) => {
  if (scrollEl) {
    const handleBookmarkScroll = () => {
      isUserScrollingBookmarks.value = true;
      clearTimeout(userScrollTimeout);
      userScrollTimeout = window.setTimeout(() => {
        isUserScrollingBookmarks.value = false;
      }, 150);
    };

    scrollEl.addEventListener('scroll', handleBookmarkScroll);
  }
});

// Watch for branch changes to clear selected parent if it's no longer in active path
watch(messages, () => {
  if (selectedBranchForParent.value && messages.value.length > 0) {
    const { messageId, branchId } = selectedBranchForParent.value;
    
    // Check if the selected branch is still in the active path
    let isInActivePath = false;
    
    // Find the message with the selected branch
    const selectedMessage = messages.value.find(m => m.id === messageId);
    if (selectedMessage && selectedMessage.activeBranchId === branchId) {
      // Now trace forward from this message to see if it leads to the current position
      let currentMsg = selectedMessage;
      const currentBranch = currentMsg.branches.find(b => b.id === branchId);
      
      if (currentBranch) {
        // Check if any message has this branch as its parent in the active path
        isInActivePath = messages.value.some(msg => {
          const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId);
          return activeBranch && activeBranch.parentBranchId === branchId;
        });
        
        // Also check if this is the last message (no children)
        if (!isInActivePath && messages.value[messages.value.length - 1]?.id === messageId) {
          isInActivePath = true;
        }
      }
    }
    
    // Clear selection if it's not in the active path
    if (!isInActivePath) {
      cancelBranchSelection();
    }
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

function closeMobileSidebar() {
  // Go back to conversation view on mobile
  // If there's a current conversation, show it; otherwise just hide the sidebar
  if (route.params.id) {
    mobilePanel.value = 'conversation';
  } else {
    // No conversation selected - could navigate to most recent or just close
    const recentConversation = conversations.value[0];
    if (recentConversation) {
      router.push(`/conversation/${recentConversation.id}`);
      mobilePanel.value = 'conversation';
    }
  }
}

async function createNewConversation() {
  // Use default model from system config, or fallback to first model or hardcoded default
  const defaultModel = store.state.systemConfig?.defaultModel || 
                      store.state.models[0]?.id || 
                      'claude-3.6-sonnet';
  const conversation = await store.createConversation(defaultModel);
  router.push(`/conversation/${conversation.id}`);
  // Load participants for the new conversation
  await loadParticipants();
  
  if (isMobile.value) {
    mobilePanel.value = 'conversation';
  }

  // Automatically open the settings dialog for the new conversation
  // Use nextTick to ensure the route has changed and currentConversation is updated
  await nextTick();
  conversationSettingsDialog.value = true;
}

async function sendMessage() {
  // const content = messageInput.value.trim();
  const content = messageInput.value;
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
  isSwitchingBranch.value = true;
  store.switchBranch(messageId, branchId);
  // Reset the flag after a short delay to allow the watch to process
  setTimeout(() => {
    isSwitchingBranch.value = false;
  }, 100);
}

async function navigateToTreeBranch(messageId: string, branchId: string) {
  console.log('=== NAVIGATE TO TREE BRANCH ===');
  console.log('Target:', { messageId, branchId });
  console.log('All messages count:', allMessages.value.length);
  console.log('First 3 message IDs:', allMessages.value.slice(0, 3).map(m => m.id));
  
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
      console.log('Available messages:', allMessages.value.map(m => ({
        id: m.id,
        branchIds: m.branches.map(b => b.id)
      })));
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
  
  // Set flag to prevent auto-scrolling during branch switches
  isSwitchingBranch.value = true;
  
  // Switch branches along the path
  for (const { messageId: msgId, branchId: brId } of pathToRoot) {
    const message = allMessages.value.find(m => m.id === msgId);
    if (message && message.activeBranchId !== brId) {
      console.log('Switching branch:', msgId, brId);
      store.switchBranch(msgId, brId);
    }
  }
  
  // Reset the flag after branches are switched
  setTimeout(() => {
    isSwitchingBranch.value = false;
  }, 100);
  
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

function shareConversation(conversation: Conversation) {
  // Navigate to the conversation if it's not the current one
  if (currentConversation.value?.id !== conversation.id) {
    router.push(`/conversation/${conversation.id}`);
  }
  // Open the share dialog
  shareDialog.value = true;
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

function handleConversationClick(_conversationId: string) {
  if (isMobile.value) {
    mobilePanel.value = 'conversation';
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

async function loadBookmarks() {
  try {
    const conversationId = currentConversation.value?.id;
    if (!conversationId) return;

    const response = await api.get(`/bookmarks/conversation/${conversationId}`);
    bookmarks.value = response.data;
  } catch (error) {
    console.error('Failed to load bookmarks:', error);
  }
}

async function handleBookmarkChanged() {
  // Reload bookmarks in both the view and the tree
  await loadBookmarks();
  if (conversationTreeRef.value) {
    await (conversationTreeRef.value as any).loadBookmarks();
  }
}

function scrollToMessage(messageId: string) {
  const element = document.getElementById(`message-${messageId}`);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function scrollToTop() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// Sync breadcrumb scroll position with page scroll
function syncBreadcrumbScroll() {
  if (!messagesContainer.value || !bookmarksScrollRef.value || bookmarksInActivePath.value.length === 0) {
    return;
  }

  // Don't sync if user is manually scrolling the bookmarks
  if (isUserScrollingBookmarks.value) {
    return;
  }

  // Vuetify components expose their DOM element via $el
  const container = (messagesContainer.value as any).$el || messagesContainer.value;
  if (!container || !container.scrollTop) return;

  const containerRect = container.getBoundingClientRect();

  // Find the lowest visible message (bottom of viewport)
  let lowestVisibleMessageId: string | null = null;

  for (const message of messages.value) {
    const element = document.getElementById(`message-${message.id}`);
    if (!element) continue;

    const rect = element.getBoundingClientRect();
    // Check if message is at least partially visible in viewport
    if (rect.top < containerRect.bottom && rect.bottom > containerRect.top) {
      lowestVisibleMessageId = message.id;
    }
  }

  if (!lowestVisibleMessageId) return;

  // Find the last bookmark in the ancestry of the lowest visible message
  let lastBookmarkIndex = -1;
  for (let i = bookmarksInActivePath.value.length - 1; i >= 0; i--) {
    const bookmark = bookmarksInActivePath.value[i];
    const bookmarkMsgIndex = messages.value.findIndex(m => m.id === bookmark.messageId);
    const currentMsgIndex = messages.value.findIndex(m => m.id === lowestVisibleMessageId);

    if (bookmarkMsgIndex <= currentMsgIndex) {
      lastBookmarkIndex = i;
      break;
    }
  }

  // Update current bookmark index for opacity styling
  // -1 means we're before the first bookmark (no bookmark should be highlighted)
  currentBookmarkIndex.value = lastBookmarkIndex;

  const scrollContainer = bookmarksScrollRef.value;

  // If we're before the first bookmark, scroll to the beginning of the list
  if (lastBookmarkIndex === -1) {
    const currentScroll = scrollContainer.scrollLeft;
    if (currentScroll > 0) {
      scrollContainer.scrollTo({ left: 0, behavior: 'smooth' });
    }
    return;
  }

  // Otherwise, scroll the current bookmark into view if needed
  const bookmarkEl = bookmarkRefs.value[lastBookmarkIndex];
  if (!bookmarkEl) return;

  // Check if the bookmark is already in view in the navigator
  const navRect = scrollContainer.getBoundingClientRect();
  const bookmarkRect = bookmarkEl.getBoundingClientRect();

  const isInView = bookmarkRect.left >= navRect.left && bookmarkRect.right <= navRect.right;

  // Only scroll if bookmark is out of view
  if (!isInView) {
    bookmarkEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
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
  
  console.log('[ConversationView] loadParticipants called');
  
  // Check cache first
  const cached = participantCache.get(currentConversation.value.id);
  if (cached) {
    console.log('[ConversationView] Using cached participants');
    participants.value = cached;
    
    // Set default selected participant
    const defaultUser = participants.value.find(p => p.type === 'user' && p.isActive);
    if (defaultUser) {
      selectedParticipant.value = defaultUser.id;
    }
    
    // Set default responder to first assistant
    const defaultAssistant = participants.value.find(p => p.type === 'assistant' && p.isActive);
    if (defaultAssistant) {
      console.log('[ConversationView] Setting selectedResponder to:', defaultAssistant.id, 'model:', defaultAssistant.model);
      selectedResponder.value = defaultAssistant.id;
    }
    return;
  }
  
  try {
    const response = await api.get(`/participants/conversation/${currentConversation.value.id}`);
    console.log('[ConversationView] Loaded participants from backend:', response.data);
    participants.value = response.data;
    
    // Cache the loaded participants
    participantCache.set(currentConversation.value.id, response.data);
    
    // Set default selected participant
    const defaultUser = participants.value.find(p => p.type === 'user' && p.isActive);
    if (defaultUser) {
      selectedParticipant.value = defaultUser.id;
    }
    
    // Set default responder to first assistant
    const defaultAssistant = participants.value.find(p => p.type === 'assistant' && p.isActive);
    if (defaultAssistant) {
      console.log('[ConversationView] Setting selectedResponder to:', defaultAssistant.id, 'model:', defaultAssistant.model);
      selectedResponder.value = defaultAssistant.id;
    }
  } catch (error) {
    console.error('Failed to load participants:', error);
  }
}

async function updateParticipants(updatedParticipants: Participant[]) {
  if (!currentConversation.value) return;
  
  console.log('[updateParticipants] Received updated participants:', updatedParticipants);
  console.log('[updateParticipants] Current participants:', participants.value);
  
  try {
    // Handle updates and deletions
    for (const existing of participants.value) {
      const updated = updatedParticipants.find(p => p.id === existing.id);
      if (!updated) {
        // Participant was deleted (only if not a temp ID)
        if (!existing.id.startsWith('temp-')) {
          console.log('[updateParticipants] Deleting participant:', existing.id);
          await api.delete(`/participants/${existing.id}`);
        }
      } else if (!existing.id.startsWith('temp-')) {
        // Check if participant was actually updated by comparing relevant fields
        const hasChanges = existing.name !== updated.name ||
          existing.model !== updated.model ||
          existing.systemPrompt !== updated.systemPrompt ||
          !isEqual(existing.settings, updated.settings) ||
          !isEqual(existing.contextManagement, updated.contextManagement);
        
        console.log(`[updateParticipants] Participant ${existing.name} (${existing.id}):`);
        console.log('  existing.model:', existing.model);
        console.log('  updated.model:', updated.model);
        console.log('  hasChanges:', hasChanges);
        
        if (hasChanges) {
          // Participant was updated
          const updateData = UpdateParticipantSchema.parse({
            name: updated.name,
            model: updated.model,
            systemPrompt: updated.systemPrompt,
            settings: updated.settings,
            contextManagement: updated.contextManagement
          });
          
          console.log('[updateParticipants] ✅ Updating participant:', existing.id, updateData);
          
          try {
            await api.patch(`/participants/${existing.id}`, updateData);
          } catch (error: any) {
            console.error('Failed to update participant:', error.response?.data || error);
            throw error;
          }
        } else {
          console.log('[updateParticipants] ⏭️  No changes for participant:', existing.id);
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
    
    // Invalidate cache for this conversation
    participantCache.invalidate(currentConversation.value.id);
    
    // Also update the participantModels in the conversation list
    const conv = conversations.value.find(c => c.id === currentConversation.value.id);
    if (conv && conv.format === 'prefill') {
      // Update the embedded summary
      (conv as any).participantModels = updatedParticipants
        .filter(p => p.type === 'assistant' && p.isActive)
        .map(p => p.model)
        .filter(Boolean);
    }
    
    // Reload participants
    console.log('[updateParticipants] All updates complete, reloading participants...');
    await loadParticipants();
    console.log('[updateParticipants] ✅ Participants reloaded');
  } catch (error) {
    console.error('Failed to update participants:', error);
  }
}

function logout() {
  store.logout();
  router.push('/login');
}

// Smart LRU Cache for conversation participants with TTL
class ParticipantCache {
  private cache = new Map<string, { data: Participant[], timestamp: number }>();
  private readonly maxSize = 10; // Only keep 10 most recent
  private readonly ttl = 5 * 60 * 1000; // 5 minute TTL
  
  get(conversationId: string): Participant[] | null {
    const cached = this.cache.get(conversationId);
    if (!cached) return null;
    
    // Check TTL
    if (Date.now() - cached.timestamp > this.ttl) {
      this.cache.delete(conversationId);
      return null;
    }
    
    // Move to end (most recently used)
    this.cache.delete(conversationId);
    this.cache.set(conversationId, cached);
    
    return cached.data;
  }
  
  set(conversationId: string, participants: Participant[]) {
    // Remove if already exists (to re-add at end)
    if (this.cache.has(conversationId)) {
      this.cache.delete(conversationId);
    }
    
    // LRU eviction if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      console.log(`[ParticipantCache] Evicted ${firstKey} (LRU)`);
    }
    
    this.cache.set(conversationId, {
      data: participants,
      timestamp: Date.now()
    });
    console.log(`[ParticipantCache] Cached ${conversationId}, size: ${this.cache.size}`);
  }
  
  invalidate(conversationId: string) {
    if (this.cache.delete(conversationId)) {
      console.log(`[ParticipantCache] Invalidated ${conversationId}`);
    }
  }
  
  clear() {
    this.cache.clear();
    console.log('[ParticipantCache] Cleared all entries');
  }
}

const participantCache = new ParticipantCache();

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

// Note: loadConversationParticipants has been removed!
// The sidebar now uses embedded participant summaries from the backend
// The active conversation uses loadParticipants() with smart caching

function getConversationModelsHtml(conversation: any): string {
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
  
  // For multi-participant conversations, use embedded participant summaries!
  if (conversation.participantModels && conversation.participantModels.length > 0) {
    const modelSpans = conversation.participantModels.map((modelId: string) => {
      const model = store.state.models.find(m => m.id === modelId);
      const modelName = model ? model.displayName
        .replace('Claude ', '')
        .replace(' (Bedrock)', ' B')
        .replace(' (OpenRouter)', ' OR') : modelId;
      
      const color = getModelColor(modelId);
      return `<span style="color: ${color}; font-weight: 500;">${modelName}</span>`;
    });
    
    return modelSpans.join(' • ');
  }
  
  return '<span style="color: #757575; font-weight: 500;">Group Chat</span>';
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
  /* Removed hover effects - they were getting sticky after button press */
  /* DEBUG: If you see this in devtools, the new CSS is loaded! */
}

/* Override Vuetify's default chip hover states */
.clickable-chip:hover {
  transform: none !important;
  box-shadow: none !important;
  opacity: 1 !important;
  /* DEBUG: No hover effects should be applied */
}

.clickable-chip:active {
  transform: none !important;
  box-shadow: none !important;
}

/* Also override Vuetify's internal chip overlay states */
.clickable-chip :deep(.v-chip__overlay) {
  opacity: 0 !important;
}

.clickable-chip:hover :deep(.v-chip__overlay) {
  opacity: 0 !important;
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

/* Removed active state - hover effects removed */

.cursor-pointer {
  cursor: pointer;
}

/* Breadcrumb container */
.breadcrumb-container {
  flex: 2 1 auto;
  min-width: 200px;
  max-width: 70%;
  overflow: hidden;
}

/* Spacer after breadcrumb - reduced flex to give more space to breadcrumb */
.breadcrumb-spacer {
  flex: 0.5 1 auto !important;
}

/* Tree drawer styling - fix transform issue */
.tree-drawer {
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.tree-drawer.v-navigation-drawer--active {
  transform: translateX(0) !important;
}

.tree-drawer:not(.v-navigation-drawer--active) {
  transform: translateX(100%) !important;
}

/* Sidebar layout styles */
.sidebar-drawer .v-navigation-drawer__content {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
}

.sidebar-header {
  flex-shrink: 0;
}

.sidebar-conversations {
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 140px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.2) rgba(255, 255, 255, 0.05);
}

.sidebar-conversations::-webkit-scrollbar {
  width: 8px;
}

.sidebar-conversations::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
}

.sidebar-conversations::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}

.sidebar-conversations::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

.sidebar-footer {
  flex-shrink: 0;
  margin-top: auto;
}

.sidebar-drawer--mobile {
  width: 100% !important;
  max-width: 100% !important;
  /* Force no transform when visible on mobile - fixes Chrome layout bug */
  transform: translateX(0) !important;
}

/* Mobile controls styles */
.mobile-quick-access {
  overflow: hidden;
  padding: 0 4px;
}

.mobile-pills-scroll {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 4px 0;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.mobile-pills-scroll::-webkit-scrollbar {
  display: none;
}

.mobile-pill {
  flex-shrink: 0;
}

.mobile-main-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
}

.mobile-settings-btn {
  flex-shrink: 0;
}

.mobile-responder-select {
  flex: 1;
  min-width: 0;
}

.mobile-model-chip {
  flex: 1;
  justify-content: center;
}

.mobile-speaking-as {
  padding: 0 4px;
  text-align: center;
}

/* Conversation title styling */
.conversation-title {
  font-size: 1.0rem;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.conversation-title:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

/* Scrollable bookmarks container */
.bookmarks-scroll-container {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  padding: 2px 8px;
  margin-left: 8px;
}

.bookmarks-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none; /* Hide scrollbar for Firefox */
  -ms-overflow-style: none; /* Hide scrollbar for IE and Edge */
}

/* Hide scrollbar for Chrome, Safari and Opera */
.bookmarks-scroll::-webkit-scrollbar {
  display: none;
}

/* Bookmark items */
.bookmark-item {
  white-space: nowrap;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.9rem;
  opacity: 0.6;
  transition: all 0.2s;
}

.bookmark-item.bookmark-current {
  opacity: 1;
  font-weight: 600;
  background-color: rgba(187, 134, 252, 0.15);
}

.bookmark-item:hover {
  background-color: rgba(255, 255, 255, 0.1);
  opacity: 0.9;
}
</style>
