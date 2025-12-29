<template>
  <!-- Post-hoc operation messages render as compact inline markers -->
  <div
    v-if="isPostHocOperation"
    class="post-hoc-operation-marker"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <v-icon
      :icon="postHocOperationIcon"
      size="small"
      class="mr-2"
      color="warning"
    />
    <span class="text-caption">{{ currentBranch.content }}</span>
    <v-btn
      v-if="isHovered"
      icon="mdi-close"
      size="x-small"
      variant="text"
      density="compact"
      color="error"
      class="ml-2"
      title="Remove this operation"
      @click="$emit('delete-post-hoc-operation', message.id)"
    />
  </div>

  <!-- Regular messages -->
  <div
    v-else
    ref="messageCard"
    :class="[
      'message-container',
      message.branches[branchIndex].role === 'user' ? 'user-message' : 'assistant-message',
      isSelectedParent ? 'selected-parent' : '',
      postHocAffected?.hidden ? 'post-hoc-hidden' : '',
      postHocAffected?.edited ? 'post-hoc-edited' : '',
      (isHovered || touchActionsOpen) ? 'action-bar-visible' : '',
      isHumanWrittenAI ? 'human-written-ai' : ''
    ]"
    :style="{
      borderLeft: isSelectedParent ? '3px solid rgb(var(--v-theme-info))' : undefined,
      position: 'relative'
    }"
    @mouseenter="isHovered = true"
    @mouseleave="handleMouseLeave"
  >
    <!-- Authenticity Icon - positioned top right -->
    <div v-if="authenticityLevel" class="authenticity-corner-wrapper">
      <AuthenticityIcon 
        :level="authenticityLevel" 
        :size="14"
      />
    </div>
    
    <!-- Action bar - appears on hover (desktop) or tap (mobile), positioned at bottom -->
    <div 
      v-if="(isHovered || moreMenuOpen || touchActionsOpen) && !isEditing && !isStreaming" 
      class="action-bar"
    >
      <!-- Branch navigation (if multiple siblings) -->
      <template v-if="hasNavigableBranches">
        <v-btn icon="mdi-chevron-left" size="x-small" variant="text" density="compact" :disabled="siblingIndex === 0" @click="navigateBranch(-1)" />
        <span class="text-caption meta-text branch-counter">{{ siblingIndex + 1 }}/{{ siblingBranches.length }}</span>
        <v-btn icon="mdi-chevron-right" size="x-small" variant="text" density="compact" :disabled="siblingIndex === siblingBranches.length - 1" @click="navigateBranch(1)" />
        <v-divider vertical class="mx-1" style="height: 16px; opacity: 0.3;" />
      </template>
      
      <!-- Primary actions -->
      <span v-if="message.branches[branchIndex].role === 'assistant'" class="hover-tooltip" data-tooltip="Regenerate">
        <v-btn
          icon="mdi-refresh"
          size="x-small"
          variant="text"
          density="compact"
          @click="$emit('regenerate', message.id, currentBranch.id)"
        />
      </span>
      <span class="hover-tooltip" data-tooltip="Edit and Branch">
        <v-btn
          icon="mdi-pencil"
          size="x-small"
          variant="text"
          density="compact"
          @click="startEdit"
        />
      </span>
      <span class="hover-tooltip" data-tooltip="Copy">
        <v-btn
          icon="mdi-content-copy"
          size="x-small"
          variant="text"
          density="compact"
          @click="copyContent"
        />
      </span>
      <span v-if="!isLastMessage" class="hover-tooltip" data-tooltip="Branch Mode">
        <v-btn
          :icon="isSelectedParent ? 'mdi-source-branch-check' : 'mdi-source-branch'"
          :color="isSelectedParent ? 'info' : undefined"
          size="x-small"
          variant="text"
          density="compact"
          @click="$emit('select-as-parent', message.id, currentBranch.id)"
        />
      </span>
      <span class="hover-tooltip" data-tooltip="Bookmark">
        <v-btn
          ref="bookmarkButtonRef"
          :icon="hasBookmark ? 'mdi-bookmark' : 'mdi-bookmark-outline'"
          :color="hasBookmark ? participantColor : undefined"
          size="x-small"
          variant="text"
          density="compact"
          @click="toggleBookmark"
        />
      </span>
      
      <v-divider vertical class="mx-1" style="height: 16px; opacity: 0.3;" />
      
      <span class="hover-tooltip" data-tooltip="Delete">
        <v-btn
          icon="mdi-delete-outline"
          size="x-small"
          variant="text"
          density="compact"
          color="error"
          @click="$emit('delete', message.id, currentBranch.id)"
        />
      </span>
      
      <!-- More actions menu -->
      <div class="more-menu-wrapper" @mouseenter.stop @mouseleave.stop>
        <v-menu 
          v-model="moreMenuOpen"
          location="bottom" 
          :offset="8"
          :close-on-content-click="true"
        >
          <template v-slot:activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-dots-horizontal"
              size="x-small"
              variant="text"
              density="compact"
              title="More actions"
            />
          </template>
          <v-list 
            density="compact" 
            class="more-menu py-0" 
            min-width="140"
          >
          <v-list-item density="compact" @click="isMonospace = !isMonospace">
            <template v-slot:prepend>
              <v-icon size="16" icon="mdi-code-tags" />
            </template>
            <v-list-item-title class="text-caption">{{ isMonospace ? 'Normal text' : 'Monospace' }}</v-list-item-title>
            <template v-slot:append>
              <v-icon v-if="isMonospace" icon="mdi-check" size="14" color="info" />
            </template>
          </v-list-item>
          <v-list-item density="compact" @click="saveAsImage">
            <template v-slot:prepend>
              <v-icon size="16" icon="mdi-camera" />
            </template>
            <v-list-item-title class="text-caption">Save as image</v-list-item-title>
          </v-list-item>
          <v-list-item density="compact" @click="downloadPrompt">
            <template v-slot:prepend>
              <v-icon size="16" icon="mdi-code-json" />
            </template>
            <v-list-item-title class="text-caption">Download JSON</v-list-item-title>
          </v-list-item>
          <v-divider v-if="(message.branches[branchIndex].role === 'assistant' && (currentBranch.debugRequest || currentBranch.debugResponse)) || canViewMetadata" class="my-0" />
          <v-list-item
            v-if="message.branches[branchIndex].role === 'assistant' && (currentBranch.debugRequest || currentBranch.debugResponse)"
            density="compact"
            @click="showDebugDialog = true"
          >
            <template v-slot:prepend>
              <v-icon size="16" icon="mdi-bug" />
            </template>
            <v-list-item-title class="text-caption">Debug data</v-list-item-title>
          </v-list-item>
          <v-list-item v-if="canViewMetadata" density="compact" @click="showMetadataDialog = true">
            <template v-slot:prepend>
              <v-icon size="16" icon="mdi-information-outline" />
            </template>
            <v-list-item-title class="text-caption">Metadata</v-list-item-title>
          </v-list-item>
          <!-- Post-hoc context operations in menu -->
          <template v-if="!isPostHocOperation">
            <v-divider class="my-0" />
            <v-list-item v-if="postHocAffected?.hidden" density="compact" @click="$emit('post-hoc-unhide', message.id, currentBranch.id)">
              <template v-slot:prepend>
                <v-icon size="16" icon="mdi-eye-outline" color="success" />
              </template>
              <v-list-item-title class="text-caption">Unhide from AI</v-list-item-title>
            </v-list-item>
            <v-list-item v-else density="compact" @click="$emit('post-hoc-hide', message.id, currentBranch.id)">
              <template v-slot:prepend>
                <v-icon size="16" icon="mdi-eye-off-outline" />
              </template>
              <v-list-item-title class="text-caption">Hide from AI</v-list-item-title>
            </v-list-item>
            <v-list-item density="compact" @click="startPostHocEdit">
              <template v-slot:prepend>
                <v-icon size="16" icon="mdi-pencil-off-outline" />
              </template>
              <v-list-item-title class="text-caption">Edit in place</v-list-item-title>
            </v-list-item>
            <v-list-item density="compact" @click="$emit('post-hoc-hide-before', message.id, currentBranch.id)">
              <template v-slot:prepend>
                <v-icon size="16" icon="mdi-arrow-collapse-up" />
              </template>
              <v-list-item-title class="text-caption">Hide all before</v-list-item-title>
            </v-list-item>
          </template>
          <v-divider class="my-0" />
          <v-list-item v-if="message.branches.length > 1" density="compact" @click="$emit('delete-all-branches', message.id)">
            <template v-slot:prepend>
              <v-icon size="16" icon="mdi-delete-sweep-outline" color="error" />
            </template>
            <v-list-item-title class="text-caption">Delete all branches</v-list-item-title>
          </v-list-item>
        </v-list>
        </v-menu>
      </div>
      
      <!-- Close button for touch devices (inside hover bar) -->
      <v-btn
        v-if="isTouchDevice"
        icon="mdi-close"
        size="x-small"
        variant="text"
        density="compact"
        class="ml-1"
        @click.stop.prevent="touchActionsOpen = false"
        @touchend.stop.prevent="touchActionsOpen = false"
      />
    </div>

    <!-- Branch navigation (separate row on narrow, inline on wide) -->
    <div v-if="hasNavigableBranches" class="branch-nav-row d-flex align-center justify-center">
      <v-btn icon="mdi-chevron-left" size="x-small" variant="text" density="compact" :disabled="siblingIndex === 0" @click="navigateBranch(-1)" />
      <span class="text-caption meta-text">{{ siblingIndex + 1 }} / {{ siblingBranches.length }}</span>
      <v-btn icon="mdi-chevron-right" size="x-small" variant="text" density="compact" :disabled="siblingIndex === siblingBranches.length - 1" @click="navigateBranch(1)" />
    </div>

    <!-- Info line -->
    <div class="info-row">
      <!-- Left: name + meta -->
      <div class="d-flex align-center flex-wrap" style="gap: 4px;">
        <!-- Avatar or fallback icon -->
        <v-avatar 
          v-if="avatarUrl" 
          size="32" 
          class="message-avatar clickable-avatar"
          @click="showAvatarPreview = true"
        >
          <v-img :src="avatarUrl" :alt="participantDisplayName || 'Avatar'" />
        </v-avatar>
        <v-icon
          v-else
          :icon="message.branches[branchIndex].role === 'user' ? 'mdi-account' : 'mdi-robot'"
          :color="participantColor"
          size="small"
        />
        <!-- Show participant name: colored/bold for real names, gray for (continue) -->
        <span v-if="participantDisplayName && participantDisplayName !== '(continue)'" class="message-name font-weight-medium" :style="participantColor ? `color: ${participantColor};` : ''">
          {{ participantDisplayName }}
        </span>
        <span v-else-if="participantDisplayName === '(continue)'" class="text-caption meta-text">
          (continue)
        </span>
        <!-- Only show sender attribution for user messages (not AI) since sentByUserId on AI means "triggered by" not "authored by" -->
        <span v-if="currentBranch.role === 'user' && senderDisplayName && senderDisplayName !== participantDisplayName" class="text-caption meta-text">
          ({{ senderDisplayName }})
        </span>
        <span v-if="modelIndicator" class="text-caption meta-text">
          {{ modelIndicator }}
        </span>
        <span v-if="currentBranch?.createdAt" class="text-caption meta-text">
          {{ formatTimestamp(currentBranch.createdAt) }}
        </span>
        
        
        <!-- Human-written AI plaque -->
        <v-chip 
          v-if="isHumanWrittenAI" 
          size="x-small" 
          color="pink" 
          variant="tonal" 
          density="compact"
          class="ml-1"
        >
          <v-icon size="x-small" start>mdi-account-edit</v-icon>
          Human-written
        </v-chip>
        
        <!-- Badges -->
        <v-chip v-if="currentBranch?.hiddenFromAi" size="x-small" color="warning" variant="tonal" density="compact">
          <v-icon size="x-small" start>mdi-eye-off</v-icon>
          Hidden
        </v-chip>
        <v-chip v-if="postHocAffected?.hidden" size="x-small" color="grey" variant="tonal" density="compact" class="mr-1">
          <v-icon size="x-small" start>mdi-eye-off</v-icon>
          Hidden from AI
        </v-chip>
        <v-btn 
          v-if="postHocAffected?.hidden" 
          size="x-small" 
          variant="text" 
          density="compact"
          title="Unhide this message for future AI context"
          @click="$emit('post-hoc-unhide', message.id, currentBranch.id)"
        >
          <v-icon size="x-small">mdi-eye</v-icon>
          Unhide
        </v-btn>
        <v-menu v-if="postHocAffected?.edited" location="bottom" :close-on-content-click="false">
          <template v-slot:activator="{ props }">
            <v-chip v-bind="props" size="x-small" color="info" variant="tonal" density="compact" style="cursor: pointer;">
              <v-icon size="x-small" start>mdi-pencil</v-icon>
              Edited for AI
              <v-icon size="x-small" end>mdi-chevron-down</v-icon>
            </v-chip>
          </template>
          <v-card max-width="400" class="pa-2">
            <div class="text-caption font-weight-bold mb-1">Original content:</div>
            <div class="text-caption text-grey-lighten-1 mb-2" style="white-space: pre-wrap; max-height: 100px; overflow-y: auto;">
              {{ truncateText(postHocAffected.originalContent || '', 200) }}
            </div>
            <v-divider class="my-2" />
            <div class="text-caption font-weight-bold mb-1">AI will see:</div>
            <div class="text-caption" style="white-space: pre-wrap; max-height: 100px; overflow-y: auto;">
              {{ truncateText(postHocAffected.editedContent || '', 200) }}
            </div>
          </v-card>
        </v-menu>
        <v-chip v-if="hasBookmark" size="x-small" :color="participantColor" variant="tonal" density="compact">
          <v-icon size="x-small" start>mdi-bookmark</v-icon>
          {{ bookmarkLabel }}
        </v-chip>
      </div>
      
      <!-- Center: Branch navigation (desktop only) -->
      <div v-if="hasNavigableBranches" class="branch-nav-inline d-flex align-center justify-center">
        <v-btn icon="mdi-chevron-left" size="x-small" variant="text" density="compact" :disabled="siblingIndex === 0" @click="navigateBranch(-1)" />
        <span class="text-caption meta-text">{{ siblingIndex + 1 }} / {{ siblingBranches.length }}</span>
        <v-btn icon="mdi-chevron-right" size="x-small" variant="text" density="compact" :disabled="siblingIndex === siblingBranches.length - 1" @click="navigateBranch(1)" />
      </div>
      <div v-else class="branch-nav-inline"></div>
      
      <!-- Right: empty for balance (desktop) -->
      <div class="branch-nav-inline"></div>
    </div>
    
    <!-- Touch action toggle button - fixed in corner on mobile (only show when bar is closed) -->
    <v-btn
      v-if="isTouchDevice && !isEditing && !isStreaming && !touchActionsOpen"
      icon="mdi-dots-horizontal"
      size="x-small"
      variant="text"
      density="compact"
      class="touch-toggle-btn"
      @click="toggleTouchActions"
    />
      
      <!-- Thinking blocks (if present) -->
      <div v-if="thinkingBlocks.length > 0 && !isEditing" class="thinking-section mb-1">
        <v-expansion-panels v-model="thinkingPanelOpen" variant="accordion">
          <v-expansion-panel v-for="(block, index) in thinkingBlocks" :key="index" :value="index">
            <v-expansion-panel-title>
              <v-icon size="small" class="mr-2">mdi-thought-bubble</v-icon>
              <span class="text-caption">
                {{ block.type === 'redacted_thinking' ? 'Thinking (Redacted)' : 'Thinking' }}
                <span v-if="isThinkingStreaming" class="ml-2 text-grey">(streaming...)</span>
              </span>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <div v-if="block.type === 'thinking'" class="thinking-content text-caption">
                <pre style="white-space: pre-wrap; font-family: inherit;">{{ block.thinking }}</pre>
              </div>
              <div v-else-if="block.type === 'redacted_thinking'" class="text-caption text-grey">
                <em>This thinking content has been redacted for safety reasons.</em>
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </div>
      
      <!-- Message content or edit mode -->
      <div 
        v-if="!isEditing" 
        :class="['message-content', { 'monospace-mode': isMonospace }]" 
        v-html="renderedContent"
        @contextmenu="handleContentContextMenu"
      />
      <v-textarea
        v-else
        v-model="editContent"
        auto-grow
        variant="outlined"
        density="compact"
        hide-details
        class="mb-2"
      />
      
      <!-- Context menu for split - teleported to body to avoid transform issues -->
      <Teleport to="body">
        <div 
          v-if="showSplitContextMenu" 
          class="split-context-menu"
          :style="{ left: splitMenuPosition.x + 'px', top: splitMenuPosition.y + 'px' }"
        >
          <v-card elevation="8" class="pa-0">
            <v-list density="compact" class="pa-0">
              <v-list-item @click="splitAtContextPosition" density="compact">
                <template v-slot:prepend>
                  <v-icon size="16" icon="mdi-content-cut" />
                </template>
                <v-list-item-title class="text-caption">Split here</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-card>
        </div>
      </Teleport>
      
      <!-- Generated images (from model output) -->
      <div v-if="imageBlocks.length > 0" class="generated-images mt-3">
        <div v-for="(block, index) in imageBlocks" :key="'img-' + index" class="generated-image-container mb-2">
          <img 
            :src="`data:${(block as any).mimeType || 'image/png'};base64,${(block as any).data}`"
            :alt="(block as any).revisedPrompt || 'Generated image'"
            class="generated-image"
            style="max-width: 100%; max-height: 600px; border-radius: 8px; cursor: pointer;"
            @click="openImagePreview(block)"
          />
          <div v-if="(block as any).revisedPrompt" class="text-caption text-grey mt-1">
            {{ (block as any).revisedPrompt }}
          </div>
        </div>
      </div>
      
      <!-- Attachments display (for user messages) -->
      <div v-if="currentBranch.role === 'user' && currentBranch.attachments && currentBranch.attachments.length > 0" class="mt-2">
        <template v-for="attachment in currentBranch.attachments" :key="attachment.id">
          <!-- Image attachments -->
          <div v-if="isImageAttachment(attachment)" class="mb-2">
            <img 
              :src="getImageSrc(attachment)"
              :alt="attachment.fileName"
              style="max-width: 300px; max-height: 300px; border-radius: 8px; cursor: pointer;"
              @click="openImageInNewTab(attachment)"
            />
            <div class="text-caption mt-1">{{ attachment.fileName }} ({{ formatFileSize(attachment.fileSize || 0) }})</div>
          </div>
          <!-- Text attachments -->
          <v-chip
            v-else
            class="mr-2 mb-1"
            size="small"
            color="grey-lighten-2"
          >
            <v-icon start size="x-small">mdi-paperclip</v-icon>
            {{ attachment.fileName }}
            <span class="ml-1 text-caption">({{ formatFileSize(attachment.fileSize || 0) }})</span>
          </v-chip>
        </template>
      </div>
      
      <div v-if="isEditing" class="d-flex gap-2 mt-2">
        <v-btn
          size="small"
          :color="isPostHocEditing ? 'info' : 'primary'"
          @click="saveEdit"
        >
          {{ isPostHocEditing ? 'Save for AI' : 'Save & Regenerate' }}
        </v-btn>
        <v-btn
          v-if="!isPostHocEditing"
          size="small"
          variant="outlined"
          @click="saveEditOnly"
        >
          Save
        </v-btn>
        <v-btn
          size="small"
          variant="text"
          @click="cancelEdit"
        >
          Cancel
        </v-btn>
      </div>
      
      <!-- Generating indicator or error indicator -->
      <div v-if="hasError && currentBranch.role === 'assistant'" class="error-indicator mt-3">
        <div class="error-box">
          <div class="error-header">
            <v-icon size="small" color="error" class="mr-2">mdi-alert-circle</v-icon>
            <span class="error-title">Error</span>
          </div>
          <div class="error-message">
            {{ errorMessage || 'Failed to generate response' }}
          </div>
          <div v-if="errorSuggestion" class="error-suggestion">
            💡 {{ errorSuggestion }}
          </div>
        </div>
      </div>
      <div v-else-if="isStreaming && currentBranch.role === 'assistant'" class="generating-indicator mt-1 d-flex align-center gap-2">
        <v-chip 
          size="x-small" 
          :color="participantColor || 'grey'"
          variant="tonal"
        >
          <v-progress-circular
            indeterminate
            size="12"
            width="2"
            class="mr-1"
            :color="participantColor || 'grey'"
          />
          Generating...
        </v-chip>
        <v-btn
          v-if="showStuckButton"
          size="x-small"
          color="warning"
          variant="tonal"
          @click="emit('stuck-clicked')"
        >
          <v-icon start size="14">mdi-help-circle</v-icon>
          Stuck?
        </v-btn>
      </div>

    <!-- Bookmark dialog -->
    <v-dialog v-model="bookmarkDialog" max-width="400">
      <v-card>
        <v-card-title>{{ hasBookmark ? 'Edit Bookmark' : 'Add Bookmark' }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="bookmarkInput"
            label="Bookmark label"
            placeholder="Enter a label for this message..."
            variant="outlined"
            density="compact"
            autofocus
            @keydown.enter="saveBookmark"
          />
        </v-card-text>
        <v-card-actions>
          <v-btn
            v-if="hasBookmark"
            color="error"
            variant="text"
            @click="deleteBookmark"
          >
            Delete
          </v-btn>
          <v-spacer />
          <v-btn @click="bookmarkDialog = false">Cancel</v-btn>
          <v-btn
            color="primary"
            @click="saveBookmark"
            :disabled="!bookmarkInput.trim()"
          >
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    
    <!-- Image Preview Dialog -->
    <v-dialog v-model="imagePreviewDialog" max-width="90vw">
      <v-card class="pa-2" style="background: rgba(0,0,0,0.9);">
        <v-card-text class="pa-0 text-center">
          <img
            :src="previewImageSrc"
            :alt="previewImageAlt"
            style="max-width: 100%; max-height: 85vh; object-fit: contain;"
          />
        </v-card-text>
        <v-card-actions v-if="previewImageAlt" class="justify-center">
          <span class="text-caption text-grey">{{ previewImageAlt }}</span>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Debug Dialog -->
    <DebugMessageDialog
      v-model="showDebugDialog"
      :debug-request="currentBranch.debugRequest"
      :debug-response="currentBranch.debugResponse"
    />
    
    
    <!-- Metadata Dialog (for researchers/admins) -->
    <v-dialog v-model="showMetadataDialog" max-width="800">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon class="mr-2">mdi-information-outline</v-icon>
          Message Metadata
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" size="small" @click="showMetadataDialog = false" />
        </v-card-title>
        <v-card-text>
          <div class="mb-4">
            <h4 class="text-subtitle-1 mb-2">Message</h4>
            <v-table density="compact">
              <tbody>
                <tr>
                  <td class="font-weight-medium" style="width: 180px;">Message ID</td>
                  <td><code>{{ message.id }}</code></td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Conversation ID</td>
                  <td><code>{{ message.conversationId }}</code></td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Active Branch ID</td>
                  <td><code>{{ message.activeBranchId }}</code></td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Order</td>
                  <td>{{ message.order }}</td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Created At</td>
                  <td>{{ new Date(message.createdAt).toLocaleString() }}</td>
                </tr>
              </tbody>
            </v-table>
          </div>
          
          <div class="mb-4">
            <h4 class="text-subtitle-1 mb-2">Current Branch ({{ branchIndex + 1 }} of {{ message.branches.length }})</h4>
            <v-table density="compact">
              <tbody>
                <tr>
                  <td class="font-weight-medium" style="width: 180px;">Branch ID</td>
                  <td><code>{{ currentBranch.id }}</code></td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Role</td>
                  <td>{{ currentBranch.role }}</td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Parent Branch ID</td>
                  <td><code>{{ currentBranch.parentBranchId || 'root' }}</code></td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Model</td>
                  <td>
                    <template v-if="currentBranchModelDetails">
                      <div>{{ currentBranchModelDetails.displayName }}</div>
                      <div class="text-caption text-grey">
                        <code>{{ currentBranchModelDetails.providerModelId }}</code>
                        <span v-if="currentBranchModelDetails.isCustom" class="ml-1">(custom)</span>
                      </div>
                    </template>
                    <template v-else>
                      {{ currentBranch.model || 'N/A' }}
                    </template>
                  </td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Internal Model ID</td>
                  <td><code>{{ currentBranch.model || 'N/A' }}</code></td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Participant ID</td>
                  <td><code>{{ currentBranch.participantId || 'N/A' }}</code></td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Sent By User</td>
                  <td><code>{{ currentBranch.sentByUserId || 'N/A' }}</code></td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Content Length</td>
                  <td>{{ currentBranch.content?.length || 0 }} chars</td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Content Blocks</td>
                  <td>{{ currentBranch.contentBlocks?.length || 0 }}</td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Has Debug Request</td>
                  <td>{{ !!currentBranch.debugRequest }}</td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Has Debug Response</td>
                  <td>{{ !!currentBranch.debugResponse }}</td>
                </tr>
                <tr>
                  <td class="font-weight-medium">Created At</td>
                  <td>{{ currentBranch.createdAt ? new Date(currentBranch.createdAt).toLocaleString() : 'N/A' }}</td>
                </tr>
              </tbody>
            </v-table>
          </div>
          
          <div v-if="message.branches.length > 1" class="mb-4">
            <h4 class="text-subtitle-1 mb-2">All Branches ({{ message.branches.length }})</h4>
            <v-expansion-panels variant="accordion" density="compact">
              <v-expansion-panel v-for="(branch, idx) in message.branches" :key="branch.id">
                <v-expansion-panel-title>
                  <span :class="{ 'font-weight-bold': branch.id === message.activeBranchId }">
                    Branch {{ idx + 1 }}: {{ branch.role }}
                    <span v-if="branch.id === message.activeBranchId" class="text-success ml-2">(active)</span>
                  </span>
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <v-table density="compact">
                    <tbody>
                      <tr>
                        <td class="font-weight-medium" style="width: 180px;">Branch ID</td>
                        <td><code>{{ branch.id }}</code></td>
                      </tr>
                      <tr>
                        <td class="font-weight-medium">Parent Branch ID</td>
                        <td><code>{{ branch.parentBranchId || 'root' }}</code></td>
                      </tr>
                      <tr>
                        <td class="font-weight-medium">Model</td>
                        <td>
                          <template v-if="getModelDetails(branch.model)">
                            {{ getModelDetails(branch.model)?.displayName }}
                            <div class="text-caption text-grey">
                              <code>{{ getModelDetails(branch.model)?.providerModelId }}</code>
                            </div>
                          </template>
                          <template v-else>
                            {{ branch.model || 'N/A' }}
                          </template>
                        </td>
                      </tr>
                      <tr>
                        <td class="font-weight-medium">Has Debug Data</td>
                        <td>{{ !!branch.debugRequest || !!branch.debugResponse }}</td>
                      </tr>
                    </tbody>
                  </v-table>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </div>
          
          <div v-if="currentBranch.debugRequest" class="mb-4">
            <h4 class="text-subtitle-1 mb-2">Debug Request</h4>
            <pre class="debug-json pa-2 rounded" style="max-height: 300px; overflow: auto; font-size: 11px;">{{ JSON.stringify(currentBranch.debugRequest, null, 2) }}</pre>
          </div>
          
          <div v-if="currentBranch.debugResponse" class="mb-4">
            <h4 class="text-subtitle-1 mb-2">Debug Response</h4>
            <pre class="debug-json pa-2 rounded" style="max-height: 200px; overflow: auto; font-size: 11px;">{{ JSON.stringify(currentBranch.debugResponse, null, 2) }}</pre>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-btn
            variant="text"
            size="small"
            @click="copyMetadataToClipboard"
          >
            <v-icon start>mdi-content-copy</v-icon>
            Copy All
          </v-btn>
          <v-spacer />
          <v-btn variant="text" @click="showMetadataDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    
    <!-- Avatar Preview Dialog -->
    <v-dialog v-model="showAvatarPreview" max-width="400">
      <v-card>
        <v-card-title class="d-flex align-center">
          <div>
            <div :style="participantColor ? `color: ${participantColor};` : ''">
              {{ avatarPreviewName }}
            </div>
            <div v-if="avatarPreviewModelId" class="text-caption text-grey" style="font-family: monospace;">
              {{ avatarPreviewModelId }}
            </div>
          </div>
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" size="small" @click="showAvatarPreview = false" />
        </v-card-title>
        <v-card-text class="text-center pa-6">
          <v-img 
            :src="avatarUrl" 
            max-height="300"
            contain
            class="mx-auto rounded-lg"
          />
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, onUpdated, watch } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Message, Participant } from '@deprecated-claude/shared';
import { renderLatex, KATEX_ALLOWED_TAGS, KATEX_ALLOWED_ATTRS } from '@/utils/latex';
import { api } from '@/services/api';
import { useStore } from '@/store';
import { getParticipantAvatarUrl, loadAvatarPacks } from '@/utils/avatars';
import DebugMessageDialog from './DebugMessageDialog.vue';
import AuthenticityIcon from './AuthenticityIcon.vue';
import { getAuthenticityLevel } from '@/utils/authenticity';
import { getParticipantDisplayName, resolveParticipantColor } from '@/utils/participant-display';
import 'katex/dist/katex.min.css'; // KaTeX styles

