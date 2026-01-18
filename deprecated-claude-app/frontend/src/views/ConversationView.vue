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
          <v-list density="compact">
            <v-list-item
              :title="store.state.user?.name"
              :subtitle="store.state.user?.email"
              nav
              class="sidebar-user-item"
            >
              <template v-slot:prepend>
                <div class="mr-2">
                  <ArcLogo :size="32" />
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

          <!-- Compact action buttons -->
          <div class="sidebar-header-grid">
            <v-btn
              color="primary"
              variant="tonal"
              size="small"
              class="sidebar-action-btn"
              @click="createNewConversation"
            >
              <v-icon size="18">mdi-plus</v-icon>
              <span class="ml-1">New</span>
            </v-btn>
            <v-btn
              variant="tonal"
              size="small"
              class="sidebar-action-btn"
              @click="importDialog = true"
            >
              <v-icon size="18">mdi-import</v-icon>
              <span class="ml-1">Import</span>
            </v-btn>
          </div>

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
                <div class="d-flex align-center">
                  <div class="text-truncate flex-grow-1">{{ conversation.title }}</div>
                  <v-badge
                    v-if="getConversationUnreadCount(conversation.id) > 0"
                    :content="getConversationUnreadCount(conversation.id)"
                    color="warning"
                    text-color="white"
                    inline
                    class="ml-1 sidebar-unread-badge"
                  />
                </div>
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
                      prepend-icon="mdi-share-variant"
                      title="Share Link"
                      @click="shareConversation(conversation)"
                    />
                    <v-list-item
                      prepend-icon="mdi-account-multiple-plus"
                      title="Collaborate"
                      subtitle="Real-time with users"
                      @click="openCollaborationDialog(conversation)"
                    />
                    <v-list-item
                      prepend-icon="mdi-download"
                      title="Export"
                      @click="exportConversation(conversation.id)"
                    />
                    <v-list-item
                      prepend-icon="mdi-content-copy"
                      title="Duplicate"
                      @click="openDuplicateDialog(conversation)"
                    />
                    <v-list-item
                      prepend-icon="mdi-archive"
                      title="Archive"
                      @click="archiveConversation(conversation.id)"
                    />
                    <v-list-item
                      prepend-icon="mdi-package-variant"
                      title="Compact (reduce file size)"
                      @click="compactConversation(conversation.id)"
                    />
                    <v-list-item
                      prepend-icon="mdi-email-mark-as-unread"
                      title="Mark as read"
                      @click="markConversationAsRead(conversation)"
                    />
                  </v-list>
                </v-menu>
              </template>
            </v-list-item>
          </v-list>
          
          <!-- Shared with me section -->
          <v-list v-if="sharedConversations.length > 0" density="compact" nav class="mt-2">
            <v-list-subheader>Shared with me</v-list-subheader>
            
            <v-list-item
              v-for="share in sharedConversations"
              :key="share.id"
              :to="`/conversation/${share.conversationId}`"
              class="conversation-list-item"
              :lines="'three'"
              @click="handleConversationClick(share.conversationId)"
            >
              <template v-slot:title>
                <div class="d-flex align-center">
                  <div class="text-truncate flex-grow-1">{{ share.conversation?.title || 'Untitled' }}</div>
                  <v-badge
                    v-if="getConversationUnreadCount(share.conversationId) > 0"
                    :content="getConversationUnreadCount(share.conversationId)"
                    color="warning"
                    text-color="white"
                    inline
                    class="ml-1 sidebar-unread-badge"
                  />
                  <v-chip size="x-small" :color="getPermissionColor(share.permission)" class="ml-1">
                    {{ share.permission }}
                  </v-chip>
                </div>
              </template>
              <template v-slot:subtitle>
                <div>
                  <div class="text-caption">from {{ share.sharedBy?.name || share.sharedBy?.email }}</div>
                  <div class="text-caption text-medium-emphasis" v-if="share.conversation?.updatedAt">
                    {{ formatDate(share.conversation.updatedAt) }}
                  </div>
                </div>
              </template>
            </v-list-item>
          </v-list>
        </div>

        <!-- Fixed footer section - compact -->
        <div class="sidebar-footer">
          <v-divider />
          <div class="sidebar-footer-grid">
            <v-btn
              variant="text"
              size="small"
              class="sidebar-footer-btn"
              @click="welcomeDialog = true"
              title="Getting Started"
            >
              <v-icon size="18">mdi-help-circle</v-icon>
              <span class="ml-1 text-caption">Help</span>
            </v-btn>
            <v-btn
              variant="text"
              size="small"
              class="sidebar-footer-btn"
              @click="$router.push('/about')"
              title="About The Arc"
            >
              <v-icon size="18">mdi-information</v-icon>
              <span class="ml-1 text-caption">About</span>
            </v-btn>
            <v-btn
              variant="text"
              size="small"
              class="sidebar-footer-btn"
              @click="settingsDialog = true"
              title="Settings"
            >
              <v-icon size="18">mdi-cog</v-icon>
              <span class="ml-1 text-caption">Settings</span>
            </v-btn>
            <!-- Overflow menu for less common actions -->
            <v-menu location="top">
              <template v-slot:activator="{ props }">
                <v-btn
                  v-bind="props"
                  variant="text"
                  size="small"
                  class="sidebar-footer-btn"
                  title="More options"
                >
                  <v-icon size="18">mdi-dots-horizontal</v-icon>
                  <span class="ml-1 text-caption">More</span>
                </v-btn>
              </template>
              <v-list density="compact" class="sidebar-overflow-menu">
                <v-list-item
                  v-if="isResearcher"
                  prepend-icon="mdi-account-multiple-outline"
                  title="Personas"
                  @click="$router.push('/personas')"
                />
                <v-list-item
                  v-if="isAdmin"
                  prepend-icon="mdi-shield-crown"
                  title="Admin"
                  @click="$router.push('/admin')"
                />
                <v-divider v-if="isResearcher || isAdmin" class="my-1" />
                <v-list-item
                  prepend-icon="mdi-logout"
                  title="Logout"
                  @click="logout"
                />
              </v-list>
            </v-menu>
          </div>
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

          <!-- Bookmark navigation section - shows if there are any bookmarks in the tree -->
          <div v-if="bookmarks.length > 0" ref="bookmarkBarRef" class="d-flex align-center bookmarks-scroll-container">
            <!-- Bookmark browser dropdown (using map marker icon) -->
            <v-menu location="bottom start" :close-on-content-click="true" max-height="400" :width="bookmarkDropdownWidth">
              <template v-slot:activator="{ props }">
                <v-icon
                  v-bind="props"
                  icon="mdi-map-marker-right"
                  size="small"
                  class="bookmark-browser-btn cursor-pointer"
                  :title="`Browse all bookmarks (${bookmarks.length})`"
                />
              </template>
              <v-list density="compact" class="bookmark-browser-list">
                <v-list-subheader>All Bookmarks ({{ bookmarks.length }})</v-list-subheader>
                <v-list-item
                  v-for="bookmark in allBookmarksWithPreviews"
                  :key="bookmark.id"
                  @click="navigateToBookmark(bookmark.messageId, bookmark.branchId)"
                  :class="{ 'bookmark-in-path': isBookmarkInActivePath(bookmark) }"
                >
                  <template v-slot:prepend>
                    <v-icon size="small" :color="isBookmarkInActivePath(bookmark) ? 'primary' : bookmark.participantColor">
                      {{ bookmark.role === 'user' ? 'mdi-account' : 'mdi-robot' }}
                    </v-icon>
                  </template>
                  <v-list-item-title class="font-weight-medium d-flex align-center flex-wrap" style="gap: 4px 8px;">
                    <span>{{ bookmark.label }}</span>
                    <span class="text-caption" :style="`color: ${bookmark.participantColor}; opacity: 0.8;`">
                      {{ bookmark.participantName }}
                    </span>
                    <span v-if="bookmark.modelName" class="text-caption meta-text">
                      {{ bookmark.modelName }}
                    </span>
                  </v-list-item-title>
                  <v-list-item-subtitle class="text-caption bookmark-preview">
                    {{ bookmark.preview }}
                  </v-list-item-subtitle>
                </v-list-item>
              </v-list>
            </v-menu>

            <!-- Path indicator and scrollable bookmarks in active path -->
            <template v-if="bookmarksInActivePath.length > 0">
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
            </template>
          </div>
        </div>

        <v-spacer class="breadcrumb-spacer"/>
        
        <!-- Metrics Display -->
        <MetricsDisplay 
          v-if="currentConversation"
          :conversation-id="currentConversation.id"
          class="mr-2"
        />
        
        <!-- Multi-user presence indicator -->
        <v-chip
          v-if="roomUsers.length > 1"
          size="x-small"
          color="success"
          variant="tonal"
          class="mr-2"
        >
          <v-icon size="small" class="mr-1">mdi-account-multiple</v-icon>
          {{ roomUsers.length }}
          <v-tooltip activator="parent" location="bottom">
            {{ roomUsers.length }} users viewing this conversation
          </v-tooltip>
        </v-chip>
        
        <v-btn
          v-if="allMessages.length > 0"
          :icon="treeDrawer ? 'mdi-graph' : 'mdi-graph-outline'"
          :color="treeDrawer ? 'primary' : undefined"
          variant="text"
          @click="treeDrawer = !treeDrawer"
          title="Toggle conversation tree"
        />

        <!-- History button with unread badge -->
        <v-badge
          v-if="currentConversation"
          :content="unreadBranchCount"
          :model-value="unreadBranchCount > 0"
          color="warning"
          text-color="white"
          offset-x="12"
          offset-y="10"
          class="unread-history-badge"
        >
          <v-btn
            :icon="showEventHistory ? 'mdi-history' : 'mdi-history'"
            :color="showEventHistory ? 'primary' : undefined"
            variant="text"
            @click.stop="showEventHistory = !showEventHistory"
            title="Event history"
          />
        </v-badge>
      </v-app-bar>

      <!-- Messages Area with Event History Panel -->
      <div class="d-flex flex-grow-1 overflow-hidden">
        <v-container
          ref="messagesContainer"
          class="flex-grow-1 overflow-y-auto messages-container"
          style="max-height: calc(100vh - 160px);"
        >
          <div v-if="!currentConversation && !isLoadingConversation" class="text-center mt-12">
            <v-icon size="64" color="grey">mdi-message-text-outline</v-icon>
            <h2 class="text-h5 mt-4 text-grey">Select or create a conversation to start</h2>
          </div>
          
          <!-- Loading spinner while conversation is being fetched -->
          <div v-else-if="isLoadingConversation" class="text-center mt-12">
            <v-progress-circular
              indeterminate
              color="primary"
              size="64"
            />
            <h2 class="text-h6 mt-4 text-grey-lighten-1">Loading conversation...</h2>
          </div>
          
          <div v-else>
            <CompositeMessageGroup
              v-for="(group, groupIndex) in groupedMessages"
              :key="group.id"
              :messages="group.messages"
              :participants="participants"
              :is-last-group="groupIndex === groupedMessages.length - 1"
              :selected-branch-for-parent="selectedBranchForParent"
              :streaming-message-id="streamingMessageId"
              :streaming-branch-id="streamingBranchId"
              :is-streaming="isStreaming"
              :streaming-error="streamingError"
              :post-hoc-affected-messages="postHocAffectedMessages"
              :show-stuck-button="showStuckButton"
              :authenticity-map="authenticityMap"
              @regenerate="regenerateMessage"
              @stuck-clicked="stuckDialog = true"
              @edit="editMessage"
              @edit-only="editMessageOnly"
              @switch-branch="switchBranch"
              @delete="deleteMessage"
              @delete-all-branches="deleteAllBranches"
              @select-as-parent="selectBranchAsParent"
              @stop-auto-scroll="stopAutoScroll"
              @bookmark-changed="handleBookmarkChanged"
              @post-hoc-hide="handlePostHocHide"
              @post-hoc-edit="handlePostHocEdit"
              @post-hoc-edit-content="handlePostHocEditContent"
              @post-hoc-hide-before="handlePostHocHideBefore"
              @post-hoc-unhide="handlePostHocUnhide"
              @delete-post-hoc-operation="handleDeletePostHocOperation"
              @split="handleSplit"
              @fork="handleFork"
            />
          </div>
        </v-container>
        
        <!-- Event History Panel -->
        <EventHistoryPanel
          v-if="showEventHistory && currentConversation"
          :conversation-id="currentConversation.id"
          :is-mobile="isMobile"
          @close="showEventHistory = false"
          @navigate-to-message="handleEventNavigate"
        />
      </div>

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
          <!-- Model Pill Bar - for ALL conversations now -->
          <ModelPillBar
            :participants="participantsByLastSpoken"
            :suggested-models="suggestedModelsForPillBar"
            :selected-responder-id="selectedResponder"
            :disabled="isStreaming"
            :single-model="currentModel"
            :is-standard-conversation="currentConversation.format === 'standard'"
            :no-response-mode="noResponseMode"
            class="mb-2"
            @select-responder="(p) => selectedResponder = p.id"
            @deselect-responder="selectedResponder = ''"
            @toggle-no-response="noResponseMode = !noResponseMode"
            @quick-send="triggerParticipantResponse"
            @add-model="handleAddModel"
            @add-suggested-model="triggerModelResponse"
            @quick-send-model="triggerModelResponse"
            @open-settings="conversationSettingsDialog = true"
          />
        </template>
        
        <!-- DESKTOP CONTROLS -->
        <template v-else>
          <!-- Model Pill Bar - for ALL conversations now -->
          <ModelPillBar
            :participants="participantsByLastSpoken"
            :suggested-models="suggestedModelsForPillBar"
            :selected-responder-id="selectedResponder"
            :disabled="isStreaming"
            :single-model="currentModel"
            :is-standard-conversation="currentConversation.format === 'standard'"
            :no-response-mode="noResponseMode"
            @select-responder="(p) => selectedResponder = p.id"
            @deselect-responder="selectedResponder = ''"
            @toggle-no-response="noResponseMode = !noResponseMode"
            @quick-send="triggerParticipantResponse"
            @add-model="handleAddModel"
            @add-suggested-model="triggerModelResponse"
            @quick-send-model="triggerModelResponse"
            @open-settings="conversationSettingsDialog = true"
          />
        </template>
        
        <!-- Attachments display -->
        <div v-if="attachments.length > 0" class="mb-2">
          <v-chip
            v-for="(attachment, index) in attachments"
            :key="index"
            closable
            @click:close="removeAttachment(index)"
            class="mr-2 mb-2"
            :color="getAttachmentChipColor(attachment)"
            :style="attachment.isImage ? 'height: auto; padding: 4px;' : ''"
          >
            <template v-if="attachment.isImage">
              <img 
                :src="`data:${attachment.mimeType || 'image/' + attachment.fileType};base64,${attachment.content}`" 
                :alt="attachment.fileName"
                style="max-height: 60px; max-width: 100px; margin-right: 8px; border-radius: 4px;"
              />
              <span>{{ attachment.fileName }}</span>
            </template>
            <template v-else-if="attachment.isPdf">
              <v-icon start color="red-darken-1">mdi-file-pdf-box</v-icon>
              {{ attachment.fileName }}
            </template>
            <template v-else-if="attachment.isAudio">
              <v-icon start color="purple">mdi-music-box</v-icon>
              {{ attachment.fileName }}
            </template>
            <template v-else-if="attachment.isVideo">
              <v-icon start color="blue">mdi-video-box</v-icon>
              {{ attachment.fileName }}
            </template>
            <template v-else>
              <v-icon start>mdi-file-document-outline</v-icon>
              {{ attachment.fileName }}
            </template>
            <span class="ml-1 text-caption">({{ formatFileSize(attachment.fileSize) }})</span>
          </v-chip>
        </div>
        
        <!-- AI generating notification (when another user triggered it) -->
        <v-alert
          v-if="activeAiRequest && activeAiRequest.userId !== store.state.user?.id"
          type="info"
          density="compact"
          class="mb-2"
          variant="tonal"
        >
          <v-icon class="mr-2">mdi-robot</v-icon>
          AI is responding to another user's message. You can still send messages.
        </v-alert>
        
        <!-- Request queued notification -->
        <v-alert
          v-if="isAiRequestQueued"
          type="warning"
          density="compact"
          class="mb-2"
          variant="tonal"
        >
          <v-icon class="mr-2">mdi-clock-outline</v-icon>
          Your message was sent, but AI response is pending (another request in progress).
        </v-alert>
        
        <!-- Drop zone wrapper for drag-and-drop attachments -->
        <div 
          class="input-drop-zone"
          :class="{ 'drop-zone-active': isDraggingOver }"
          @dragenter.prevent="handleDragEnter"
          @dragover.prevent="handleDragOver"
          @dragleave.prevent="handleDragLeave"
          @drop.prevent="handleDrop"
        >
          <div v-if="isDraggingOver" class="drop-zone-overlay">
            <v-icon size="48" color="primary">mdi-file-upload</v-icon>
            <span class="text-body-1 mt-2">Drop files here</span>
          </div>
          
          <!-- Connection status indicator -->
          <div v-if="wsConnectionState !== 'connected'" class="connection-status-bar mb-2">
            <v-icon 
              size="small" 
              :color="wsConnectionState === 'reconnecting' ? 'warning' : 'error'"
              class="mr-2"
            >
              {{ wsConnectionState === 'reconnecting' ? 'mdi-wifi-refresh' : 'mdi-wifi-off' }}
            </v-icon>
            <span class="text-caption">
              {{ wsConnectionState === 'connecting' ? 'Connecting...' : 
                 wsConnectionState === 'reconnecting' ? 'Reconnecting...' :
                 wsConnectionState === 'failed' ? 'Connection failed. Please refresh the page.' :
                 'Disconnected' }}
            </span>
          </div>
          
          <v-textarea
            ref="messageTextarea"
            v-model="messageInput"
            :label="typingIndicatorLabel"
            placeholder="Type your message..."
            rows="1"
            auto-grow
            max-rows="15"
            variant="outlined"
            hide-details
            @keydown.enter.exact.prevent="sendMessage"
            @focus="handleTextareaFocus"
            @paste="handlePaste"
            @input="handleTypingInput"
          />
          
          <!-- Bottom control row -->
          <div class="bottom-controls d-flex align-center mt-2">
            <!-- Left side controls -->
            <div class="d-flex align-center input-bar-left">
              <v-btn
                icon="mdi-paperclip"
                size="small"
                variant="text"
                color="grey"
                @click.stop="triggerFileInput($event)"
                title="Attach file"
              />
              
              <!-- Hidden from AI toggle (for multiuser) -->
              <v-btn
                v-if="isMultiuserConversation"
                icon="mdi-eye-off"
                :color="hiddenFromAi ? 'warning' : 'grey'"
                size="small"
                :variant="hiddenFromAi ? 'tonal' : 'text'"
                @click.stop="hiddenFromAi = !hiddenFromAi"
                title="Hide this message from AI"
              />
              
              <!-- Speaking as dropdown (for multi-participant) -->
              <v-menu v-if="currentConversation?.format !== 'standard'" location="top">
                <template v-slot:activator="{ props }">
                  <v-btn
                    v-bind="props"
                    size="small"
                    variant="text"
                    color="grey"
                    class="text-none"
                  >
                    <v-icon size="small" class="mr-1">mdi-account</v-icon>
                    <span class="text-caption">Speaking as: {{ selectedParticipantName }}</span>
                    <v-icon size="x-small" class="ml-1">mdi-chevron-down</v-icon>
                  </v-btn>
                </template>
                <v-list density="compact">
                  <v-list-item
                    v-for="participant in allParticipants"
                    :key="participant.id"
                    @click="selectedParticipant = participant.id"
                    :active="selectedParticipant === participant.id"
                  >
                    <template v-slot:prepend>
                      <v-icon 
                        :icon="participant.type === 'user' ? 'mdi-account' : 'mdi-robot'"
                        :color="participant.type === 'user' ? '#bb86fc' : getModelColor(participant.model || '')"
                        size="small"
                      />
                    </template>
                    <v-list-item-title :style="`color: ${participant.type === 'user' ? '#bb86fc' : getModelColor(participant.model || '')}`">
                      {{ participant.name }}
                    </v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
            </div>
            
            <v-spacer />
            
            <!-- Right side controls - consistent icon buttons -->
            <div class="d-flex align-center input-bar-right">
              <!-- Thinking toggle -->
              <v-btn
                v-if="modelSupportsThinking"
                icon="mdi-head-lightbulb"
                :color="thinkingEnabled ? 'info' : 'grey'"
                size="small"
                :variant="thinkingEnabled ? 'tonal' : 'text'"
                @click.stop="toggleThinking"
                :title="thinkingEnabled ? 'Disable extended thinking' : 'Enable extended thinking'"
              />
              
              <!-- Detached branch mode toggle (for multi-user independent browsing) -->
              <v-btn
                v-if="isCollaborativeConversation"
                :icon="isDetachedFromMainBranch ? 'mdi-link-off' : 'mdi-link'"
                :color="isDetachedFromMainBranch ? 'warning' : 'grey'"
                size="small"
                :variant="isDetachedFromMainBranch ? 'tonal' : 'text'"
                @click.stop="toggleDetachedMode"
                :title="isDetachedFromMainBranch ? 'Detached: Branch navigation is local-only. Click to follow main branch.' : 'Following main branch. Click to browse independently.'"
              />
              
              <!-- Sampling branches -->
              <v-menu location="top">
                <template v-slot:activator="{ props }">
                  <v-btn
                    v-bind="props"
                    size="small"
                    :variant="samplingBranches > 1 ? 'tonal' : 'text'"
                    :color="samplingBranches > 1 ? 'secondary' : 'grey'"
                    :title="`Generate ${samplingBranches} response${samplingBranches > 1 ? 's' : ''}`"
                    class="sampling-btn"
                  >
                    <v-icon size="small">mdi-source-branch</v-icon>
                    <span v-if="samplingBranches > 1" class="sampling-count">{{ samplingBranches }}</span>
                  </v-btn>
                </template>
                <v-list density="compact" class="pa-0">
                  <v-list-subheader class="text-caption">Response samples</v-list-subheader>
                  <v-list-item
                    v-for="n in 8"
                    :key="n"
                    :active="samplingBranches === n"
                    @click="samplingBranches = n"
                  >
                    <v-list-item-title>{{ n }}{{ n > 1 ? ' branches' : '' }}</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
              
              <!-- Settings -->
              <v-btn
                icon="mdi-cog-outline"
                size="small"
                variant="text"
                color="grey"
                @click.stop="conversationSettingsDialog = true"
                title="Conversation settings"
              />
              
              <!-- Send/Stop button -->
              <v-btn
                v-if="!isStreaming"
                :disabled="!messageInput || !isWsConnected"
                :color="isWsConnected ? 'primary' : 'grey'"
                icon="mdi-send"
                variant="flat"
                size="small"
                style="touch-action: manipulation;"
                class="ml-1"
                :title="isWsConnected ? 'Send message' : 'Waiting for connection...'"
                @click="sendMessage"
              />
              <v-btn
                v-else
                color="error"
                icon="mdi-stop"
                variant="flat"
                size="small"
                title="Stop generation"
                class="ml-1"
                @click="abortGeneration"
              />
            </div>
          </div>
        </div>
        
        <!-- Hidden file input - supports text, images, PDFs, audio, and video -->
        <input
          ref="fileInput"
          type="file"
          accept=".txt,.md,.csv,.json,.xml,.html,.css,.js,.ts,.py,.java,.cpp,.c,.h,.hpp,.jpg,.jpeg,.png,.gif,.webp,.svg,.pdf,application/pdf,.mp3,.wav,.flac,.ogg,.m4a,.aac,.mp4,.mov,.avi,.mkv,.webm"
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
        :read-branch-ids="store.state.readBranchIds"
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
      @open-manage-shares="manageSharesDialog = true"
    />
    
    <ConversationSettingsDialog
      v-model="conversationSettingsDialog"
      :conversation="currentConversation"
      :models="store.state.models"
      :message-count="messages.length"
      :personas="personas"
      :can-use-personas="isResearcher"
      @update="updateConversationSettings"
      @update-participants="updateParticipants"
    />
    
    <ShareDialog
      v-model="shareDialog"
      :conversation="currentConversation"
      :current-branch-id="currentBranchId"
    />
    
    <CollaborationShareDialog
      v-model="collaborationDialog"
      :conversation="currentConversation"
    />
    
    <ManageSharesDialog
      v-model="manageSharesDialog"
    />
    
    <DuplicateConversationDialog
      v-model="duplicateDialog"
      :conversation="duplicateConversationTarget"
      :message-count="duplicateConversationTarget ? getConversationMessageCount(duplicateConversationTarget.id) : 0"
      @duplicated="handleDuplicated"
    />
    
    <WelcomeDialog
      v-model="welcomeDialog"
      @open-settings="settingsDialog = true"
      @open-import="importDialog = true"
      @new-conversation="createNewConversation"
    />
    
    <AddParticipantDialog
      v-model="addParticipantDialog"
      :models="store.state.models"
      :availability="store.state.modelAvailability"
      :personas="personas"
      :conversation-id="currentConversation?.id || ''"
      :is-standard-conversation="currentConversation?.format === 'standard'"
      :can-use-personas="isResearcher"
      :default-model-id="addParticipantDefaultModelId"
      @add="handleAddParticipant"
    />
    
    <!-- Content Blocked Dialog -->
    <v-dialog v-model="contentBlockedDialog" max-width="600" persistent>
      <v-card class="pa-4">
        <v-card-title class="d-flex align-center text-h5">
          <v-icon color="warning" class="mr-2">mdi-shield-alert</v-icon>
          Content Moderation
        </v-card-title>
        
        <v-card-text class="text-body-1">
          <p class="mb-4">
            Your message was flagged by our content moderation system. To protect Arc from potential 
            legal liability and public relations risks, we filter certain categories of content on our hosted platform.
          </p>
          
          <v-divider class="my-4" />
          
          <p class="mb-3"><strong>Options for unrestricted access:</strong></p>
          
          <v-list density="compact" class="bg-transparent">
            <v-list-item lines="three">
              <template v-slot:prepend>
                <v-icon color="primary">mdi-account-check</v-icon>
              </template>
              <v-list-item-title>Request Researcher Access</v-list-item-title>
              <v-list-item-subtitle class="text-wrap">
                Join our Discord and request researcher access for legitimate research purposes. If you are in our Discord aleady, you most likely qualify.
              </v-list-item-subtitle>
            </v-list-item>
            
            <v-list-item lines="three">
              <template v-slot:prepend>
                <v-icon color="primary">mdi-github</v-icon>
              </template>
              <v-list-item-title>Self-Host Arc</v-list-item-title>
              <v-list-item-subtitle class="text-wrap">
                Download and run Arc locally for unrestricted use and privacy of data. The project is available on our GitHub. 
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
          
          <v-divider class="my-4" />
          
          <p class="text-caption text-grey">
            <v-icon size="small" class="mr-1">mdi-information-outline</v-icon>
            Our filters are tuned to be permissive and should only trigger on severe content. 
            If you believe this was flagged incorrectly, please let us know on Discord.
          </p>
        </v-card-text>
        
        <v-card-actions class="d-flex justify-end ga-2 px-4 pb-4">
          <v-btn
            variant="outlined"
            href="https://discord.gg/anima"
            target="_blank"
          >
            <v-icon start>mdi-discord</v-icon>
            Discord
          </v-btn>
          <v-btn
            variant="outlined"
            href="https://github.com/anima-research/animachat"
            target="_blank"
          >
            <v-icon start>mdi-github</v-icon>
            GitHub
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            @click="contentBlockedDialog = false"
          >
            OK
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Stuck Generation Dialog -->
    <v-dialog v-model="stuckDialog" max-width="550" persistent>
      <v-card class="pa-4">
        <v-card-title class="d-flex align-center text-h5">
          <v-icon color="warning" class="mr-2">mdi-alert-circle</v-icon>
          Generation Appears Stuck
        </v-card-title>
        
        <v-card-text class="text-body-1">
          <p class="mb-4">
            The AI generation has been running for over a minute without producing any output. 
            This is an intermittent issue we're investigating. Most likely it is related to real-time sync malfunctioning.
          </p>
          
          <v-alert type="info" variant="tonal" density="compact" class="mb-4">
            <strong>Help us fix this!</strong> Submitting diagnostics will help us identify the cause. 
            This includes console logs from your browser session (no personal data).
          </v-alert>
          
          <p class="text-body-2 text-grey">
            After submitting, the page will reload to restore normal operation.
          </p>
        </v-card-text>
        
        <v-card-actions class="justify-end">
          <v-btn
            variant="text"
            @click="dismissStuckDialog"
          >
            Just Reload
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="stuckAnalyticsSubmitting"
            @click="submitStuckAnalytics"
          >
            <v-icon start>mdi-send</v-icon>
            Submit Diagnostics & Reload
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    
    <!-- Fork Conversation Dialog -->
    <v-dialog v-model="showForkDialog" max-width="560">
      <v-card>
        <v-card-title class="text-h6">
          <v-icon start color="primary">mdi-source-fork</v-icon>
          Fork to New Conversation
        </v-card-title>
        <v-card-text>
          <p class="mb-4">
            Create a new conversation starting from this message, including all branches below it.
          </p>
          
          <div class="text-subtitle-2 mb-2">History handling:</div>
          <v-radio-group v-model="forkMode" density="compact" hide-details class="mb-2">
            <v-radio value="full" class="mb-1">
              <template v-slot:label>
                <div>
                  <span class="font-weight-medium">Full</span>
                  <span class="text-caption text-medium-emphasis ml-2">Copy all prior messages</span>
                </div>
              </template>
            </v-radio>
            <v-radio value="compressed" class="mb-1">
              <template v-slot:label>
                <div>
                  <span class="font-weight-medium">Compressed</span>
                  <span class="text-caption text-medium-emphasis ml-2">Embed history as invisible context</span>
                </div>
              </template>
            </v-radio>
            <v-radio value="truncated" class="mb-1">
              <template v-slot:label>
                <div>
                  <span class="font-weight-medium">Truncated</span>
                  <span class="text-caption text-medium-emphasis ml-2">Messages earlier than the fork point are discarded</span>
                </div>
              </template>
            </v-radio>
          </v-radio-group>
          
          <v-alert 
            v-if="forkMode === 'full'" 
            type="info" 
            density="compact" 
            variant="tonal"
            class="text-caption"
          >
            All messages on the active path before this point will be copied as separate, editable messages.
            The full subtree (including branches) is preserved.
          </v-alert>
          <v-alert 
            v-if="forkMode === 'compressed'" 
            type="info" 
            density="compact" 
            variant="tonal"
            class="text-caption"
          >
            Prior messages are embedded as a part of the first message.
            You'll only see messages from this point onwards. Use this when you want to reduce message count.
          </v-alert>
          <v-alert 
            v-if="forkMode === 'truncated'" 
            type="warning" 
            density="compact" 
            variant="tonal"
            class="text-caption"
          >
            The AI will have no memory of the context before the fork point. Use when you want a remove earlier conversation history.
          </v-alert>
          
          <v-divider class="my-3" />
          
          <v-checkbox
            v-model="forkIncludePrivateBranches"
            density="compact"
            hide-details
            class="mt-0"
          >
            <template v-slot:label>
              <span class="text-body-2">Include my private branches</span>
            </template>
          </v-checkbox>
          <div class="text-caption text-medium-emphasis ml-8 mt-n1">
            Private branches are normally excluded from forks.
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showForkDialog = false" :disabled="forkIsLoading">
            Cancel
          </v-btn>
          <v-btn color="primary" variant="elevated" @click="executeFork" :loading="forkIsLoading">
            <v-icon start>mdi-source-fork</v-icon>
            Fork
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    
    <!-- Stuck button is now shown inline next to the generating indicator in MessageComponent -->

    <!-- Error snackbar for non-streaming errors (pricing validation, etc.) -->
    <v-snackbar
      v-model="errorSnackbar"
      :timeout="8000"
      color="error"
      location="top"
      multi-line
    >
      <div class="d-flex flex-column">
        <strong>{{ errorSnackbarMessage }}</strong>
        <span v-if="errorSnackbarDetails" class="text-caption mt-1">{{ errorSnackbarDetails }}</span>
      </div>
      <template v-slot:actions>
        <v-btn variant="text" @click="errorSnackbar = false">Close</v-btn>
      </template>
    </v-snackbar>
  </v-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { isEqual } from 'lodash-es';
