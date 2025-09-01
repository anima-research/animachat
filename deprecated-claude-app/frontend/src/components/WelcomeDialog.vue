<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="600"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <ArcLogo :size="30" class="mr-2" />
        <span>Welcome to The Arc</span>
      </v-card-title>
      
      <v-card-text>
        <p class="text-body-1 mb-4">
          Let's get you started with The Arc Chat. Follow these simple steps:
        </p>
        
        <v-timeline density="compact" side="end">
          <!-- Step 1: API Key -->
          <v-timeline-item
            dot-color="primary"
            size="small"
            icon="mdi-key"
          >
            <div>
              <h4 class="text-h6 mb-1">1. Set Your API Key</h4>
              <p class="text-body-2 mb-2">
                Add your Anthropic API key to start chatting with Claude models.
              </p>
              <v-btn
                variant="outlined"
                size="small"
                color="primary"
                @click="openSettings"
              >
                <v-icon start>mdi-cog</v-icon>
                Open Settings
              </v-btn>
            </div>
          </v-timeline-item>
          
          <!-- Step 2: Export Tool -->
          <v-timeline-item
            dot-color="secondary"
            size="small"
            icon="mdi-download"
          >
            <div>
              <h4 class="text-h6 mb-1">2. Export Your Conversations (Optional)</h4>
              <p class="text-body-2 mb-2">
                Install our Chrome extension to export and continue your Claude.ai conversations.
              </p>
              <v-btn
                variant="outlined"
                size="small"
                color="secondary"
                href="https://github.com/socketteer/Claude-Conversation-Exporter"
                target="_blank"
              >
                <v-icon start>mdi-github</v-icon>
                Get Export Tool
              </v-btn>
            </div>
          </v-timeline-item>
          
          <!-- Step 3: Start Chatting -->
          <v-timeline-item
            dot-color="success"
            size="small"
            icon="mdi-message-plus"
          >
            <div>
              <h4 class="text-h6 mb-1">3. Start Your Journey</h4>
              <p class="text-body-2 mb-2">
                Create a new conversation or import existing ones to begin.
              </p>
              <v-row dense>
                <v-col cols="auto">
                  <v-btn
                    variant="outlined"
                    size="small"
                    color="success"
                    @click="startNewConversation"
                  >
                    <v-icon start>mdi-plus</v-icon>
                    New Chat
                  </v-btn>
                </v-col>
                <v-col cols="auto">
                  <v-btn
                    variant="outlined"
                    size="small"
                    color="success"
                    @click="openImport"
                  >
                    <v-icon start>mdi-import</v-icon>
                    Import
                  </v-btn>
                </v-col>
              </v-row>
            </div>
          </v-timeline-item>
        </v-timeline>
        
        <v-alert
          type="info"
          variant="tonal"
          class="mt-4"
          density="compact"
        >
          <strong>Tip:</strong> You can access this guide anytime from the menu.
        </v-alert>
        
        <v-checkbox
          v-model="dontShowAgain"
          label="Don't show this again"
          density="compact"
          class="mt-2"
        />
      </v-card-text>
      
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="handleClose"
        >
          {{ dontShowAgain ? 'Close' : 'Skip' }}
        </v-btn>
        <v-btn
          color="primary"
          variant="elevated"
          @click="handleGetStarted"
        >
          Get Started
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import ArcLogo from '@/components/ArcLogo.vue';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'open-settings': [];
  'open-import': [];
  'new-conversation': [];
}>();

const dontShowAgain = ref(false);

function handleClose() {
  if (dontShowAgain.value) {
    localStorage.setItem('hideWelcomeDialog', 'true');
  }
  emit('update:modelValue', false);
}

function handleGetStarted() {
  if (dontShowAgain.value) {
    localStorage.setItem('hideWelcomeDialog', 'true');
  }
  emit('update:modelValue', false);
  emit('open-settings');
}

function openSettings() {
  emit('update:modelValue', false);
  emit('open-settings');
}

function openImport() {
  emit('update:modelValue', false);
  emit('open-import');
}

function startNewConversation() {
  emit('update:modelValue', false);
  emit('new-conversation');
}
</script>