const store = useStore();

import type { AuthenticityStatus as AuthStatus } from '@/utils/authenticity';

const props = defineProps<{
  message: Message;
  participants?: Participant[];
  isSelectedParent?: boolean;
  isLastMessage?: boolean;
  isStreaming?: boolean;
  hasError?: boolean;
  errorMessage?: string;
  errorSuggestion?: string;
  postHocAffected?: { hidden: boolean; edited: boolean; editedContent?: string; originalContent?: string; hiddenAttachments: number[] };
  showStuckButton?: boolean;
  authenticityStatus?: AuthStatus;
}>();

const emit = defineEmits<{
  regenerate: [messageId: string, branchId: string];
  edit: [messageId: string, branchId: string, content: string];
  'edit-only': [messageId: string, branchId: string, content: string];  // Edit and branch without regeneration
  'switch-branch': [messageId: string, branchId: string];
  delete: [messageId: string, branchId: string];
  'delete-all-branches': [messageId: string];
  'select-as-parent': [messageId: string, branchId: string];
  'stop-auto-scroll': [];
  'stuck-clicked': [];
  'bookmark-changed': [];
  'post-hoc-hide': [messageId: string, branchId: string];
  'post-hoc-edit': [messageId: string, branchId: string];
  'post-hoc-edit-content': [messageId: string, branchId: string, content: string];
  'post-hoc-hide-before': [messageId: string, branchId: string];
  'post-hoc-unhide': [messageId: string, branchId: string];
  'delete-post-hoc-operation': [messageId: string];
  'split': [messageId: string, branchId: string, splitPosition: number];
}>();