import { useStore } from '@/store';
import { api } from '@/services/api';
import type { Conversation, Message, Participant, Model, Bookmark, Persona } from '@deprecated-claude/shared';
import { UpdateParticipantSchema, getValidatedModelDefaults } from '@deprecated-claude/shared';
import CompositeMessageGroup from '@/components/CompositeMessageGroup.vue';
import ImportDialogV2 from '@/components/ImportDialogV2.vue';
import SettingsDialog from '@/components/SettingsDialog.vue';
import ConversationSettingsDialog from '@/components/ConversationSettingsDialog.vue';
import ShareDialog from '@/components/ShareDialog.vue';
import CollaborationShareDialog from '@/components/CollaborationShareDialog.vue';
import EventHistoryPanel from '@/components/EventHistoryPanel.vue';
import ManageSharesDialog from '@/components/ManageSharesDialog.vue';
import DuplicateConversationDialog from '@/components/DuplicateConversationDialog.vue';
import ArcLogo from '@/components/ArcLogo.vue';
import WelcomeDialog from '@/components/WelcomeDialog.vue';
import ConversationTree from '@/components/ConversationTree.vue';
import MetricsDisplay from '@/components/MetricsDisplay.vue';
import ModelPillBar from '@/components/ModelPillBar.vue';
import AddParticipantDialog from '@/components/AddParticipantDialog.vue';
import { getModelColor } from '@/utils/modelColors';
import { computeAuthenticity, type AuthenticityStatus } from '@/utils/authenticity';

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
const collaborationDialog = ref(false);
const manageSharesDialog = ref(false);
const duplicateDialog = ref(false);
const duplicateConversationTarget = ref<Conversation | null>(null);
const showRawImportDialog = ref(false);
const welcomeDialog = ref(false);
const addParticipantDialog = ref(false);
const contentBlockedDialog = ref(false);
const rawImportData = ref('');
const messageInput = ref('');
const personas = ref<Persona[]>([]);
const isStreaming = ref(false);
const streamingMessageId = ref<string | null>(null);
const streamingBranchId = ref<string | null>(null);  // Track which branch is streaming
const autoScrollEnabled = ref(true);
const userScrolledRecently = ref(false);  // Prevents auto-scroll from fighting with user
const isProgrammaticScroll = ref(false);  // Tracks when scroll is from code, not user
const isSwitchingBranch = ref(false);
const streamingError = ref<{ messageId: string; error: string; suggestion?: string } | null>(null);
const isLoadingConversation = ref(false);

// Track last completed branch to prevent re-triggering streaming on DEBUG CAPTURE updates
const lastCompletedBranchId = ref<string | null>(null);
const lastCompletedTime = ref<number | null>(null);

// Stuck generation detection
const streamingStartTime = ref<number | null>(null);
const firstTokenReceived = ref(false);
const lastContentReceivedTime = ref<number | null>(null); // Track when we last received any content
const showStuckButton = ref(false);
const stuckDialog = ref(false);
const stuckAnalyticsSubmitting = ref(false);
let stuckCheckTimer: ReturnType<typeof setTimeout> | null = null;
let contentStuckCheckTimer: ReturnType<typeof setTimeout> | null = null; // Secondary timer for "content but no completion"

// Timeout for "content received but never completed" - used for image generation issues
const CONTENT_STUCK_TIMEOUT_MS = 45000; // 45 seconds after last content with no completion

// Get stuck threshold based on current model - Anthropic is faster to detect issues
const getStuckThresholdMs = () => {
  const model = currentConversation.value?.model || '';
  const isAnthropic = model.includes('anthropic') || model.includes('claude');
  return isAnthropic ? 15000 : 60000; // 15s for Anthropic, 60s for others
};

// Console log collection for debugging
// IMPORTANT: Use a plain array, NOT a ref, to avoid reactivity loops
// (console.log -> push to ref -> reactivity -> re-render -> console.log -> ...)
let consoleLogs: string[] = [];
const MAX_CONSOLE_LOGS = 200;

// General error snackbar (for non-streaming errors like pricing validation)
const errorSnackbar = ref(false);
const errorSnackbarMessage = ref('');
const errorSnackbarDetails = ref('');

// Multi-user room state
const roomUsers = ref<Array<{ userId: string; joinedAt: Date }>>([]);
const typingUsers = ref<Map<string, string>>(new Map()); // Map of userId -> email/name
const activeAiRequest = ref<{ userId: string; messageId: string } | null>(null);
const isAiRequestQueued = ref(false); // True if our request was queued because AI is already generating
const hiddenFromAi = ref(false); // Toggle for sending messages hidden from AI
const samplingBranches = ref(1); // Number of response branches to generate
const showEventHistory = ref(false); // Toggle for event history panel

// Computed: Check if this is a multiuser conversation (shared or has multiple users)
const isMultiuserConversation = computed(() => {
  // Show multiuser controls if:
  // 1. Multiple users currently in room
  // 2. Conversation was shared with me
  // 3. I've shared this conversation publicly
  // 4. This conversation has collaborators
  const conversationId = currentConversation.value?.id;
  if (!conversationId) return false;
  
  return roomUsers.value.length > 1 || 
    sharedConversations.value.some(s => s.conversationId === conversationId) ||
    myCreatedShares.value.some(s => s.conversationId === conversationId) ||
    currentConversationCollaborators.value.length > 0;
});

// Computed label for the input field - shows who is typing
const typingIndicatorLabel = computed(() => {
  if (typingUsers.value.size === 0) {
    return 'Type your message...';
  }
  const names = Array.from(typingUsers.value.values());
  if (names.length === 1) {
    return `${names[0]} is typing...`;
  } else if (names.length === 2) {
    return `${names[0]} and ${names[1]} are typing...`;
  } else {
    return `${names[0]} and ${names.length - 1} others are typing...`;
  }
});

const attachments = ref<Array<{
  fileName: string;
  fileType: string;
  mimeType?: string;
  fileSize: number;
  content: string;
  encoding?: 'base64' | 'text';
  isImage?: boolean;
  isPdf?: boolean;
  isAudio?: boolean;
  isVideo?: boolean;
}>>([]);
const fileInput = ref<HTMLInputElement>();
const messageTextarea = ref<any>();
const isDraggingOver = ref(false);
let dragCounter = 0; // Track nested drag events
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
const noResponseMode = ref(false);  // For standard conversations: disable AI response
const isLoadingUIState = ref(false); // Prevents saving during load
const showMobileSpeakingAs = ref(false);

// Fork dialog state
const showForkDialog = ref(false);
const forkTargetMessageId = ref('');
const forkTargetBranchId = ref('');
const forkMode = ref<'full' | 'compressed' | 'truncated'>('full');
const forkIncludePrivateBranches = ref(false);
const forkIsLoading = ref(false);
const conversationTreeRef = ref<InstanceType<typeof ConversationTree>>();
const bookmarks = ref<Bookmark[]>([]);
const bookmarksScrollRef = ref<HTMLElement>();
const bookmarkBarRef = ref<HTMLElement>();
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

// Shared conversations (from other users)
interface SharedConversationEntry {
  id: string;
  conversationId: string;
  permission: 'viewer' | 'collaborator' | 'editor';
  sharedBy: { id: string; email: string; name: string } | null;
  conversation: { id: string; title: string; model: string; format: string; updatedAt: string } | null;
  createdAt: string;
}
const sharedConversations = ref<SharedConversationEntry[]>([]);

// Shares created by the current user (for owner to know their conversation is shared)
interface MyCreatedShare {
  conversationId: string;
  // Add other fields as needed
}
const myCreatedShares = ref<MyCreatedShare[]>([]);

// Collaboration shares for the current conversation (user-to-user sharing)
interface CollaborationShare {
  id: string;
  recipientId: string;
  permission: string;
}
const currentConversationCollaborators = ref<CollaborationShare[]>([]);

async function loadSharedConversations() {
  try {
    const response = await api.get('/collaboration/shared-with-me');
    sharedConversations.value = response.data.shares || [];
  } catch (error) {
    console.error('Failed to load shared conversations:', error);
  }
}

async function loadMyCreatedShares() {
  try {
    const response = await api.get('/shares/my-shares');
    myCreatedShares.value = response.data || [];
  } catch (error) {
    console.error('Failed to load my created shares:', error);
  }
}

async function loadCurrentConversationCollaborators() {
  const conversationId = currentConversation.value?.id;
  if (!conversationId) {
    currentConversationCollaborators.value = [];
    return;
  }
  
  try {
    const response = await api.get(`/collaboration/conversation/${conversationId}/shares`);
    currentConversationCollaborators.value = response.data.shares || [];
  } catch (error) {
    // User might not have access or conversation doesn't exist
    currentConversationCollaborators.value = [];
  }
}

async function loadPersonas() {
  try {
    const response = await api.get('/personas');
    // API returns {owned: [], shared: []}, combine them
    personas.value = [...response.data.owned, ...response.data.shared];
  } catch (error) {
    console.error('Failed to load personas:', error);
  }
}

function getPermissionColor(permission: string): string {
  switch (permission) {
    case 'viewer': return 'grey';
    case 'collaborator': return 'blue';
    case 'editor': return 'green';
    default: return 'grey';
  }
}

const currentConversation = computed(() => store.state.currentConversation);
const messages = computed(() => store.messages);
const allMessages = computed(() => store.state.allMessages); // Get ALL messages for tree view

// STUBBED: Unread count disabled pending architecture review
const unreadBranchCount = computed(() => 0);

// Legacy unread count (kept for backwards compatibility)
const unreadCount = computed(() => store.getUnreadCount());

// Compute authenticity for visible messages
const authenticityMap = computed((): Map<string, AuthenticityStatus> => {
  return computeAuthenticity(messages.value, participants.value);
});

// Group consecutive messages from the same participant for visual combining
interface MessageGroup {
  id: string;
  messages: any[]; // Message[]
  participantName: string;
}

const groupedMessages = computed((): MessageGroup[] => {
  const msgs = messages.value;
  if (!msgs || msgs.length === 0) return [];
  
  const groups: MessageGroup[] = [];
  let currentGroup: MessageGroup | null = null;
  
  for (const message of msgs) {
    const branch = message.branches?.find((b: any) => b.id === message.activeBranchId);
    if (!branch) continue;
    
    // Get participant name
    let participantName = branch.role === 'user' ? 'User' : 'Assistant';
    if (branch.participantId) {
      const participant = participants.value.find(p => p.id === branch.participantId);
      if (participant) {
        participantName = participant.name;
      }
    }
    
    // Check if this continues the current group
    if (currentGroup && currentGroup.participantName === participantName && participantName !== '') {
      currentGroup.messages.push(message);
    } else {
      // Start a new group
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentGroup = {
        id: `group-${message.id}`,
        messages: [message],
        participantName
      };
    }
  }
  
  // Don't forget the last group
  if (currentGroup) {
    groups.push(currentGroup);
  }
  
  return groups;
});
const wsConnectionState = computed(() => store.state.wsConnectionState);
const isWsConnected = computed(() => store.state.wsConnectionState === 'connected');