const isEditing = ref(false);
const isPostHocEditing = ref(false); // True when editing for post-hoc operation (no regeneration)
const editContent = ref('');
const messageCard = ref<HTMLElement>();
const showScrollToTop = ref(false);
const isHovered = ref(false);
const isMonospace = ref(false); // Toggle monospace display for entire message
const moreMenuOpen = ref(false); // Track more menu state for debugging
const isTouchDevice = ref(false); // Detect touch devices to disable hover bar
const touchActionsOpen = ref(false); // Toggle for action bar on touch devices
const isSplitting = ref(false); // True when in split mode (deprecated - using context menu now)
const splitPosition = ref(0); // Position to split at (character index)
const showSplitContextMenu = ref(false); // Context menu visibility
const splitMenuPosition = ref({ x: 0, y: 0 }); // Position for context menu
const contextSplitPosition = ref(0); // Position determined from context menu click
const splitMenuCloseHandler = ref<((e: MouseEvent) => void) | null>(null); // Track close handler for cleanup

// Detect touch device on mount - use multiple detection methods for reliability
onMounted(() => {
  isTouchDevice.value = 
    'ontouchstart' in window || 
    navigator.maxTouchPoints > 0 ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
});

onUnmounted(() => {
  // Clean up split menu handler
  if (splitMenuCloseHandler.value) {
    document.removeEventListener('click', splitMenuCloseHandler.value);
    document.removeEventListener('contextmenu', splitMenuCloseHandler.value);
  }
});