// Compute which messages are affected by post-hoc operations
// IMPORTANT: Only consider operations that are on the CURRENT visible branch path
const postHocAffectedMessages = computed(() => {
  const affected = new Map<string, { hidden: boolean; edited: boolean; editedContent?: string; originalContent?: string; hiddenAttachments: number[] }>();
  
  // Only look at VISIBLE messages - operations on other branches shouldn't affect us
  const visibleMsgs = messages.value;
  
  // Build a set of visible message IDs for quick lookup
  const visibleMessageIds = new Set(visibleMsgs.map(m => m.id));
  
  // Collect post-hoc operations ONLY from visible messages
  const operations: Array<{ order: number; op: any }> = [];
  for (const msg of visibleMsgs) {
    const activeBranch = msg.branches.find((b: any) => b.id === msg.activeBranchId);
    if (activeBranch?.postHocOperation) {
      operations.push({ order: msg.order, op: activeBranch.postHocOperation });
    }
  }
  
  // Debug logging only when there are operations (computed runs frequently)
  if (operations.length > 0) {
    console.log('[PostHoc] Found operations:', operations.length);
  }
  
  if (operations.length === 0) return affected;
  
  // Build order lookup from visible messages
  const messageOrderById = new Map<string, number>();
  for (const msg of visibleMsgs) {
    messageOrderById.set(msg.id, msg.order);
  }
  
  // Process operations in order
  for (const { op } of operations) {
    // Only apply to targets that are also visible
    if (!visibleMessageIds.has(op.targetMessageId)) continue;
    
    switch (op.type) {
      case 'hide':
        affected.set(op.targetMessageId, { 
          ...affected.get(op.targetMessageId) || { hidden: false, edited: false, hiddenAttachments: [] },
          hidden: true 
        });
        break;
        
      case 'hide_before': {
        const targetOrder = messageOrderById.get(op.targetMessageId);
        if (targetOrder !== undefined) {
          for (const msg of visibleMsgs) {
            if (msg.order < targetOrder) {
              affected.set(msg.id, { 
                ...affected.get(msg.id) || { hidden: false, edited: false, hiddenAttachments: [] },
                hidden: true 
              });
            }
          }
        }
        break;
      }
        
      case 'edit': {
        // Extract text content from replacement content blocks
        let editedText = '';
        if (op.replacementContent) {
          for (const block of op.replacementContent) {
            if (block.type === 'text') {
              editedText += block.text;
            }
          }
        }
        // Get original content from the target message
        const targetMsg = visibleMsgs.find(m => m.id === op.targetMessageId);
        const targetBranch = targetMsg?.branches.find((b: any) => b.id === op.targetBranchId);
        const originalText = targetBranch?.content || '';
        
        affected.set(op.targetMessageId, { 
          ...affected.get(op.targetMessageId) || { hidden: false, edited: false, hiddenAttachments: [] },
          edited: true,
          editedContent: editedText || undefined,
          originalContent: originalText
        });
        break;
      }
        
      case 'hide_attachment':
        if (op.attachmentIndices) {
          const current = affected.get(op.targetMessageId) || { hidden: false, edited: false, hiddenAttachments: [] };
          affected.set(op.targetMessageId, { 
            ...current,
            hiddenAttachments: [...current.hiddenAttachments, ...op.attachmentIndices]
          });
        }
        break;
        
      case 'unhide':
        // Remove the hidden flag (reverses a previous hide)
        const currentState = affected.get(op.targetMessageId);
        if (currentState) {
          affected.set(op.targetMessageId, { ...currentState, hidden: false });
        }
        break;
    }
  }
  
  return affected;
});

// Check if current user has admin capability
const isAdmin = computed(() => {
  const summary = store.state.grantSummary;
  if (!summary?.grantCapabilities) return false;
  
  // Find the latest admin capability record
  const adminRecords = summary.grantCapabilities.filter((c: any) => c.capability === 'admin');
  if (adminRecords.length === 0) return false;
  
  const latest = adminRecords.reduce((a: any, b: any) => (a.time > b.time ? a : b));
  return latest.action === 'granted';
});

const isResearcher = computed(() => {
  const summary = store.state.grantSummary;
  if (!summary?.grantCapabilities) return false;
  
  // Find the latest researcher capability record
  const researcherRecords = summary.grantCapabilities.filter((c: any) => c.capability === 'researcher');
  if (researcherRecords.length === 0) return false;
  
  const latest = researcherRecords.reduce((a: any, b: any) => (a.time > b.time ? a : b));
  return latest.action === 'granted';
});

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

// Thinking/reasoning toggle
const thinkingEnabled = computed(() => {
  return currentConversation.value?.settings?.thinking?.enabled || false;
});

const thinkingBudgetTokens = computed(() => {
  return currentConversation.value?.settings?.thinking?.budgetTokens || 10000;
});

// Check if current model supports thinking (from model config)
// For standard conversations: check the conversation's model
// For group chat (prefill/messages): check the selected responder's model
const modelSupportsThinking = computed(() => {
  const format = currentConversation.value?.format;
  
  // Treat undefined format as standard (legacy/migrated conversations)
  if (format === 'standard' || !format) {
    // Standard format - use conversation model
    const modelId = currentConversation.value?.model || '';
    const model = store.state.models.find(m => m.id === modelId);
    return model?.supportsThinking || false;
  } else {
    // Group chat (prefill/messages) - check selected responder's model
    if (selectedResponder.value) {
      const responder = participants.value.find(p => p.id === selectedResponder.value);
      if (responder?.model) {
        const model = store.state.models.find(m => m.id === responder.model);
        return model?.supportsThinking || false;
      }
    }
    // No responder selected - check if ANY assistant participant has a thinking-capable model
    const anyAssistantSupportsThinking = participants.value.some(p => {
      if (p.type !== 'assistant' || !p.model) return false;
      const model = store.state.models.find(m => m.id === p.model);
      return model?.supportsThinking || false;
    });
    return anyAssistantSupportsThinking;
  }
});

async function toggleThinking() {
  if (!currentConversation.value) return;
  
  const newEnabled = !thinkingEnabled.value;
  const newSettings = {
    ...currentConversation.value.settings,
    thinking: newEnabled 
      ? { enabled: true, budgetTokens: thinkingBudgetTokens.value }
      : undefined
  };
  
  await updateConversationSettings({ settings: newSettings });
}

// Detached branch mode - for independent branch navigation in multi-user chats
const isDetachedFromMainBranch = computed(() => store.state.isDetachedFromMainBranch);

const isCollaborativeConversation = computed(() => {
  // Show detached toggle for multi-user conversations:
  // 1. Multiple users currently in room (real-time collaboration)
  // 2. Conversation has been shared with me (I'm a recipient)
  // 3. I've shared this conversation with others via public link
  // 4. This conversation has collaborators (user-to-user sharing)
  const conversationId = currentConversation.value?.id;
  if (!conversationId) return false;
  
  const multipleUsers = roomUsers.value.length > 1;
  const sharedWithMe = sharedConversations.value.some(s => s.conversationId === conversationId);
  const iSharedPublic = myCreatedShares.value.some(s => s.conversationId === conversationId);
  const hasCollaborators = currentConversationCollaborators.value.length > 0;
  
  return multipleUsers || sharedWithMe || iSharedPublic || hasCollaborators;
});

function toggleDetachedMode() {
  store.setDetachedMode(!store.state.isDetachedFromMainBranch);
}

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

// Get all bookmarks with message content previews for the bookmark browser
const allBookmarksWithPreviews = computed(() => {
  return bookmarks.value.map(bookmark => {
    // Find the message and branch
    const message = allMessages.value.find(m => m.id === bookmark.messageId);
    const branch = message?.branches.find(b => b.id === bookmark.branchId);
    
    // Generate preview from message content (longer preview to fill wider dropdowns)
    const content = branch?.content || '';
    const preview = content.slice(0, 250) + (content.length > 250 ? '...' : '');
    
    // Get participant info for color coding
    let participantName = branch?.role === 'user' ? 'User' : 'Assistant';
    let participantColor = branch?.role === 'user' ? '#bb86fc' : getModelColor(branch?.model);
    let modelName: string | null = null;
    
    if (branch?.participantId) {
      const participant = participants.value.find(p => p.id === branch.participantId);
      if (participant) {
        participantName = participant.name || (participant.type === 'user' ? '(continue)' : '(continue)');
        if (participant.type === 'assistant') {
          participantColor = getModelColor(participant.model || branch.model);
        }
      }
    }
    
    // Get model display name for assistant messages
    if (branch?.role === 'assistant' && branch.model) {
      const modelObj = store.state.models?.find((m: any) => m.id === branch.model);
      if (modelObj?.displayName) {
        modelName = modelObj.displayName;
      } else if (modelObj?.providerModelId) {
        modelName = modelObj.providerModelId;
      } else {
        // Fallback to shortened model ID
        modelName = branch.model.split('/').pop() || branch.model;
      }
    }
    
    return {
      ...bookmark,
      preview,
      participantName,
      participantColor,
      modelName,
      role: branch?.role || 'user'
    };
  });
});

// Check if a bookmark is in the current active path
function isBookmarkInActivePath(bookmark: Bookmark): boolean {
  return bookmarksInActivePath.value.some(
    b => b.messageId === bookmark.messageId && b.branchId === bookmark.branchId
  );
}

// Track width of bookmark bar for dropdown (reactive to resize)
const bookmarkDropdownWidth = ref(500);
let bookmarkBarResizeObserver: ResizeObserver | null = null;

function updateBookmarkDropdownWidth() {
  if (bookmarkBarRef.value) {
    bookmarkDropdownWidth.value = bookmarkBarRef.value.offsetWidth;
  }
}

// Set up resize observer when bookmark bar is available
watch(bookmarkBarRef, (newRef) => {
  // Clean up old observer
  if (bookmarkBarResizeObserver) {
    bookmarkBarResizeObserver.disconnect();
    bookmarkBarResizeObserver = null;
  }
  
  if (newRef) {
    // Initial measurement
    updateBookmarkDropdownWidth();
    
    // Set up observer for future changes
    bookmarkBarResizeObserver = new ResizeObserver(() => {
      updateBookmarkDropdownWidth();
    });
    bookmarkBarResizeObserver.observe(newRef);
  }
}, { immediate: true });

// Clean up observer on unmount
onBeforeUnmount(() => {
  if (bookmarkBarResizeObserver) {
    bookmarkBarResizeObserver.disconnect();
  }
});

// Navigate to a bookmark (switches branches if needed and scrolls to message)
async function navigateToBookmark(messageId: string, branchId: string) {
  // Use navigateToTreeBranch which properly switches all ancestor branches
  await navigateToTreeBranch(messageId, branchId);
}

const selectedResponderName = computed(() => {
  const responder = assistantParticipants.value.find(p => p.id === selectedResponder.value);
  return responder?.name || 'Assistant';
});

const selectedParticipantName = computed(() => {
  const participant = allParticipants.value.find(p => p.id === selectedParticipant.value);
  return participant?.name || 'User';
});