// Toggle action bar on touch devices
function toggleTouchActions() {
  touchActionsOpen.value = !touchActionsOpen.value;
}

// Close touch actions when clicking outside
function handleClickOutside(event: MouseEvent) {
  if (!touchActionsOpen.value) return;
  
  const target = event.target as HTMLElement;
  const card = messageCard.value;
  
  // If click is outside this message card, close the actions
  if (card && !card.contains(target)) {
    touchActionsOpen.value = false;
  }
}

// Add/remove click outside listener
watch(touchActionsOpen, (isOpen) => {
  if (isOpen) {
    // Delay to avoid immediate close from the toggle click
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 10);
  } else {
    document.removeEventListener('click', handleClickOutside);
  }
});
const bookmarkDialog = ref(false);
const bookmarkInput = ref('');
const bookmarkLabel = ref<string | null>(null);
const showBookmarkTooltip = ref(false);
const bookmarkButtonRef = ref<HTMLElement>();
const imagePreviewDialog = ref(false);
const previewImageSrc = ref('');
const previewImageAlt = ref('');
const showDebugDialog = ref(false);
const showMetadataDialog = ref(false);
const showAvatarPreview = ref(false);

// Check if user is researcher or admin (can see metadata)
const canViewMetadata = computed(() => {
  const summary = store.state.grantSummary;
  if (!summary?.grantCapabilities) return false;
  
  // Check for researcher or admin capability
  for (const cap of ['researcher', 'admin']) {
    const records = summary.grantCapabilities.filter((c: any) => c.capability === cap);
    if (records.length > 0) {
      const latest = records.reduce((a: any, b: any) => (a.time > b.time ? a : b));
      if (latest.action === 'granted') return true;
    }
  }
  return false;
});

const branchIndex = computed(() => {
  // Use effective branch ID (local selection if detached, else server's activeBranchId)
  const effectiveBranchId = store.getEffectiveBranchId(props.message);
  return props.message.branches.findIndex(b => b.id === effectiveBranchId) || 0;
});

const currentBranch = computed(() => {
  const branch = props.message.branches[branchIndex.value];
  return branch;
});

// Check if this message is a post-hoc operation
const isPostHocOperation = computed(() => {
  return !!currentBranch.value?.postHocOperation;
});

// Truncate text for display
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

// Get icon for post-hoc operation type
const postHocOperationIcon = computed(() => {
  const op = currentBranch.value?.postHocOperation;
  if (!op) return 'mdi-help';
  switch (op.type) {
    case 'hide': return 'mdi-eye-off';
    case 'hide_before': return 'mdi-arrow-collapse-up';
    case 'edit': return 'mdi-pencil';
    case 'hide_attachment': return 'mdi-paperclip-off';
    case 'unhide': return 'mdi-eye';
    default: return 'mdi-help';
  }
});

// Look up model details from store
function getModelDetails(modelId: string | undefined) {
  if (!modelId) return null;
  
  // Check standard models
  const standardModel = store.state.models.find(m => m.id === modelId);
  if (standardModel) {
    return {
      displayName: standardModel.displayName || standardModel.shortName || modelId,
      providerModelId: standardModel.providerModelId,
      provider: standardModel.provider,
      isCustom: false
    };
  }
  
  // Check custom models
  const customModel = store.state.customModels?.find(m => m.id === modelId);
  if (customModel) {
    return {
      displayName: customModel.displayName || modelId,
      providerModelId: customModel.providerModelId,
      provider: customModel.provider,
      isCustom: true
    };
  }
  
  return null;
}

const currentBranchModelDetails = computed(() => {
  return getModelDetails(currentBranch.value?.model);
});

// Get sender display name for multiuser attribution
const senderDisplayName = computed(() => {
  const sentByUserId = currentBranch.value?.sentByUserId;
  if (!sentByUserId) return null;
  
  // Check if current user is the sender
  if (store.state.user?.id === sentByUserId) {
    return 'you';
  }
  
  // For now, just show a shortened version of the user ID
  // In the future, we could look up user names from a user cache
  return sentByUserId.substring(0, 8);
});

const hasBookmark = computed(() => {
  return bookmarkLabel.value !== null && bookmarkLabel.value !== '';
});

// Check if message is long enough to need scroll button
onMounted(async () => {
  checkMessageHeight();
  await loadBookmark();
  // Load avatar packs (cached, only loads once)
  await loadAvatarPacks();
});

onUpdated(() => {
  checkMessageHeight();
});

// Also check height when streaming status changes or content updates
watch(() => props.isStreaming, () => {
  // Use setTimeout to ensure DOM has updated
  setTimeout(checkMessageHeight, 100);
});

// Watch for content changes during streaming
watch(() => currentBranch.value?.content, () => {
  if (props.isStreaming) {
    setTimeout(checkMessageHeight, 100);
  }
});

function checkMessageHeight() {
  if (messageCard.value) {
    const element = (messageCard.value as any).$el || messageCard.value;
    // Show button if message is taller than 500px
    showScrollToTop.value = element?.offsetHeight > 500;
  }
}

function scrollToTopOfMessage() {
  if (messageCard.value) {
    const element = (messageCard.value as any).$el || messageCard.value;
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    // Stop auto-scrolling if streaming
    if (props.isStreaming) {
      // Emit event to parent to stop auto-scrolling
      emit('stop-auto-scroll');
    }
  }
}

// Get participant display name (shown in UI)
const participantDisplayName = computed(() => {
  return getParticipantDisplayName(currentBranch.value, props.participants, {
    userFallback: 'You'
  });
});

// Get model indicator for assistant messages
const modelIndicator = computed(() => {
  const branch = currentBranch.value;
  
  // Only show model indicator for assistant messages that have a model stored
  if (branch.role === 'assistant' && branch.model) {
    const details = getModelDetails(branch.model);
    if (details) {
      // Always prefer providerModelId (e.g., google/gemini-3-pro-preview)
      // as it's most useful for identifying the actual model
      return details.providerModelId || details.displayName;
    }
    return branch.model;
  }
  
  return null;
});

// Authenticity level for this message
const authenticityLevel = computed(() => {
  if (!props.authenticityStatus) return null;
  return getAuthenticityLevel(props.authenticityStatus);
});

// Check if this is a human-written AI message (for special styling)
const isHumanWrittenAI = computed(() => {
  return props.authenticityStatus?.isHumanWrittenAI ?? false;
});

const participantColor = computed(() => {
  return resolveParticipantColor(
    currentBranch.value,
    props.participants,
    store.state.models
  );
});

// Avatar URL for the participant
const avatarUrl = computed(() => {
  const branch = currentBranch.value;
  
  // Find participant
  let participant = null;
  if (props.participants && branch.participantId) {
    participant = props.participants.find(p => p.id === branch.participantId);
  }
  
  // For now, pass null for persona (could be extended later)
  return getParticipantAvatarUrl(
    participant || { type: branch.role === 'user' ? 'user' : 'assistant', model: branch.model },
    store.state.models,
    null
  );
});

// Name to show in avatar preview (use model name if participant name is single letter like 'A')
const avatarPreviewName = computed(() => {
  const name = participantDisplayName.value;
  // If name is a single letter (placeholder), use model display name instead
  if (name && name.length === 1) {
    const branch = currentBranch.value;
    const modelId = branch.model;
    if (modelId) {
      const modelObj = store.state.models?.find((m: any) => m.id === modelId);
      if (modelObj?.displayName) {
        return modelObj.displayName;
      }
    }
  }
  return name || 'Assistant';
});

// Model ID to always show in avatar preview
const avatarPreviewModelId = computed(() => {
  const branch = currentBranch.value;
  if (branch.role !== 'assistant') return null;
  
  const modelId = branch.model;
  if (!modelId) return null;
  
  const modelObj = store.state.models?.find((m: any) => m.id === modelId);
  // Prefer providerModelId as it's the most useful identifier
  return modelObj?.providerModelId || modelId;
});

// Get all sibling branches (branches that share the same parent)
const siblingBranches = computed(() => {
  const activeParent = currentBranch.value.parentBranchId;
  return props.message.branches.filter(
    branch => branch.parentBranchId === activeParent
  );
});

// Get index among siblings
const siblingIndex = computed(() => {
  // Use effective branch ID (local selection if detached, else server's activeBranchId)
  const effectiveBranchId = store.getEffectiveBranchId(props.message);
  return siblingBranches.value.findIndex(b => b.id === effectiveBranchId) || 0;
});

// Check if branches are navigable (share the same parent)
const hasNavigableBranches = computed(() => {
  return siblingBranches.value.length > 1;
});

// Extract thinking blocks from content blocks
const thinkingBlocks = computed(() => {
  const branch = currentBranch.value;
  if (!branch.contentBlocks || branch.contentBlocks.length === 0) {
    return [];
  }
  
  // Filter for thinking and redacted_thinking blocks
  return branch.contentBlocks.filter((block: any) => 
    block.type === 'thinking' || block.type === 'redacted_thinking'
  );
});

// Extract generated image blocks from content blocks
const imageBlocks = computed(() => {
  const branch = currentBranch.value;
  if (!branch.contentBlocks || branch.contentBlocks.length === 0) {
    return [];
  }
  
  // Filter for image content blocks (generated by model)
  const images = branch.contentBlocks.filter((block: any) => block.type === 'image');
  if (images.length > 0) {
    console.log('[MessageComponent] Found image blocks:', images.length, images.map((b: any) => ({ type: b.type, hasData: !!b.data, mimeType: b.mimeType })));
  }
  return images;
});

// Control thinking panel open/close state
const thinkingPanelOpen = ref<number | undefined>(undefined);

// Check if thinking is currently streaming (has thinking blocks, is streaming, no content yet)
const isThinkingStreaming = computed(() => {
  const streaming = props.isStreaming && 
         thinkingBlocks.value.length > 0 && 
         !currentBranch.value.content?.trim();
  return streaming;
});

// Debug: watch for contentBlocks changes
watch(() => currentBranch.value.contentBlocks, (blocks) => {
  if (blocks && blocks.length > 0) {
    console.log('[MessageComponent] contentBlocks updated:', blocks.length, 'types:', blocks.map((b: any) => b.type));
  }
}, { immediate: true });