const selectedParticipantModel = computed(() => {
  const participant = allParticipants.value.find(p => p.id === selectedParticipant.value);
  return participant?.model || '';
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

// Suggested models for the pill bar (works for both standard and group chat)
const suggestedModelsForPillBar = computed(() => {
  if (!currentConversation.value) return [];
  
  const suggestedModelIds = systemConfig.value.groupChatSuggestedModels || [];
  
  // For standard conversations, exclude the current model
  // For group chats, exclude all participant models
  const excludeModelIds = new Set<string>();
  
  if (currentConversation.value.format === 'standard') {
    if (currentConversation.value.model) {
      excludeModelIds.add(currentConversation.value.model);
    }
  } else {
    participants.value
      .filter(p => p.type === 'assistant')
      .forEach(p => {
        if (p.model) excludeModelIds.add(p.model);
      });
  }
  
  // Limit suggestions to avoid clutter
  const maxSuggestions = currentConversation.value.format === 'standard' ? 3 : (participants.value.length > 3 ? 0 : 3);
  
  return suggestedModelIds
    .filter(modelId => !excludeModelIds.has(modelId))
    .slice(0, maxSuggestions)
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
  // Set up console log interceptor for debugging stuck generations
  if (typeof window !== 'undefined') {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    
    const captureLog = (level: string, args: any[]) => {
      const timestamp = new Date().toISOString();
      const message = args.map(a => {
        try {
          return typeof a === 'object' ? JSON.stringify(a) : String(a);
        } catch {
          return '[unserializable]';
        }
      }).join(' ');
      consoleLogs.push(`[${timestamp}] [${level}] ${message}`);
      if (consoleLogs.length > MAX_CONSOLE_LOGS) {
        consoleLogs.shift();
      }
    };
    
    console.log = (...args) => { captureLog('LOG', args); originalLog.apply(console, args); };
    console.warn = (...args) => { captureLog('WARN', args); originalWarn.apply(console, args); };
    console.error = (...args) => { captureLog('ERROR', args); originalError.apply(console, args); };
  }
  
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
  await loadSharedConversations();
  await loadMyCreatedShares();
  await loadPersonas();

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
            streamingBranchId.value = lastBranch.id; // Track which branch is streaming
            isStreaming.value = true;
            autoScrollEnabled.value = true; // Re-enable auto-scroll for new messages
            streamingError.value = null; // Clear any previous errors
            startStuckDetection(); // Start tracking for stuck generation
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
      
      store.state.wsService.on('message_edited', (data: any) => {
        // A message was edited (e.g., regenerate adds a new branch)
        // Check if a new empty assistant branch was added - this means regeneration started
        if (data.message && data.message.branches?.length > 0) {
          const activeBranch = data.message.branches.find((b: any) => b.id === data.message.activeBranchId);
          // If the active branch is an assistant with empty/minimal content, streaming is starting
          // BUT: Don't re-enter streaming mode if:
          // 1. We're already streaming for this exact message, OR
          // 2. This branch ID was recently streamed (completed within last 30 seconds)
          // This prevents race conditions with fast completions and DEBUG CAPTURE updates
          const alreadyStreamingThisMessage = isStreaming.value && streamingMessageId.value === data.message.id;
          const recentlyCompletedBranch = lastCompletedBranchId.value === data.message.activeBranchId && 
            lastCompletedTime.value && (Date.now() - lastCompletedTime.value < 30000);
          
          if (!alreadyStreamingThisMessage && !recentlyCompletedBranch && 
              activeBranch && activeBranch.role === 'assistant' && 
              (!activeBranch.content || activeBranch.content.length < 10)) {
            streamingMessageId.value = data.message.id;
            streamingBranchId.value = data.message.activeBranchId;
            isStreaming.value = true;
            autoScrollEnabled.value = true;
            streamingError.value = null;
            startStuckDetection(); // Start tracking for stuck generation
            console.log('[WebSocket] Regenerate detected - starting streaming for message:', data.message.id.slice(0, 8));
          }
        }
      });
      
      store.state.wsService.on('stream', (data: any) => {
        // Streaming content update - track which branch is being streamed
        // This helps us know whether to auto-scroll (only if visible branch is streaming)
        if (data.messageId && data.branchId) {
          // Check if this is the active (visible) branch of the message
          const message = store.state.allMessages.find(m => m.id === data.messageId);
          const isActiveBranch = message && message.activeBranchId === data.branchId;
          
          // Track token arrival for stuck detection (only for tracked message)
          if (data.messageId === streamingMessageId.value && (data.content || data.contentBlocks)) {
            onTokenReceived();
          }
          
          if (data.isComplete || data.aborted) {
            // This branch finished streaming
            // Track this completed branch to prevent re-triggering from DEBUG CAPTURE updates
            if (data.branchId) {
              lastCompletedBranchId.value = data.branchId;
              lastCompletedTime.value = Date.now();
            }
            // Clear tracking if this was the tracked branch (whether active or not)
            if (data.branchId === streamingBranchId.value) {
              streamingBranchId.value = null;
              isStreaming.value = false;
              streamingMessageId.value = null;
              clearStuckDetection();
            }
            if (data.aborted) {
              console.log('Generation was aborted');
            }
          } else {
            // Still streaming - only track if this is the active (visible) branch
            if (isActiveBranch) {
              streamingMessageId.value = data.messageId;
              streamingBranchId.value = data.branchId;
              isStreaming.value = true;
            }
          }
        }
      });
      
      // Handle generation_aborted event (for cases where messageId might not match)
      store.state.wsService.on('generation_aborted', (data: any) => {
        console.log('Generation aborted for conversation:', data.conversationId);
        if (data.conversationId === currentConversation.value?.id) {
          isStreaming.value = false;
          streamingMessageId.value = null;
          streamingBranchId.value = null;
          clearStuckDetection();
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
        
        // If we're currently streaming, mark it as failed on the message
        if (isStreaming.value && streamingMessageId.value) {
          streamingError.value = {
            messageId: streamingMessageId.value,
            error: data.error || 'Failed to generate response',
            suggestion: data.suggestion
          };
          isStreaming.value = false;
          // Don't clear streamingMessageId so we can show the error on the right message
        } else {
          // Not streaming - show error in snackbar (e.g., pricing validation failed)
          errorSnackbarMessage.value = data.error || 'An error occurred';
          errorSnackbarDetails.value = data.details || data.suggestion || '';
          errorSnackbar.value = true;
        }
      });
      
      store.state.wsService.on('content_blocked', (data: any) => {
        // Content was blocked by moderation - show informative dialog
        console.warn('Content blocked by moderation:', data);
        contentBlockedDialog.value = true;
      });
      
      // Multi-user room events
      store.state.wsService.on('room_joined', (data: any) => {
        console.log('[Room] Joined room:', data.conversationId);
        roomUsers.value = data.activeUsers || [];
        activeAiRequest.value = data.activeAiRequest || null;
      });
      
      store.state.wsService.on('user_joined', (data: any) => {
        console.log('[Room] User joined:', data.userId);
        roomUsers.value = data.activeUsers || [];
      });
      
      store.state.wsService.on('user_left', (data: any) => {
        console.log('[Room] User left:', data.userId);
        roomUsers.value = data.activeUsers || [];
        typingUsers.value.delete(data.userId);
      });
      
      store.state.wsService.on('user_typing', (data: any) => {
        if (data.conversationId === currentConversation.value?.id) {
          if (data.isTyping) {
            typingUsers.value.set(data.userId, data.userName || 'Someone');
          } else {
            typingUsers.value.delete(data.userId);
          }
        }
      });
      
      store.state.wsService.on('ai_generating', (data: any) => {
        console.log('[Room] AI generating for:', data.conversationId, 'by user:', data.userId);
        if (data.conversationId === currentConversation.value?.id) {
          activeAiRequest.value = { userId: data.userId, messageId: data.messageId };
          // If we're tracking streaming, update our state
          if (data.userId !== store.state.user?.id) {
            // Another user triggered the AI - we should see their message
            streamingMessageId.value = data.messageId;
            isStreaming.value = true;
            autoScrollEnabled.value = true;
          }
        }
      });
      
      store.state.wsService.on('ai_finished', (data: any) => {
        console.log('[Room] AI finished for:', data.conversationId);
        if (data.conversationId === currentConversation.value?.id) {
          activeAiRequest.value = null;
          isAiRequestQueued.value = false;
          // Also clear streaming state - this is a backup in case stream complete event was missed
          if (isStreaming.value) {
            console.log('[Room] Clearing streaming state from ai_finished event');
            isStreaming.value = false;
            streamingMessageId.value = null;
            streamingBranchId.value = null;
          }
        }
      });
      
      store.state.wsService.on('ai_request_queued', (data: any) => {
        console.log('[Room] AI request queued:', data.reason);
        if (data.conversationId === currentConversation.value?.id) {
          isAiRequestQueued.value = true;
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
  
  // Load conversation from route (handles both /conversation/:id and /conversation/:conversationId/message/:messageId)
  const conversationId = (route.params.conversationId || route.params.id) as string | undefined;
  if (conversationId) {
    console.log(`[ConversationView] Route has conversation ID: ${conversationId}`);
    console.log(`[ConversationView] Starting conversation load...`);
    const loadStart = Date.now();
    isLoadingConversation.value = true;

    try {
      await store.loadConversation(conversationId);
      console.log(`[ConversationView] ✓ store.loadConversation completed in ${Date.now() - loadStart}ms`);
      console.log(`[ConversationView] allMessages.length: ${store.state.allMessages.length}`);
    } catch (error) {
      console.error(`[ConversationView] ✗ store.loadConversation failed:`, error);
    } finally {
      isLoadingConversation.value = false;
    }

    try {
      await loadParticipants();
      console.log(`[ConversationView] ✓ loadParticipants completed`);
    } catch (error) {
      console.error(`[ConversationView] ✗ loadParticipants failed:`, error);
    }

    try {
      await loadBookmarks();
      console.log(`[ConversationView] ✓ loadBookmarks completed`);
    } catch (error) {
      console.error(`[ConversationView] ✗ loadBookmarks failed:`, error);
    }

    try {
      await loadCurrentConversationCollaborators();
      console.log(`[ConversationView] ✓ loadCurrentConversationCollaborators completed`);
    } catch (error) {
      console.error(`[ConversationView] ✗ loadCurrentConversationCollaborators failed:`, error);
    }

    console.log(`[ConversationView] Total load time: ${Date.now() - loadStart}ms`);

    // Join the room for multi-user support
    if (store.state.wsService) {
      console.log(`[ConversationView] Joining WebSocket room: ${conversationId}`);
      store.state.wsService.joinRoom(conversationId);
    } else {
      console.warn(`[ConversationView] ⚠ wsService not available for room join`);
    }

    // Ensure DOM is updated before scrolling
    await nextTick();

    // Check if this is a deep link to a specific message
    const messageId = route.params.messageId as string | undefined;
    const branchId = route.query.branch as string | undefined;

    if (messageId) {
      // Deep link - navigate to specific message
      setTimeout(async () => {
        await handleEventNavigate(messageId, branchId);
        // Clean up the URL to the simple form
        router.replace(`/conversation/${conversationId}`);
      }, 100);
    } else {
      // Normal load - scroll to bottom
      setTimeout(() => {
        scrollToBottom();
      }, 100);
    }

    if (isMobile.value) {
      mobilePanel.value = 'conversation';
      drawer.value = false;
    }
  } else {
    console.log(`[ConversationView] No conversation ID in route`);
  }
  
  // Mark initialization as complete so route watcher can take over
  isInitialized.value = true;
});

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateMobileState);
  }
  
  // Leave room when unmounting
  if (currentConversation.value && store.state.wsService) {
    store.state.wsService.leaveRoom(currentConversation.value.id);
  }
});

// Store drafts per conversation
const conversationDrafts = ref<Map<string, string>>(new Map());

// Track if initial setup is complete
const isInitialized = ref(false);

// Get conversation ID from either route format
function getConversationIdFromRoute(): string | undefined {
  // Handle both /conversation/:id and /conversation/:conversationId/message/:messageId
  return (route.params.conversationId || route.params.id) as string | undefined;
}

// Watch route changes
watch(() => getConversationIdFromRoute(), async (newId, oldId) => {
  // Skip if not yet initialized (will be handled by onMounted -> loadInitialConversation)
  if (!isInitialized.value) return;
  
  if (isMobile.value) {
    mobilePanel.value = newId ? 'conversation' : 'sidebar';
  }
  
  // Save current draft before switching
  if (oldId && messageInput.value.trim()) {
    conversationDrafts.value.set(oldId as string, messageInput.value);
  }
  
  // Leave old room
  if (oldId && store.state.wsService) {
    store.state.wsService.leaveRoom(oldId as string);
    roomUsers.value = [];
    typingUsers.value = new Map();
    activeAiRequest.value = null;
  }
  
  // Reset streaming state when switching conversations
  isStreaming.value = false;
  streamingMessageId.value = null;
  streamingBranchId.value = null;
  streamingError.value = null;
  
  if (newId) {
    console.log(`[ConversationView:watch] Route changed to: ${newId}`);
    const loadStart = Date.now();
    isLoadingConversation.value = true;
    
    // Restore draft for this conversation or clear input
    messageInput.value = conversationDrafts.value.get(newId as string) || '';
    
    // Clear selected branch when switching conversations
    if (selectedBranchForParent.value) {
      cancelBranchSelection();
    }

    try {
      await store.loadConversation(newId as string);
      console.log(`[ConversationView:watch] ✓ Conversation loaded in ${Date.now() - loadStart}ms, messages: ${store.state.allMessages.length}`);
    } catch (error) {
      console.error(`[ConversationView:watch] ✗ Failed to load conversation:`, error);
    } finally {
      isLoadingConversation.value = false;
    }
    
    await loadParticipants();
    await loadBookmarks();
    await loadCurrentConversationCollaborators();
    
    console.log(`[ConversationView:watch] Total load time: ${Date.now() - loadStart}ms`);
    
    // Join the room for multi-user support
    if (store.state.wsService) {
      store.state.wsService.joinRoom(newId as string);
    }
    
    // Ensure DOM is updated before scrolling
    await nextTick();

    // Check if this is a deep link to a specific message
    const messageId = route.params.messageId as string | undefined;
    const branchId = route.query.branch as string | undefined;

    if (messageId) {
      // Deep link - navigate to specific message
      setTimeout(async () => {
        await handleEventNavigate(messageId, branchId);
        // Clean up the URL to the simple form
        router.replace(`/conversation/${newId}`);
      }, 100);
    } else {
      // Normal load - scroll to bottom
      setTimeout(() => {
        scrollToBottom();
      }, 100);
    }
  } else {
    // Navigating away from a conversation - clear input
    messageInput.value = '';
  }
});

// Save UI state when speaking as or responder changes
watch(selectedParticipant, (newValue) => {
  if (newValue && !isLoadingUIState.value) {
    saveUserUIState({ speakingAs: newValue });
  }
});

watch(selectedResponder, (newValue) => {
  if (newValue && !isLoadingUIState.value) {
    saveUserUIState({ selectedResponder: newValue });
  }
});

// Save detached mode changes
watch(() => store.state.isDetachedFromMainBranch, (newValue) => {
  if (!isLoadingUIState.value) {
    saveUserUIState({ isDetached: newValue });
  }
});

// Watch for new messages to scroll
watch(messages, () => {
  // Don't auto-scroll if:
  // 1. Auto-scroll is disabled (user scrolled up)
  // 2. User is actively scrolling (prevents fighting with user input)
  // 3. We're switching branches via the navigation arrows
  // 4. We're streaming but the streaming branch is not the visible one
  
  // Check if the currently streaming branch is visible
  const isStreamingVisibleBranch = !isStreaming.value || (
    streamingMessageId.value && 
    streamingBranchId.value &&
    messages.value.some(m => m.id === streamingMessageId.value && m.activeBranchId === streamingBranchId.value)
  );
  
  const shouldScroll = autoScrollEnabled.value && 
                       !userScrolledRecently.value &&
                       !isSwitchingBranch.value &&
                       isStreamingVisibleBranch;
  
  if (shouldScroll) {
    nextTick(() => {
      scrollToBottom(true); // Smooth scroll for new messages
    });
  }
}, { deep: true });

// Set up scroll sync for breadcrumb navigation and auto-scroll detection
let scrollTimeout: number;
let userScrollCooldown: number;
watch(messagesContainer, (container) => {
  if (container) {
    // Vuetify components expose their DOM element via $el
    const element = (container as any).$el || container;

    if (element && element.addEventListener) {
      const handleScroll = () => {
        // Ignore programmatic scrolls for user interaction tracking
        // But still allow them to sync breadcrumbs
        if (!isProgrammaticScroll.value) {
          // Mark that user scrolled recently - prevents auto-scroll from fighting
          userScrolledRecently.value = true;
          clearTimeout(userScrollCooldown);
          userScrollCooldown = window.setTimeout(() => {
            userScrolledRecently.value = false;
          }, 300); // Wait 300ms after last scroll before allowing auto-scroll
          
          // Check scroll position and update autoScrollEnabled
          // This allows user to scroll up to disable auto-scroll at any time
          const scrollBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
          // If user has scrolled up more than a small threshold, disable auto-scroll
          if (scrollBottom > 50) {
            autoScrollEnabled.value = false;
          }
          // If user scrolls back near the bottom, re-enable (only for user scrolls)
          else if (scrollBottom <= 10) {
            autoScrollEnabled.value = true;
          }
        }
        
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
  // Mark this as a programmatic scroll so the scroll handler doesn't re-enable autoScroll
  isProgrammaticScroll.value = true;
  
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
              } else {
                // Done scrolling, clear the programmatic flag after a short delay
                setTimeout(() => {
                  isProgrammaticScroll.value = false;
                }, 100);
              }
            }, 50); // Reduced delay for more responsive scrolling
          } else {
            // Max attempts reached, clear the flag
            setTimeout(() => {
              isProgrammaticScroll.value = false;
            }, 100);
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
  
  // Stop typing notification immediately when sending
  stopTypingNotification();
  
  console.log('ConversationView sendMessage:', content);
  console.log('Current visible messages:', messages.value.length);
  console.log('Selected parent branch:', selectedBranchForParent.value);
  
  // Capture hiddenFromAi and samplingBranches (don't reset sampling - user may want to continue sampling)
  const messageHiddenFromAi = hiddenFromAi.value;
  const messageSamplingBranches = samplingBranches.value;
  hiddenFromAi.value = false; // Reset hiddenFromAi for next message (sampling stays)
  
  // Only set streaming state if message will trigger AI generation
  // Hidden messages, no-response mode, and messages without responder don't trigger AI
  const willTriggerAi = !messageHiddenFromAi && (
    (currentConversation.value?.format === 'standard' && !noResponseMode.value) || selectedResponder.value
  );
  
  if (willTriggerAi && !isMultiuserConversation.value) {
    // Only block UI in single-user mode when expecting AI response
    isStreaming.value = true;
  }
  streamingError.value = null;
  
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
      // Only set responderId if not in no-response mode
      responderId = noResponseMode.value ? undefined : defaultAssistant?.id;
    } else {
      // For other formats, use selected participants
      participantId = selectedParticipant.value || undefined;
      responderId = selectedResponder.value || undefined;
    }
    
    // Pass the selected parent branch if one is selected
    const parentBranchId = selectedBranchForParent.value?.branchId;
      
    await store.sendMessage(content, participantId, responderId, attachmentsCopy, parentBranchId, messageHiddenFromAi, messageSamplingBranches);
    
    // Clear selection after successful send
    if (selectedBranchForParent.value) {
      selectedBranchForParent.value = null;
    }
    
    // Clear draft for this conversation since message was sent successfully
    if (currentConversation.value) {
      conversationDrafts.value.delete(currentConversation.value.id);
    }
  } catch (error) {
    console.error('Failed to send message:', error);
    messageInput.value = content; // Restore input on error
    isStreaming.value = false; // Reset streaming state on error
  }
}

async function continueGeneration() {
  if (isStreaming.value) return;
  
  console.log('ConversationView continueGeneration');
  console.log('Selected parent branch:', selectedBranchForParent.value);
  
  // Set streaming state IMMEDIATELY to prevent race conditions
  isStreaming.value = true;
  streamingError.value = null;
  
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
    
    // Send empty message to trigger AI response (with sampling if enabled)
    await store.continueGeneration(responderId, parentBranchId, samplingBranches.value);
    
    // Clear selection after successful continue
    if (selectedBranchForParent.value) {
      selectedBranchForParent.value = null;
    }
  } catch (error) {
    console.error('Failed to continue generation:', error);
    isStreaming.value = false; // Reset on error
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
          settings: getValidatedModelDefaults(model)
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to create participant');
      }
      
      participant = await response.json();
      
      // Add to local participants array immediately (don't wait for loadParticipants)
      // This ensures the participant is available when the streaming message arrives
      participants.value.push(participant);
      console.log('Added new participant to local array:', participant.name, participant.id);
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
  // Find the current visible parent branch ID
  // This ensures regenerated branches are children of the correct parent after branch switches
  const visibleMessages = messages.value;
  const messageIndex = visibleMessages.findIndex(m => m.id === messageId);
  
  let parentBranchId: string | undefined;
  if (messageIndex > 0) {
    const parentMessage = visibleMessages[messageIndex - 1];
    parentBranchId = parentMessage.activeBranchId;
  }
  
  console.log('=== REGENERATE CALLED ===');
  console.log('messageId:', messageId.slice(0, 8));
  console.log('branchId:', branchId.slice(0, 8));
  console.log('parentBranchId:', parentBranchId?.slice(0, 8));
  console.log('visible messages count:', visibleMessages.length);
  console.log('message index in visible:', messageIndex);
  console.log('samplingBranches:', samplingBranches.value);
  
  // Set streaming state before sending request
  streamingMessageId.value = messageId;
  isStreaming.value = true;
  streamingError.value = null;
  autoScrollEnabled.value = true;
  
  await store.regenerateMessage(messageId, branchId, parentBranchId, samplingBranches.value);
}

function abortGeneration() {
  console.log('Aborting generation...');
  store.abortGeneration();
  // Note: isStreaming will be reset when we receive the aborted stream event
}

// Stuck generation detection
function startStuckDetection() {
  streamingStartTime.value = Date.now();
  firstTokenReceived.value = false;
  showStuckButton.value = false;
  
  // Clear any existing timer
  if (stuckCheckTimer) {
    clearTimeout(stuckCheckTimer);
  }
  
  // Set timer to check for stuck state after threshold (model-dependent)
  const thresholdMs = getStuckThresholdMs();
  stuckCheckTimer = setTimeout(() => {
    if (isStreaming.value && !firstTokenReceived.value) {
      console.warn('[Stuck Detection] Generation appears stuck - no tokens received after', thresholdMs / 1000, 'seconds');
      showStuckButton.value = true;
    }
  }, thresholdMs);
}

function onTokenReceived() {
  // Track when we last received content (for "content but no completion" detection)
  lastContentReceivedTime.value = Date.now();
  
  // Reset the "content stuck" timer - we're still receiving content
  if (contentStuckCheckTimer) {
    clearTimeout(contentStuckCheckTimer);
  }
  // Start a new timer - if no completion arrives within CONTENT_STUCK_TIMEOUT_MS, show stuck button
  contentStuckCheckTimer = setTimeout(() => {
    if (isStreaming.value && firstTokenReceived.value) {
      console.warn('[Stuck Detection] Content received but no completion after', CONTENT_STUCK_TIMEOUT_MS / 1000, 'seconds');
      showStuckButton.value = true;
    }
  }, CONTENT_STUCK_TIMEOUT_MS);
  
  if (!firstTokenReceived.value) {
    firstTokenReceived.value = true;
    showStuckButton.value = false;
    if (stuckCheckTimer) {
      clearTimeout(stuckCheckTimer);
      stuckCheckTimer = null;
    }
  }
}

function clearStuckDetection() {
  streamingStartTime.value = null;
  firstTokenReceived.value = false;
  lastContentReceivedTime.value = null;
  showStuckButton.value = false;
  if (stuckCheckTimer) {
    clearTimeout(stuckCheckTimer);
    stuckCheckTimer = null;
  }
  if (contentStuckCheckTimer) {
    clearTimeout(contentStuckCheckTimer);
    contentStuckCheckTimer = null;
  }
}

async function submitStuckAnalytics() {
  stuckAnalyticsSubmitting.value = true;
  
  try {
    const analyticsData = {
      timestamp: new Date().toISOString(),
      streamingStartTime: streamingStartTime.value ? new Date(streamingStartTime.value).toISOString() : null,
      elapsedMs: streamingStartTime.value ? Date.now() - streamingStartTime.value : null,
      lastContentReceivedTime: lastContentReceivedTime.value ? new Date(lastContentReceivedTime.value).toISOString() : null,
      timeSinceLastContent: lastContentReceivedTime.value ? Date.now() - lastContentReceivedTime.value : null,
      conversationId: currentConversation.value?.id,
      streamingMessageId: streamingMessageId.value,
      streamingBranchId: streamingBranchId.value,
      firstTokenReceived: firstTokenReceived.value,
      wsConnected: store.state.wsService?.isConnected,
      userAgent: navigator.userAgent,
      consoleLogs: consoleLogs.slice(-100), // Last 100 logs
      currentUrl: window.location.href,
    };
    
    // Send to backend
    await api.post('/analytics/stuck-generation', analyticsData);
    console.log('[Stuck Detection] Analytics submitted successfully');
  } catch (error) {
    console.error('[Stuck Detection] Failed to submit analytics:', error);
  } finally {
    stuckAnalyticsSubmitting.value = false;
    stuckDialog.value = false;
    // Reload the page
    window.location.reload();
  }
}

function dismissStuckDialog() {
  stuckDialog.value = false;
  showStuckButton.value = false;
}

async function editMessage(messageId: string, branchId: string, content: string) {
  // Pass the currently selected responder for multi-participant mode
  let responderId: string | undefined;
  
  if (currentConversation.value?.format === 'standard') {
    // For standard format, use default assistant (unless in no-response mode)
    if (!noResponseMode.value) {
      const defaultAssistant = participants.value.find(p => p.type === 'assistant' && p.name === 'Assistant');
      responderId = defaultAssistant?.id;
    }
  } else {
    // For other formats, use selected responder
    responderId = selectedResponder.value || undefined;
  }
  
  await store.editMessage(messageId, branchId, content, responderId, false, samplingBranches.value);
}

async function editMessageOnly(messageId: string, branchId: string, content: string) {
  // Edit and branch without triggering AI regeneration
  await store.editMessage(messageId, branchId, content, undefined, true);
}

function switchBranch(messageId: string, branchId: string) {
  isSwitchingBranch.value = true;
  
  // Don't clear streaming state here - let stream completion events handle that
  // The scroll logic will check if the streaming branch is visible
  // Also disable auto-scroll when switching branches during streaming
  if (isStreaming.value) {
    autoScrollEnabled.value = false;
  }
  
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
  
  // Collect all branches that need switching
  const branchesToSwitch = pathToRoot.filter(({ messageId: msgId, branchId: brId }) => {
    const message = allMessages.value.find(m => m.id === msgId);
    return message && message.activeBranchId !== brId;
  });
  
  // Use batch switch for much faster navigation
  if (branchesToSwitch.length > 0) {
    console.log(`Batch switching ${branchesToSwitch.length} branches`);
    store.switchBranchesBatch(branchesToSwitch);
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

function openCollaborationDialog(conversation: Conversation) {
  // Navigate to the conversation if it's not the current one
  if (currentConversation.value?.id !== conversation.id) {
    router.push(`/conversation/${conversation.id}`);
  }
  // Open the collaboration share dialog
  collaborationDialog.value = true;
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
  input.accept = '.txt,.md,.csv,.json,.xml,.html,.css,.js,.ts,.py,.java,.cpp,.c,.h,.hpp,.jpg,.jpeg,.png,.gif,.webp,.svg,.pdf,application/pdf,.mp3,.wav,.flac,.ogg,.m4a,.aac,.mp4,.mov,.avi,.mkv,.webm';
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

function handleTextareaFocus() {
  // Fix for mobile Safari: scroll textarea into view when keyboard appears
  if (isMobile.value && messageTextarea.value) {
    // Small delay to let the keyboard start appearing
    setTimeout(() => {
      const el = messageTextarea.value?.$el;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 300);
  }
}

// Typing notification state
let typingTimeout: ReturnType<typeof setTimeout> | null = null;
let isTypingNotificationSent = false;

function handleTypingInput() {
  const conversationId = route.params.id as string;
  if (!conversationId || !store.state.wsService) return;
  
  // Send typing: true if we haven't already
  if (!isTypingNotificationSent) {
    store.state.wsService.sendTyping(conversationId, true);
    isTypingNotificationSent = true;
  }
  
  // Clear any existing timeout
  if (typingTimeout) {
    clearTimeout(typingTimeout);
  }
  
  // Set a timeout to send typing: false after 2 seconds of inactivity
  typingTimeout = setTimeout(() => {
    if (isTypingNotificationSent) {
      store.state.wsService?.sendTyping(conversationId, false);
      isTypingNotificationSent = false;
    }
  }, 2000);
}

function stopTypingNotification() {
  const conversationId = route.params.id as string;
  if (typingTimeout) {
    clearTimeout(typingTimeout);
    typingTimeout = null;
  }
  if (isTypingNotificationSent && conversationId && store.state.wsService) {
    store.state.wsService.sendTyping(conversationId, false);
    isTypingNotificationSent = false;
  }
}

// File type classifications for multimodal support
const FILE_TYPES = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
  pdf: ['pdf'],
  audio: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'webm'],
  video: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
  // Text files are anything not in the above categories
};

// MIME type mappings
const MIME_TYPES: Record<string, string> = {
  // Images
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'svg': 'image/svg+xml',
  // Documents
  'pdf': 'application/pdf',
  // Audio
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav',
  'flac': 'audio/flac',
  'ogg': 'audio/ogg',
  'm4a': 'audio/mp4',
  'aac': 'audio/aac',
  // Video
  'mp4': 'video/mp4',
  'mov': 'video/quicktime',
  'avi': 'video/x-msvideo',
  'mkv': 'video/x-matroska',
  'webm': 'video/webm',
};

function getFileCategory(extension: string): 'image' | 'pdf' | 'audio' | 'video' | 'text' {
  if (FILE_TYPES.image.includes(extension)) return 'image';
  if (FILE_TYPES.pdf.includes(extension)) return 'pdf';
  if (FILE_TYPES.audio.includes(extension)) return 'audio';
  if (FILE_TYPES.video.includes(extension)) return 'video';
  return 'text';
}

function getMimeType(extension: string, file: File): string {
  // Prefer file.type if available, fall back to our mapping
  if (file.type) return file.type;
  return MIME_TYPES[extension] || 'application/octet-stream';
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
    console.log(`Reading file: ${file.name} (${file.size} bytes, type: ${file.type})`);
    
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
    const category = getFileCategory(fileExtension);
    const mimeType = getMimeType(fileExtension, file);
    const isBinary = category !== 'text';
    
    let content: string;
    let encoding: 'base64' | 'text' = 'text';
    
    if (isBinary) {
      // Read binary files (images, PDFs, audio, video) as base64
      content = await readFileAsBase64(file);
      encoding = 'base64';
    } else {
      // Read text files as text
      content = await readFileAsText(file);
      encoding = 'text';
    }
    
    attachments.value.push({
      fileName: file.name,
      fileType: fileExtension,
      mimeType,
      fileSize: file.size,
      content,
      encoding,
      isImage: category === 'image',
      isPdf: category === 'pdf',
      isAudio: category === 'audio',
      isVideo: category === 'video',
    });
    console.log(`Added ${category} attachment: ${file.name} (${mimeType})`);
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

function getAttachmentChipColor(attachment: any): string | undefined {
  if (attachment.isPdf) return 'red-lighten-4';
  if (attachment.isAudio) return 'purple-lighten-4';
  if (attachment.isVideo) return 'blue-lighten-4';
  return undefined; // Default chip color
}

// Drag and drop handlers
function handleDragEnter(event: DragEvent) {
  dragCounter++;
  if (event.dataTransfer?.types.includes('Files')) {
    isDraggingOver.value = true;
  }
}

function handleDragOver(event: DragEvent) {
  // Required to allow drop
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
}

function handleDragLeave(event: DragEvent) {
  dragCounter--;
  if (dragCounter === 0) {
    isDraggingOver.value = false;
  }
}

async function handleDrop(event: DragEvent) {
  dragCounter = 0;
  isDraggingOver.value = false;
  
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;
  
  await processFiles(Array.from(files));
}

// Paste handler for images
async function handlePaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items;
  if (!items) return;
  
  const filesToProcess: File[] = [];
  
  for (const item of Array.from(items)) {
    // Check if it's a file (image, etc.)
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) {
        filesToProcess.push(file);
      }
    }
  }
  
  if (filesToProcess.length > 0) {
    // Prevent the default paste behavior for files
    event.preventDefault();
    await processFiles(filesToProcess);
  }
  // If no files, let the default text paste happen
}