// Auto-open panel when thinking starts streaming, close when content starts
watch(isThinkingStreaming, (streaming, oldStreaming) => {
  if (streaming) {
    // Open the first thinking panel
    thinkingPanelOpen.value = 0;
  } else if (oldStreaming && currentBranch.value.content?.trim()) {
    // Close panel when response content starts (only if it was open due to streaming)
    thinkingPanelOpen.value = undefined;
  }
}, { immediate: true });

const renderedContent = computed(() => {
  // Use edited content if this message has a post-hoc edit applied
  let content = props.postHocAffected?.editedContent ?? currentBranch.value.content;
  
  // Preserve leading/trailing whitespace by converting to non-breaking spaces
  const leadingSpaces = content.match(/^(\s+)/)?.[1] || '';
  const trailingSpaces = content.match(/(\s+)$/)?.[1] || '';
  
  // First, protect code blocks and inline code from HTML escaping
  const codeBlocks: string[] = [];
  const inlineCode: string[] = [];
  
  // Save code blocks with placeholders
  content = content.replace(/```[\s\S]*?```/g, (match) => {
    const index = codeBlocks.length;
    codeBlocks.push(match);
    return `__CODE_BLOCK_${index}__`;
  });
  
  // Save inline code with placeholders
  content = content.replace(/`[^`\n]+`/g, (match) => {
    const index = inlineCode.length;
    inlineCode.push(match);
    return `__INLINE_CODE_${index}__`;
  });
  
  // Escape HTML/XML tags that aren't in code blocks
  // This prevents raw HTML from being rendered but preserves it visually
  content = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  // Preserve multiple consecutive spaces by converting to non-breaking spaces
  // (do this before markdown rendering, which would collapse them)
  // Convert 2+ spaces to alternating space/nbsp to preserve them
  content = content.replace(/ {2,}/g, (match) => {
    // Alternate between regular space and nbsp to allow wrapping while preserving count
    return match.split('').map((_, i) => i % 2 === 0 ? ' ' : '&nbsp;').join('');
  });
  
  // Also preserve leading spaces on each line (for indentation)
  content = content.replace(/^( +)/gm, (match) => {
    return match.replace(/ /g, '&nbsp;');
  });
  
  // Restore code blocks and inline code
  content = content.replace(/__CODE_BLOCK_(\d+)__/g, (_, index) => codeBlocks[parseInt(index)]);
  content = content.replace(/__INLINE_CODE_(\d+)__/g, (_, index) => inlineCode[parseInt(index)]);
  
  // Handle code blocks with syntax highlighting
  const renderer = new marked.Renderer();
  
  renderer.code = (code, language) => {
    if (language) {
      try {
        // In a real app, you'd use a syntax highlighter like Prism or highlight.js
        return `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`;
      } catch (e) {
        // Fallback for unknown languages
      }
    }
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  };
  
  marked.setOptions({
    renderer,
    breaks: true,
    gfm: true
  });
  
  let html = marked.parse ? marked.parse(content) : marked(content);
  // Handle if marked returns a promise (newer versions)
  if (html instanceof Promise) {
    html = ''; // Fallback, but this shouldn't happen with sync parse
  }
  
  // Render LaTeX after markdown (so LaTeX in code blocks is protected)
  html = renderLatex(html as string);
  
  // Convert leading/trailing spaces to non-breaking spaces to preserve them
  const leadingNbsp = leadingSpaces.replace(/ /g, '&nbsp;').replace(/\n/g, '<br>');
  const trailingNbsp = trailingSpaces.replace(/ /g, '&nbsp;').replace(/\n/g, '<br>');
  
  // Add preserved whitespace back
  if (leadingNbsp) {
    html = leadingNbsp + html;
  }
  if (trailingNbsp) {
    html = html + trailingNbsp;
  }
  
  return DOMPurify.sanitize(html, {
    // Allow safe HTML tags from markdown plus KaTeX
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre',
      'blockquote', 'ul', 'ol', 'li', 'a', 'img',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'hr', 'sup', 'sub', 'del', 'ins',
      ...KATEX_ALLOWED_TAGS
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel', ...KATEX_ALLOWED_ATTRS]
  });
});

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function startEdit() {
  isEditing.value = true;
  isPostHocEditing.value = false;
  editContent.value = currentBranch.value.content;
}

function startPostHocEdit() {
  isEditing.value = true;
  isPostHocEditing.value = true;
  editContent.value = currentBranch.value.content;
}

function cancelEdit() {
  isEditing.value = false;
  isPostHocEditing.value = false;
  editContent.value = '';
}

function saveEdit() {
  if (editContent.value !== currentBranch.value.content) {
    if (isPostHocEditing.value) {
      // Create a post-hoc edit operation (no regeneration)
      emit('post-hoc-edit-content', props.message.id, currentBranch.value.id, editContent.value);
    } else {
      // Regular edit that triggers regeneration
      emit('edit', props.message.id, currentBranch.value.id, editContent.value);
    }
  }
  cancelEdit();
}

function saveEditOnly() {
  if (editContent.value !== currentBranch.value.content) {
    // Edit and branch without triggering regeneration
    emit('edit-only', props.message.id, currentBranch.value.id, editContent.value);
  }
  cancelEdit();
}

function startSplit() {
  const content = currentBranch.value?.content || '';
  // Default to middle of message
  splitPosition.value = Math.floor(content.length / 2);
  isSplitting.value = true;
}

function cancelSplit() {
  isSplitting.value = false;
  splitPosition.value = 0;
}

function confirmSplit() {
  if (splitPosition.value > 0 && splitPosition.value < (currentBranch.value?.content?.length || 0)) {
    emit('split', props.message.id, currentBranch.value.id, splitPosition.value);
  }
  cancelSplit();
}

function handleContentContextMenu(event: MouseEvent) {
  // Only show for assistant messages
  if (currentBranch.value?.role !== 'assistant') return;
  
  event.preventDefault();
  
  // Get the text selection or caret position
  const selection = window.getSelection();
  if (!selection) return;
  
  // Get selected text or the word around caret
  let selectedText = selection.toString();
  let searchPosition = 0;
  
  if (selectedText.length === 0) {
    // No selection - use the focused text node and offset
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    
    if (node.nodeType === Node.TEXT_NODE) {
      const textContent = node.textContent || '';
      const offset = range.startOffset;
      // Get surrounding context (20 chars before)
      const contextStart = Math.max(0, offset - 20);
      selectedText = textContent.substring(contextStart, offset);
    }
  }
  
  // Find this text in the source content
  const sourceContent = currentBranch.value?.content || '';
  
  if (selectedText.length > 0) {
    // Find the position in source - search for the selected/context text
    const index = sourceContent.indexOf(selectedText);
    if (index !== -1) {
      // Split after this text
      searchPosition = index + selectedText.length;
    } else {
      // Fallback: estimate position based on selection range
      // Try to find partial match
      for (let len = selectedText.length; len >= 5; len--) {
        const partial = selectedText.substring(selectedText.length - len);
        const idx = sourceContent.indexOf(partial);
        if (idx !== -1) {
          searchPosition = idx + partial.length;
          break;
        }
      }
    }
  }
  
  // Validate position
  if (searchPosition <= 0 || searchPosition >= sourceContent.length) {
    // Can't determine valid split position
    return;
  }
  
  contextSplitPosition.value = searchPosition;
  // Use clientX/clientY for fixed positioning (viewport-relative)
  splitMenuPosition.value = { x: event.clientX, y: event.clientY };
  showSplitContextMenu.value = true;
  
  // Clean up any existing handler first
  if (splitMenuCloseHandler.value) {
    document.removeEventListener('click', splitMenuCloseHandler.value);
    document.removeEventListener('contextmenu', splitMenuCloseHandler.value);
  }
  
  // Close menu on click outside or another context menu
  splitMenuCloseHandler.value = () => {
    showSplitContextMenu.value = false;
    if (splitMenuCloseHandler.value) {
      document.removeEventListener('click', splitMenuCloseHandler.value);
      document.removeEventListener('contextmenu', splitMenuCloseHandler.value);
      splitMenuCloseHandler.value = null;
    }
  };
  
  // Delay adding listener so current event doesn't trigger it
  setTimeout(() => {
    if (splitMenuCloseHandler.value) {
      document.addEventListener('click', splitMenuCloseHandler.value);
      document.addEventListener('contextmenu', splitMenuCloseHandler.value);
    }
  }, 10);
}

function splitAtContextPosition() {
  if (contextSplitPosition.value > 0 && contextSplitPosition.value < (currentBranch.value?.content?.length || 0)) {
    emit('split', props.message.id, currentBranch.value.id, contextSplitPosition.value);
  }
  closeSplitMenu();
}

function closeSplitMenu() {
  showSplitContextMenu.value = false;
  if (splitMenuCloseHandler.value) {
    document.removeEventListener('click', splitMenuCloseHandler.value);
    document.removeEventListener('contextmenu', splitMenuCloseHandler.value);
    splitMenuCloseHandler.value = null;
  }
}

function copyContent() {
  navigator.clipboard.writeText(currentBranch.value.content);
}

function handleMouseLeave() {
  // Don't hide hover bar if the more menu is open (user is interacting with menu popup)
  if (!moreMenuOpen.value) {
    isHovered.value = false;
  }
}

async function saveAsImage() {
  if (!messageCard.value) return;
  
  try {
    const html2canvas = (await import('html2canvas')).default;
    
    // Clone the entire message card (including header)
    const clone = messageCard.value.cloneNode(true) as HTMLElement;
    
    // Remove the action bar from the clone
    const hoverActions = clone.querySelector('.action-bar');
    if (hoverActions) hoverActions.remove();
    
    // Remove branch navigation from clone
    const branchNav = clone.querySelector('.branch-nav-row');
    if (branchNav) branchNav.remove();
    
    // Style the clone for clean rendering
    clone.style.position = 'absolute';
    clone.style.left = '-9999px';
    clone.style.width = 'max-content';
    clone.style.maxWidth = '1200px';
    clone.style.minWidth = '400px';
    clone.style.margin = '0';
    clone.style.borderRadius = '8px';
    clone.style.boxShadow = 'none';
    
    // If monospace mode, apply it to the content
    if (isMonospace.value) {
      const content = clone.querySelector('.message-content') as HTMLElement;
      if (content) {
        content.style.fontFamily = "'JetBrains Mono', 'Fira Code', 'Consolas', monospace";
        content.style.fontSize = '13px';
        content.style.whiteSpace = 'pre-wrap';
      }
    }
    
    // Temporarily append to body
    document.body.appendChild(clone);
    
    const canvas = await html2canvas(clone, {
      backgroundColor: '#1e1e1e',
      scale: 2, // Higher resolution
      logging: false,
    });
    
    // Clean up
    document.body.removeChild(clone);
    
    // Add Arc watermark in upper right corner
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const padding = 24;
      const text = 'Arc';
      
      // Draw background pill
      ctx.font = 'bold 24px system-ui, -apple-system, sans-serif';
      const textWidth = ctx.measureText(text).width;
      const pillWidth = textWidth + 24;
      const pillHeight = 32;
      const pillX = canvas.width - pillWidth - padding;
      const pillY = padding;
      
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillWidth, pillHeight, 16);
      ctx.fill();
      
      // Draw arc symbol (⌒) and text
      ctx.fillStyle = '#a5d6a7';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, pillX + 12, pillY + pillHeight / 2 + 1);
    }
    
    // Download the image
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
    link.download = `message-${props.message.id.slice(0, 8)}-${timestamp}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (error) {
    console.error('Failed to save as image:', error);
  }
}

function navigateBranch(direction: number) {
  const newIndex = siblingIndex.value + direction;
  if (newIndex >= 0 && newIndex < siblingBranches.value.length) {
    emit('switch-branch', props.message.id, siblingBranches.value[newIndex].id);
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function isImageAttachment(attachment: any): boolean {
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
  const fileExtension = attachment.fileName?.split('.').pop()?.toLowerCase() || '';
  return imageExtensions.includes(fileExtension);
}

function getImageSrc(attachment: any): string {
  const fileExtension = attachment.fileName?.split('.').pop()?.toLowerCase() || 'png';
  return `data:image/${fileExtension};base64,${attachment.content}`;
}

function openImageInNewTab(attachment: any): void {
  const src = getImageSrc(attachment);
  const newWindow = window.open();
  if (newWindow) {
    newWindow.document.write(`<img src="${src}" style="max-width: 100%; height: auto;" />`);
    newWindow.document.title = attachment.fileName;
  }
}

function openImagePreview(block: any): void {
  if (block.data) {
    previewImageSrc.value = `data:${block.mimeType || 'image/png'};base64,${block.data}`;
    previewImageAlt.value = block.revisedPrompt || 'Generated image';
    imagePreviewDialog.value = true;
  }
}

function formatTimestamp(timestamp: string | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  // If today, show time
  if (diffDays === 0) {
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
  }
  
  // If yesterday
  if (diffDays === 1) {
    return `Yesterday ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }
  
  // If within this week
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  }
  
  // Otherwise show date
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

async function downloadPrompt() {
  try {
    // Get the conversation ID from the store
    const conversationId = store.state.currentConversation?.id;
    if (!conversationId) {
      console.error('No conversation ID available');
      return;
    }

    // Call the API to get the prompt
    const response = await api.post('/prompt/build', {
      conversationId,
      branchId: currentBranch.value.id,
      includeSystemPrompt: true
    });

    // Create a downloadable JSON file with just the messages array
    const blob = new Blob([JSON.stringify(response.data.messages, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prompt-${props.message.id}-${currentBranch.value.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Failed to download prompt:', error);
  }
}

// Copy all message metadata to clipboard
async function copyMetadataToClipboard() {
  const metadata = {
    message: {
      id: props.message.id,
      conversationId: props.message.conversationId,
      activeBranchId: props.message.activeBranchId,
      order: props.message.order,
      createdAt: props.message.createdAt,
    },
    currentBranch: {
      id: currentBranch.value.id,
      role: currentBranch.value.role,
      parentBranchId: currentBranch.value.parentBranchId,
      model: currentBranch.value.model,
      participantId: currentBranch.value.participantId,
      sentByUserId: currentBranch.value.sentByUserId,
      contentLength: currentBranch.value.content?.length || 0,
      contentBlocks: currentBranch.value.contentBlocks?.length || 0,
      hasDebugRequest: !!currentBranch.value.debugRequest,
      hasDebugResponse: !!currentBranch.value.debugResponse,
      createdAt: currentBranch.value.createdAt,
    },
    allBranches: props.message.branches.map((b, idx) => ({
      index: idx,
      id: b.id,
      role: b.role,
      parentBranchId: b.parentBranchId,
      model: b.model,
      isActive: b.id === props.message.activeBranchId,
    })),
    debugRequest: currentBranch.value.debugRequest,
    debugResponse: currentBranch.value.debugResponse,
  };
  
  try {
    await navigator.clipboard.writeText(JSON.stringify(metadata, null, 2));
    console.log('Metadata copied to clipboard');
  } catch (err) {
    console.error('Failed to copy metadata:', err);
  }
}

// Bookmark management
async function loadBookmark() {
  try {
    const conversationId = store.state.currentConversation?.id;
    if (!conversationId) return;

    const response = await api.get(`/bookmarks/conversation/${conversationId}`);
    const bookmarks = response.data;

    // Find bookmark for current branch
    const bookmark = bookmarks.find((b: any) =>
      b.messageId === props.message.id && b.branchId === currentBranch.value.id
    );

    if (bookmark) {
      bookmarkLabel.value = bookmark.label;
    } else {
      // Clear bookmark label if no bookmark exists for this branch
      bookmarkLabel.value = null;
    }
  } catch (error) {
    console.error('Failed to load bookmark:', error);
  }
}

function toggleBookmark() {
  if (hasBookmark.value) {
    bookmarkInput.value = bookmarkLabel.value || '';
  } else {
    bookmarkInput.value = '';
  }
  bookmarkDialog.value = true;
}

async function saveBookmark() {
  try {
    const conversationId = store.state.currentConversation?.id;
    if (!conversationId) return;

    const label = bookmarkInput.value.trim();
    if (!label) return;

    await api.post('/bookmarks', {
      conversationId,
      messageId: props.message.id,
      branchId: currentBranch.value.id,
      label
    });

    bookmarkLabel.value = label;
    bookmarkDialog.value = false;

    // Notify parent that bookmarks changed
    emit('bookmark-changed');
  } catch (error) {
    console.error('Failed to save bookmark:', error);
  }
}

async function deleteBookmark() {
  try {
    await api.delete(`/bookmarks/${props.message.id}/${currentBranch.value.id}`);

    bookmarkLabel.value = null;
    bookmarkDialog.value = false;

    // Notify parent that bookmarks changed
    emit('bookmark-changed');
  } catch (error) {
    console.error('Failed to delete bookmark:', error);
  }
}

// Watch for branch changes and reload bookmark
watch(() => currentBranch.value.id, async () => {
  await loadBookmark();
});
</script>

<style scoped>

/* Authenticity icon wrapper in top right corner */
.authenticity-corner-wrapper {
  position: absolute;
  top: -2px;
  right: 8px;
  opacity: 0.5;
  transition: opacity 0.2s ease;
  z-index: 10;
  pointer-events: auto;
}

.authenticity-corner-wrapper:hover {
  opacity: 1;
}

/* Post-hoc operation marker - compact inline display */
.post-hoc-operation-marker {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  margin: 4px 0;
  background: rgba(var(--v-theme-warning), 0.1);
  border-left: 3px solid rgb(var(--v-theme-warning));
  border-radius: 4px;
  opacity: 0.85;
}

.post-hoc-operation-marker:hover {
  opacity: 1;
  background: rgba(var(--v-theme-warning), 0.15);
}

/* Messages affected by post-hoc hide operations */
.post-hoc-hidden {
  opacity: 0.6;
  background: rgba(128, 128, 128, 0.08) !important;
}

.post-hoc-hidden .message-content {
  text-decoration: line-through;
  text-decoration-color: rgba(128, 128, 128, 0.5);
  color: rgba(var(--v-theme-on-surface), 0.5) !important;
}

.post-hoc-hidden .message-header,
.post-hoc-hidden .message-meta {
  opacity: 0.6;
}

/* Messages affected by post-hoc edit operations */
.post-hoc-edited {
  border-left: 3px solid rgb(var(--v-theme-info)) !important;
}

/* Human-written AI messages - distinct styling */
.human-written-ai {
  background: linear-gradient(135deg, rgba(233, 30, 99, 0.08) 0%, rgba(156, 39, 176, 0.05) 100%) !important;
  border-left: 3px solid #E91E63 !important;
}

.human-written-ai .message-content {
  /* Subtle italic for human-written AI content */
  font-style: italic;
}

/* Mobile: full-width messages */
@media (max-width: 768px) {
  .v-card {
    max-width: 100% !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
  }
}

.error-indicator {
  max-width: 100%;
}

.error-box {
  background: rgba(var(--v-theme-error), 0.1);
  border: 1px solid rgba(var(--v-theme-error), 0.3);
  border-radius: 8px;
  padding: 12px;
  max-width: 100%;
}

.error-header {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}

.error-title {
  font-weight: 600;
  color: rgb(var(--v-theme-error));
  font-size: 0.875rem;
}

.error-message {
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.875rem;
  line-height: 1.4;
  word-wrap: break-word;
  white-space: pre-wrap;
}

.error-suggestion {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(var(--v-theme-error), 0.2);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.8125rem;
  line-height: 1.4;
}

.generating-indicator {
  display: flex;
  align-items: center;
}

.generating-chip {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

.meta-text {
  opacity: 0.6;
  font-size: 0.75rem;
}

.top-controls {
  margin-top: -14px;
  margin-bottom: -2px;
}

.bottom-controls {
  margin-bottom: -6px;
  gap: 8px;
}

.flip-vertical {
  transform: scaleY(-1);
}

/* Compact message container */
.message-container {
  position: relative;
  border-radius: 8px;
  transition: background-color 0.15s ease;
  margin-bottom: 10px;
  max-width: 100%;
  overflow: visible;
  word-wrap: break-word;
  overflow-wrap: break-word;
  /* Padding: top, left/right, and bottom. Bottom padding reserves space for the action bar
     to prevent layout shift/flicker when hovering near the last message.
     The action bar may slightly overlap content, but its semi-transparent background
     keeps text readable.*/
  padding: 12px 12px 28px 12px;
}

/* Desktop: left-right offsets */
@media (min-width: 600px) {
  .message-container {
    max-width: 80%;
  }
  
  .message-container.user-message {
    margin-left: auto;
  }
  
  .message-container.assistant-message {
    margin-right: auto;
  }
}

/* User message styling - matches v-card primary tonal */
.message-container.user-message {
  background: rgba(var(--v-theme-primary), 0.15);
}

/* Assistant message styling - matches v-card surface elevated */
.message-container.assistant-message {
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 2px 4px -1px rgba(0,0,0,.2), 0 4px 5px 0 rgba(0,0,0,.14), 0 1px 10px 0 rgba(0,0,0,.12);
}

.message-container:hover {
  filter: brightness(1.05);
}

/* When action bar is visible, lift the message above siblings */
.message-container.action-bar-visible {
  z-index: 50;
  position: relative;
}

/* Branch nav: separate row on narrow screens */
.branch-nav-row {
  display: flex;
  margin-bottom: 2px;
}

/* Branch counter in action bar */
.branch-counter {
  opacity: 0.8;
  min-width: 28px;
  text-align: center;
}

/* Hide inline branch nav on narrow screens */
.branch-nav-inline {
  display: none !important;
}

/* Info row - simple flex by default */
.info-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  overflow: hidden;
  max-width: 100%;
}

/* Wide screens: hide separate row, show inline centered */
@media (min-width: 700px) {
  .branch-nav-row {
    display: none !important;
  }
  
  .branch-nav-inline {
    display: flex !important;
  }
  
  .info-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    flex-wrap: nowrap;
    gap: 8px;
  }
}

/* Message avatar */
.message-avatar {
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* Clickable avatar */
.message-avatar.clickable-avatar {
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.message-avatar.clickable-avatar:hover {
  transform: scale(1.1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

/* Name matches message font size */
.message-name {
  font-size: 0.875rem;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 150px;
}

/* Match v-card-text typography */
.message-content {
  font-size: 0.875rem;
  line-height: 1.5;
  overflow-x: hidden;
  word-wrap: break-word;
  overflow-wrap: break-word;
  margin-top: 6px;
}

/* Use :deep() to penetrate v-html content */
.message-content :deep(p) {
  margin-top: 0;
  margin-bottom: 0.5em;
}

.message-content :deep(p:first-child) {
  margin-top: 0;
}

.message-content :deep(p:last-child) {
  margin-bottom: 0;
}

/* Monospace mode for message content */
.message-content.monospace-mode {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 0.8rem;
  line-height: 1.4;
  white-space: pre-wrap;
  background-color: rgba(var(--v-theme-surface-variant), 0.3);
  padding: 12px;
  border-radius: 6px;
  margin-top: 8px;
}

.message-content.monospace-mode :deep(p) {
  margin-bottom: 0.25em;
}

.message-content.monospace-mode :deep(code) {
  background: transparent;
  padding: 0;
}

.message-content.monospace-mode :deep(pre) {
  background: transparent;
  padding: 0;
  margin: 0;
}

/* Discord-style hover action bar */
/* Action bar - floating at bottom-right corner, flush with message edges.
   Positioned inside message bounds to prevent layout shifts on last message.
   Semi-transparent so message text can be seen through it if overlapping. */
.action-bar {
  position: absolute;
  bottom: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px 0 6px 0; /* Round only top-left and bottom-right to fit corner */
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  z-index: 100;
}

/* Instant CSS tooltips for hover bar */
.hover-tooltip {
  position: relative;
  display: inline-flex;
}

.hover-tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 8px;
  background: rgba(20, 20, 20, 0.95);
  color: #fff;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  border-radius: 4px;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.08s ease;
  pointer-events: none;
  z-index: 1000;
  margin-top: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.hover-tooltip:hover::after {
  opacity: 1;
  visibility: visible;
}

/* Compact more menu */
.more-menu .v-list-item {
  min-height: 28px !important;
  padding: 4px 10px !important;
}

.more-menu .v-list-item__prepend {
  margin-right: 8px !important;
}

.more-menu .v-list-item__append {
  margin-left: 8px !important;
}

.more-menu-wrapper {
  display: inline-flex;
}

.action-bar .v-btn {
  opacity: 0.75;
  min-width: 24px;
  height: 24px;
}

.action-bar .v-btn:hover {
  opacity: 1;
}

.action-bar .v-divider {
  height: 14px !important;
}

/* Metadata dialog debug JSON */
.debug-json {
  background: rgba(0, 0, 0, 0.3);
  color: #a5d6a7;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  white-space: pre-wrap;
  word-break: break-all;
}

/* Touch toggle button - fixed in bottom-right corner on touch devices */
.touch-toggle-btn {
  position: absolute;
  bottom: 8px;
  right: 8px;
  opacity: 0.5;
  z-index: 5;
}

.touch-toggle-btn:hover,
.touch-toggle-btn:focus {
  opacity: 0.8;
}
</style>

<style>
/* Global style for bookmark tooltip - needs to be unscoped to override Vuetify */
.bookmark-tooltip {
  background-color: transparent !important;
  box-shadow: none !important;
}

/* Split context menu - teleported to body, so unscoped */
.split-context-menu {
  position: fixed;
  z-index: 9999;
  /* Offset slightly so cursor doesn't immediately trigger close */
  transform: translate(2px, 2px);
}
</style>