// Shared file processing function
async function processFiles(files: File[]) {
  console.log(`Processing ${files.length} files from drag/drop or paste`);
  
  for (const file of files) {
    console.log(`Processing file: ${file.name} (${file.size} bytes, type: ${file.type})`);
    
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
    const category = getFileCategory(fileExtension);
    const mimeType = getMimeType(fileExtension, file);
    const isBinary = category !== 'text';
    
    // Check if file type is supported
    const supportedExtensions = [
      ...FILE_TYPES.image,
      ...FILE_TYPES.pdf,
      ...FILE_TYPES.audio,
      ...FILE_TYPES.video,
      'txt', 'md', 'csv', 'json', 'xml', 'html', 'css', 'js', 'ts', 'py', 'java', 'cpp', 'c', 'h', 'hpp'
    ];
    
    if (!supportedExtensions.includes(fileExtension) && !file.type.startsWith('image/')) {
      console.log(`Unsupported file type: ${fileExtension}`);
      continue;
    }
    
    let content: string;
    let encoding: 'base64' | 'text' = 'text';
    
    // For pasted images without extension, check MIME type
    const isImageFromMime = file.type.startsWith('image/');
    
    if (isBinary || isImageFromMime) {
      content = await readFileAsBase64(file);
      encoding = 'base64';
    } else {
      content = await readFileAsText(file);
      encoding = 'text';
    }
    
    attachments.value.push({
      fileName: file.name || `pasted-image-${Date.now()}.${file.type.split('/')[1] || 'png'}`,
      fileType: fileExtension || file.type.split('/')[1] || 'png',
      mimeType: mimeType || file.type,
      fileSize: file.size,
      content,
      encoding,
      isImage: category === 'image' || isImageFromMime,
      isPdf: category === 'pdf',
      isAudio: category === 'audio',
      isVideo: category === 'video',
    });
    console.log(`Added ${category || 'image'} attachment: ${file.name} (${mimeType || file.type})`);
  }
  
  console.log(`Total attachments: ${attachments.value.length}`);
}

async function archiveConversation(id: string) {
  if (confirm('Are you sure you want to archive this conversation?')) {
    await store.archiveConversation(id);
    if (currentConversation.value?.id === id) {
      router.push('/conversation');
    }
  }
}

async function compactConversation(id: string) {
  if (confirm('This will compact the conversation\'s event log to reduce file size. Debug data will be stripped. Continue?')) {
    try {
      const result = await store.compactConversation(id);
      if (result.success) {
        const r = result.result;
        alert(`Compaction complete!\n\nSize: ${r.originalSizeMB} MB → ${r.compactedSizeMB} MB (${r.reductionPercent}% reduction)\nEvents: ${r.originalEventCount} → ${r.compactedEventCount}\n\n${result.message}`);
      } else {
        alert('Compaction failed: ' + result.message);
      }
    } catch (error: any) {
      console.error('Compaction error:', error);
      alert('Compaction failed: ' + (error.response?.data?.error || error.message || 'Unknown error'));
    }
  }
}

function markConversationAsRead(conversation: Conversation) {
  // Get all branch IDs from this conversation
  // If it's the current conversation, use allMessages; otherwise we'd need to load it
  if (currentConversation.value?.id === conversation.id) {
    const allBranchIds = allMessages.value.flatMap(m => m.branches.map((b: any) => b.id));
    store.markBranchesAsRead(allBranchIds);
  }
}

function openDuplicateDialog(conversation: Conversation) {
  duplicateConversationTarget.value = conversation;
  duplicateDialog.value = true;
}

function getConversationMessageCount(conversationId: string): number {
  // If it's the current conversation, we have the messages
  if (currentConversation.value?.id === conversationId) {
    return messages.value.length;
  }
  // Otherwise estimate from the conversation object if available
  return 0; // Will be loaded when dialog opens
}

async function handleDuplicated(newConversation: Conversation) {
  // Refresh conversations list
  await store.loadConversations();
  // Navigate to the new conversation
  router.push(`/conversation/${newConversation.id}`);
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

async function deleteAllBranches(messageId: string) {
  const message = messages.value.find(m => m.id === messageId);
  if (!message) return;
  
  const branchCount = message.branches.length;
  if (branchCount <= 1) {
    // Only one branch, just delete normally
    if (confirm('Are you sure you want to delete this message and all its replies?')) {
      await store.deleteMessage(messageId, message.activeBranchId);
    }
    return;
  }
  
  if (confirm(`Delete all ${branchCount} versions of this message and their replies?`)) {
    // Delete all branches (delete in reverse order to avoid index issues)
    for (const branch of [...message.branches].reverse()) {
      await store.deleteMessage(messageId, branch.id);
    }
  }
}

// Get the last visible message's active branch ID for post-hoc operations
function getLastVisibleBranchId(): string | undefined {
  const visible = messages.value;
  if (visible.length === 0) return undefined;
  const lastMessage = visible[visible.length - 1];
  return lastMessage.activeBranchId;
}

// Post-hoc operation handlers
async function handlePostHocHide(messageId: string, branchId: string) {
  if (!currentConversation.value) return;
  
  try {
    await api.post(`/conversations/${currentConversation.value.id}/post-hoc-operation`, {
      type: 'hide',
      targetMessageId: messageId,
      targetBranchId: branchId,
      parentBranchId: getLastVisibleBranchId() // Send the correct parent branch
    });
    await store.loadConversation(currentConversation.value.id);
  } catch (error) {
    console.error('Failed to create post-hoc hide operation:', error);
  }
}

// Legacy handler - kept for backwards compatibility but not used with inline editing
async function handlePostHocEdit(messageId: string, branchId: string) {
  // This is now handled by inline editing via handlePostHocEditContent
  console.log('handlePostHocEdit called - should use inline editing instead');
}

// New handler for inline post-hoc editing
async function handlePostHocEditContent(messageId: string, branchId: string, content: string) {
  if (!currentConversation.value) return;
  
  try {
    await api.post(`/conversations/${currentConversation.value.id}/post-hoc-operation`, {
      type: 'edit',
      targetMessageId: messageId,
      targetBranchId: branchId,
      replacementContent: [{ type: 'text', text: content }],
      parentBranchId: getLastVisibleBranchId()
    });
    await store.loadConversation(currentConversation.value.id);
  } catch (error) {
    console.error('Failed to create post-hoc edit operation:', error);
  }
}

async function handleSplit(messageId: string, branchId: string, splitPosition: number) {
  if (!currentConversation.value) return;
  
  try {
    const response = await api.post(`/conversations/${currentConversation.value.id}/messages/${messageId}/split`, {
      branchId,
      splitPosition
    });
    
    if (response.data.success) {
      // Reload to get updated messages
      await store.loadConversation(currentConversation.value.id);
    }
  } catch (error) {
    console.error('Failed to split message:', error);
  }
}

function handleFork(messageId: string, branchId: string) {
  if (!currentConversation.value) return;
  
  // Open the fork dialog
  forkTargetMessageId.value = messageId;
  forkTargetBranchId.value = branchId;
  forkMode.value = 'full';
  forkIncludePrivateBranches.value = false;
  showForkDialog.value = true;
}

async function executeFork() {
  if (!currentConversation.value) return;
  
  forkIsLoading.value = true;
  
  try {
    const response = await api.post(`/conversations/${currentConversation.value.id}/fork`, {
      messageId: forkTargetMessageId.value,
      branchId: forkTargetBranchId.value,
      mode: forkMode.value,  // 'full' | 'compressed' | 'truncated'
      includePrivateBranches: forkIncludePrivateBranches.value
    });
    
    if (response.data.success && response.data.conversation) {
      showForkDialog.value = false;
      
      // Reload conversations list
      await store.loadConversations();
      
      // Navigate to the new conversation
      router.push(`/conversation/${response.data.conversation.id}`);
    }
  } catch (error) {
    console.error('Failed to fork conversation:', error);
    errorSnackbarMessage.value = 'Failed to fork conversation';
    errorSnackbar.value = true;
  } finally {
    forkIsLoading.value = false;
  }
}

async function handlePostHocHideBefore(messageId: string, branchId: string) {
  if (!currentConversation.value) return;
  
  if (!confirm('Hide all messages before this one from future AI context?')) return;
  
  try {
    await api.post(`/conversations/${currentConversation.value.id}/post-hoc-operation`, {
      type: 'hide_before',
      targetMessageId: messageId,
      targetBranchId: branchId,
      parentBranchId: getLastVisibleBranchId()
    });
    await store.loadConversation(currentConversation.value.id);
  } catch (error) {
    console.error('Failed to create post-hoc hide-before operation:', error);
  }
}

async function handlePostHocUnhide(messageId: string, branchId: string) {
  if (!currentConversation.value) return;
  
  try {
    await api.post(`/conversations/${currentConversation.value.id}/post-hoc-operation`, {
      type: 'unhide',
      targetMessageId: messageId,
      targetBranchId: branchId,
      parentBranchId: getLastVisibleBranchId()
    });
    await store.loadConversation(currentConversation.value.id);
  } catch (error) {
    console.error('Failed to create post-hoc unhide operation:', error);
  }
}

async function handleDeletePostHocOperation(messageId: string) {
  if (!currentConversation.value) return;
  
  const confirmed = confirm(
    'Delete this operation?\n\n' +
    'This will also delete all messages that come after it in this branch ' +
    '(including any AI responses that were generated with this operation in effect).'
  );
  
  if (!confirmed) return;
  
  try {
    await api.delete(`/conversations/${currentConversation.value.id}/post-hoc-operation/${messageId}`);
    await store.loadConversation(currentConversation.value.id);
  } catch (error) {
    console.error('Failed to delete post-hoc operation:', error);
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
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Add a brief highlight effect
    element.classList.add('highlight-flash');
    setTimeout(() => {
      element.classList.remove('highlight-flash');
    }, 1500);
  } else {
    console.warn(`[scrollToMessage] Element not found for message: ${messageId}`);
  }
}

async function handleEventNavigate(messageId: string, branchId?: string) {
  console.log(`[handleEventNavigate] messageId: ${messageId}, branchId: ${branchId}`);
  
  // Find the message in the store
  const message = store.state.allMessages.find(m => m.id === messageId);
  
  if (!message) {
    console.warn(`[handleEventNavigate] Message not found in allMessages: ${messageId}`);
    return;
  }
  
  // Get the target branch (either specified or current active)
  const targetBranchId = branchId || message.activeBranchId;
  const targetBranch = message.branches.find(b => b.id === targetBranchId);
  
  if (!targetBranch) {
    console.warn(`[handleEventNavigate] Branch not found: ${targetBranchId}`);
    return;
  }
  
  // Build the ancestry chain: trace back through parentBranchId to find all branches we need to activate
  const branchesToActivate: Array<{ messageId: string; branchId: string }> = [];
  
  // Add the target message's branch
  if (message.activeBranchId !== targetBranchId) {
    branchesToActivate.push({ messageId: message.id, branchId: targetBranchId });
  }
  
  // Trace back through parent branches
  let currentParentBranchId = targetBranch.parentBranchId;
  while (currentParentBranchId) {
    // Find the message that contains this branch
    const parentMessage = store.state.allMessages.find(m => 
      m.branches.some(b => b.id === currentParentBranchId)
    );
    
    if (!parentMessage) break;
    
    // If parent message isn't on this branch, we need to switch it
    if (parentMessage.activeBranchId !== currentParentBranchId) {
      branchesToActivate.unshift({ messageId: parentMessage.id, branchId: currentParentBranchId });
    }
    
    // Continue up the chain
    const parentBranch = parentMessage.branches.find(b => b.id === currentParentBranchId);
    currentParentBranchId = parentBranch?.parentBranchId || null;
  }
  
  // Switch branches in batch for faster navigation
  if (branchesToActivate.length > 0) {
    console.log(`[handleEventNavigate] Batch switching ${branchesToActivate.length} branches`);
    store.switchBranchesBatch(branchesToActivate);
  }
  
  // Wait for DOM to update
  await nextTick();
  
  // Then scroll to the message
  scrollToMessage(messageId);
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

// ==================== PER-USER UI STATE ====================
// These persist speakingAs, selectedResponder, and detached mode per-user

async function loadUserUIState() {
  if (!currentConversation.value) return;
  
  try {
    isLoadingUIState.value = true;
    const response = await api.get(`/conversations/${currentConversation.value.id}/ui-state`);
    const state = response.data;
    
    console.log('[ConversationView] Loaded UI state:', state);
    
    // Apply saved values if they exist and the participants are still valid
    if (state.speakingAs) {
      const participant = participants.value.find(p => p.id === state.speakingAs);
      if (participant) {
        selectedParticipant.value = state.speakingAs;
      }
    }
    
    if (state.selectedResponder) {
      const participant = participants.value.find(p => p.id === state.selectedResponder);
      if (participant) {
        selectedResponder.value = state.selectedResponder;
      }
    }

    // Note: isDetached and detachedBranches are now handled in store.loadConversation()
  } catch (error) {
    // Ignore errors - just use defaults
    console.debug('[ConversationView] No saved UI state found');
  } finally {
    isLoadingUIState.value = false;
  }
}

async function saveUserUIState(updates: { speakingAs?: string; selectedResponder?: string; isDetached?: boolean; detachedBranch?: { messageId: string; branchId: string } }) {
  if (!currentConversation.value || isLoadingUIState.value) return;
  
  try {
    await api.patch(`/conversations/${currentConversation.value.id}/ui-state`, updates);
  } catch (error) {
    // Non-critical - just log
    console.debug('[ConversationView] Failed to save UI state:', error);
  }
}

async function loadParticipants() {
  if (!currentConversation.value) return;
  
  console.log('[ConversationView] loadParticipants called');
  
  // Check cache first
  const cached = participantCache.get(currentConversation.value.id);
  if (cached) {
    console.log('[ConversationView] Using cached participants');
    participants.value = cached;
    
    // Set default selected participant - prefer the one that belongs to the current user
    const currentUserId = store.state.user?.id;
    const ownParticipant = participants.value.find(p => p.type === 'user' && p.isActive && p.userId === currentUserId);
    const defaultUser = ownParticipant || participants.value.find(p => p.type === 'user' && p.isActive);
    if (defaultUser) {
      selectedParticipant.value = defaultUser.id;
    }
    
    // Set default responder to first assistant
    const defaultAssistant = participants.value.find(p => p.type === 'assistant' && p.isActive);
    if (defaultAssistant) {
      console.log('[ConversationView] Setting selectedResponder to:', defaultAssistant.id, 'model:', defaultAssistant.model);
      selectedResponder.value = defaultAssistant.id;
    }
    
    // Load saved UI state (may override defaults)
    await loadUserUIState();
    return;
  }
  
  try {
    const response = await api.get(`/participants/conversation/${currentConversation.value.id}`);
    console.log('[ConversationView] Loaded participants from backend:', response.data);
    participants.value = response.data;
    
    // Cache the loaded participants
    participantCache.set(currentConversation.value.id, response.data);
    
    // Set default selected participant - prefer the one that belongs to the current user
    const currentUserId = store.state.user?.id;
    const ownParticipant = participants.value.find(p => p.type === 'user' && p.isActive && p.userId === currentUserId);
    const defaultUser = ownParticipant || participants.value.find(p => p.type === 'user' && p.isActive);
    if (defaultUser) {
      selectedParticipant.value = defaultUser.id;
    }
    
    // Set default responder to first assistant
    const defaultAssistant = participants.value.find(p => p.type === 'assistant' && p.isActive);
    if (defaultAssistant) {
      console.log('[ConversationView] Setting selectedResponder to:', defaultAssistant.id, 'model:', defaultAssistant.model);
      selectedResponder.value = defaultAssistant.id;
    }
    
    // Load saved UI state (may override defaults)
    await loadUserUIState();
  } catch (error) {
    console.error('Failed to load participants:', error);
  }
}

// Model to pre-fill in the add participant dialog
const addParticipantDefaultModelId = ref<string | undefined>(undefined);

function handleAddModel(model?: { id: string }) {
  // Opens the add participant dialog
  // For standard conversations, this will trigger conversion to group chat
  addParticipantDefaultModelId.value = model?.id;
  addParticipantDialog.value = true;
}

async function handleAddParticipant(participant: { name: string; type: 'user' | 'assistant' | 'persona'; model?: string; personaId?: string }) {
  if (!currentConversation.value) return;

  // If this is a standard conversation, we need to convert to group chat first
  const isStandard = currentConversation.value.format === 'standard';

  try {
    if (isStandard) {
      // Convert to group chat format
      console.log('[handleAddParticipant] Converting to group chat format');
      
      // Invalidate cache before conversion to ensure fresh data
      participantCache.invalidate(currentConversation.value.id);
      
      // Update format - this will trigger loadParticipants() internally
      await updateConversationSettings({ format: 'prefill' });

      // Load existing participants
      await loadParticipants();
      
      // Get user's first name - safe to use since it's always the same user
      const user = store.state.user;
      const userFirstName = user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'User';
      
      // Check if all assistant messages in the conversation used the same model
      // Note: Message has branches, role/model are on each branch, need to access via activeBranchId
      const visibleMsgs = messages.value;
      const modelsUsed = new Set<string>();
      
      for (const msg of visibleMsgs) {
        const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId);
        if (activeBranch?.role === 'assistant' && activeBranch.model) {
          modelsUsed.add(activeBranch.model);
        }
      }
      
      console.log(`[handleAddParticipant] Models used in visible messages:`, [...modelsUsed]);
      const singleModelUsed = modelsUsed.size === 1;
      
      let assistantName = 'Assistant';
      if (singleModelUsed && modelsUsed.size === 1) {
        const modelId = [...modelsUsed][0];
        const modelData = store.state.models.find(m => m.id === modelId);
        assistantName = modelData?.shortName || modelData?.displayName || 'Assistant';
        console.log(`[handleAddParticipant] All messages from same model: ${modelId} -> "${assistantName}"`);
      } else if (modelsUsed.size > 1) {
        console.log(`[handleAddParticipant] Mixed models used: ${[...modelsUsed].join(', ')} -> keeping "Assistant"`);
      } else if (modelsUsed.size === 0) {
        // No assistant messages yet - use the conversation's model
        const conversationModelId = currentConversation.value.model;
        const modelData = store.state.models.find(m => m.id === conversationModelId);
        assistantName = modelData?.shortName || modelData?.displayName || 'Assistant';
        console.log(`[handleAddParticipant] No messages yet, using conversation model: ${conversationModelId} -> "${assistantName}"`);
      }
      
      // Rename existing participants with generic names and apply validated settings
      for (const p of participants.value) {
        let newName: string | null = null;
        let newSettings: any = null;
        
        if (p.type === 'user' && (p.name === 'H' || p.name === 'User')) {
          newName = userFirstName;
        } else if (p.type === 'assistant' && (p.name === 'A' || p.name === 'Assistant')) {
          newName = assistantName;
          // Also apply validated settings when renaming assistant
          if (p.model) {
            const modelData = store.state.models.find(m => m.id === p.model);
            if (modelData) {
              newSettings = getValidatedModelDefaults(modelData);
            }
          }
        }
        
        if (newName && newName !== p.name) {
          console.log(`[handleAddParticipant] Renaming participant ${p.id} from "${p.name}" to "${newName}"`);
          const updateData: any = { name: newName };
          if (newSettings) {
            updateData.settings = newSettings;
          }
          await api.patch(`/participants/${p.id}`, updateData);
          p.name = newName; // Update local copy
          if (newSettings) {
            p.settings = newSettings;
          }
        }
      }
      
      // Invalidate cache after updates
      participantCache.invalidate(currentConversation.value.id);
      
      // Assign participants to existing messages that don't have participantId
      console.log('[handleAddParticipant] Assigning participants to existing messages');
      await api.post(`/participants/conversation/${currentConversation.value.id}/assign-to-messages`);
    }

    // Handle persona type differently - use persona join API
    if (participant.type === 'persona' && participant.personaId) {
      const persona = personas.value.find(p => p.id === participant.personaId);
      if (!persona) {
        console.error('Persona not found:', participant.personaId);
        return;
      }

      // Get the persona's HEAD branch
      const branchesResponse = await api.get(`/personas/${persona.id}/branches`);
      const headBranch = branchesResponse.data.find((b: any) => b.isHead);
      if (!headBranch) {
        console.error('No HEAD branch found for persona');
        return;
      }

      console.log('[handleAddParticipant] Joining persona to conversation');
      const response = await api.post(`/personas/${persona.id}/join`, {
        conversationId: currentConversation.value.id,
        participantName: persona.name,
        historyBranchId: headBranch.id
      });

      // Add the participant to local list
      participants.value.push(response.data.participant);

      // Set as selected responder
      selectedResponder.value = response.data.participant.id;

      console.log('[handleAddParticipant] Persona joined:', response.data);
    } else {
      // Regular user/assistant participant
      const participantData: any = {
        conversationId: currentConversation.value.id,
        name: participant.name,
        type: participant.type,
        model: participant.model
      };
      
      // Add validated settings for assistant participants
      if (participant.type === 'assistant' && participant.model) {
        const modelData = store.state.models.find(m => m.id === participant.model);
        if (modelData) {
          participantData.settings = getValidatedModelDefaults(modelData);
        }
      }
      
      const response = await api.post('/participants', participantData);
      console.log('[handleAddParticipant] Added participant:', response.data);

      // Invalidate cache and reload to get fresh state from backend
      participantCache.invalidate(currentConversation.value.id);
      await loadParticipants();

      // If it's an assistant, set it as the selected responder
      if (participant.type === 'assistant') {
        selectedResponder.value = response.data.id;
      }
    }
  } catch (error) {
    console.error('Failed to add participant:', error);
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
          existing.conversationMode !== updated.conversationMode ||
          !isEqual(existing.settings, updated.settings) ||
          !isEqual(existing.contextManagement, updated.contextManagement);
        
        console.log(`[updateParticipants] Participant ${existing.name} (${existing.id}):`);
        console.log('  existing.model:', existing.model);
        console.log('  updated.model:', updated.model);
        console.log('  hasChanges:', hasChanges);
        
        if (hasChanges) {
          // Participant was updated - use safeParse to catch validation errors
          const parseResult = UpdateParticipantSchema.safeParse({
            name: updated.name,
            model: updated.model,
            systemPrompt: updated.systemPrompt,
            settings: updated.settings,
            contextManagement: updated.contextManagement,
            conversationMode: updated.conversationMode
          });
          
          if (!parseResult.success) {
            console.error('[updateParticipants] ❌ Schema validation failed for participant:', existing.id);
            console.error('  Validation errors:', parseResult.error.errors);
            console.error('  Input data:', { settings: updated.settings });
            throw new Error(`Participant settings validation failed: ${parseResult.error.errors.map(e => e.message).join(', ')}`);
          }
          
          const updateData = parseResult.data;
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
  } catch (error: any) {
    console.error('Failed to update participants:', error);
    // Show error to user - this is important! Silent failures here cause settings to not be saved
    const errorMessage = error?.response?.data?.error || error?.message || 'Unknown error';
    alert(`Failed to save participant settings: ${errorMessage}\n\nCheck browser console for details.`);
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

function getConversationUnreadCount(conversationId: string): number {
  return store.state.unreadCounts.get(conversationId) || 0;
}

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
/* Unread badges - smaller, consistent style */
.unread-history-badge :deep(.v-badge__badge),
.sidebar-unread-badge :deep(.v-badge__badge) {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  font-size: 10px;
  font-weight: 600;
}

/* Input bar button groups - consistent spacing */
.input-bar-left,
.input-bar-right {
  gap: 4px;
}

/* Ensure icon buttons in input bar are consistent size */
.input-bar-left :deep(.v-btn),
.input-bar-right :deep(.v-btn) {
  min-width: 32px;
  height: 32px;
}

/* Sampling button - ensure consistent sizing whether showing count or not */
.sampling-btn {
  min-width: 32px !important;
  padding: 0 6px !important;
}

.sampling-btn .sampling-count {
  font-size: 11px;
  margin-left: 2px;
  font-weight: 600;
}

/* Send button gets a bit more margin for visual separation */
.input-bar-right :deep(.v-btn.ml-1:last-child) {
  margin-left: 8px !important;
}

/* Force multiline subtitles in content moderation dialog */
.v-dialog :deep(.v-list-item-subtitle) {
  -webkit-line-clamp: unset !important;
  line-clamp: unset !important;
  white-space: normal !important;
  overflow: visible !important;
  display: block !important;
  line-height: 1.4;
}

/* Connection status indicator */
.connection-status-bar {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  background: rgba(255, 152, 0, 0.1);
  border: 1px solid rgba(255, 152, 0, 0.3);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.7);
}

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
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch; /* Smooth scrolling on iOS */
  touch-action: pan-y; /* Allow vertical scrolling immediately */
  overscroll-behavior: contain; /* Prevent scroll chaining to parent */
}

/* Mobile: reduce padding and make messages full-width */
@media (max-width: 768px) {
  .messages-container {
    padding-left: 8px !important;
    padding-right: 8px !important;
    overflow-x: hidden !important;
  }
  
  .messages-container :deep(.message-container) {
    max-width: 100% !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
  }
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

.sidebar-header-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 10px;
}

.sidebar-action-btn {
  min-width: 0 !important;
  padding: 10px 12px !important;
  border-radius: 8px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-size: 0.8rem !important;
  font-weight: 500 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.5px !important;
}

.sidebar-footer-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 10px;
}

.sidebar-footer-btn {
  min-width: 0 !important;
  padding: 10px 12px !important;
  border-radius: 8px !important;
  background: transparent !important;
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
  transition: all 0.15s ease !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

.sidebar-footer-btn:hover {
  background: rgba(255, 255, 255, 0.06) !important;
  border-color: rgba(255, 255, 255, 0.3) !important;
}

.sidebar-footer-btn .text-caption {
  font-size: 0.75rem !important;
  font-weight: 500;
}

/* Compact sidebar list items */
.sidebar-header :deep(.v-list-item) {
  min-height: 36px !important;
  padding-top: 4px !important;
  padding-bottom: 4px !important;
}

.sidebar-header :deep(.v-list-item-title) {
  font-size: 0.875rem !important;
}

.sidebar-conversations :deep(.v-list-item) {
  min-height: 48px !important;
  padding-top: 6px !important;
  padding-bottom: 6px !important;
}

.sidebar-conversations :deep(.v-list-subheader) {
  min-height: 28px !important;
  font-size: 0.7rem !important;
}

.sidebar-overflow-menu .v-list-item {
  min-height: 32px !important;
}

.sidebar-user-item {
  min-height: 48px !important;
  padding: 8px 12px !important;
}

.sidebar-user-item :deep(.v-list-item-title) {
  font-size: 0.875rem !important;
  font-weight: 500;
}

.sidebar-user-item :deep(.v-list-item-subtitle) {
  font-size: 0.75rem !important;
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
  display: none; /* Hidden on mobile to save space */
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

/* Bookmark browser button */
.bookmark-browser-btn {
  opacity: 0.7;
  transition: opacity 0.2s;
}

.bookmark-browser-btn:hover {
  opacity: 1;
}

/* Bookmark browser list */
.bookmark-browser-list {
  max-height: 400px;
  overflow-y: auto;
}

.bookmark-browser-list .meta-text {
  color: rgba(255, 255, 255, 0.5);
}

.bookmark-browser-list .v-list-item {
  border-left: 3px solid transparent;
  transition: border-color 0.2s, background-color 0.2s;
}

.bookmark-browser-list .v-list-item.bookmark-in-path {
  border-left-color: rgb(var(--v-theme-primary));
  background-color: rgba(var(--v-theme-primary), 0.08);
}

.bookmark-browser-list .v-list-item:hover {
  background-color: rgba(255, 255, 255, 0.08);
}

/* Bookmark preview text */
.bookmark-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.7;
  line-height: 1.4;
}

/* Drop zone styles for drag-and-drop attachments */
.input-drop-zone {
  position: relative;
  width: 100%;
}

/* Visual feedback when dragging over is handled by nested :deep selector below */

.input-drop-zone.drop-zone-active :deep(.v-field) {
  border-color: rgb(var(--v-theme-primary)) !important;
  border-width: 2px !important;
  background-color: rgba(var(--v-theme-primary), 0.05) !important;
}

.drop-zone-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(var(--v-theme-primary), 0.1);
  border: 2px dashed rgb(var(--v-theme-primary));
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10;
  pointer-events: none;
}

/* Message highlight animation for event history navigation */
.highlight-flash {
  animation: highlightPulse 1.5s ease-out;
}

@keyframes highlightPulse {
  0% {
    background-color: rgba(var(--v-theme-primary), 0.3);
    box-shadow: 0 0 20px rgba(var(--v-theme-primary), 0.5);
  }
  100% {
    background-color: transparent;
    box-shadow: none;
  }
}

/* Stuck button animation is now inline in MessageComponent */

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
