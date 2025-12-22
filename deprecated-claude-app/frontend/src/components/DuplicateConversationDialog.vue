<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="500"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-content-copy</v-icon>
        Duplicate Conversation
      </v-card-title>
      
      <v-card-text>
        <p class="text-body-2 mb-4">
          Create a copy of "{{ conversation?.title || 'this conversation' }}".
        </p>
        
        <v-alert type="info" variant="tonal" density="compact" class="mb-4">
          <span class="text-body-2">
            The duplicate will follow the <strong>currently active conversation path</strong> 
            (the messages you see now). Alternate branches will not be included.
          </span>
        </v-alert>
        
        <v-text-field
          v-model="options.title"
          label="New conversation title"
          variant="outlined"
          density="compact"
          class="mb-3"
        />
        
        <v-divider class="mb-3" />
        
        <h4 class="text-subtitle-2 mb-2">Message Options</h4>
        
        <v-switch
          v-model="trimMessages"
          label="Trim to recent messages only"
          density="compact"
          hide-details
          class="mb-2"
        />
        
        <div v-if="trimMessages">
          <div v-if="loadingMessages" class="d-flex align-center mb-3">
            <v-progress-circular indeterminate size="20" class="mr-2" />
            <span class="text-caption">Loading message count...</span>
          </div>
          <v-slider
            v-else
            v-model="options.lastMessages"
            :min="1"
            :max="Math.min(messageCount, 100)"
            :step="1"
            label="Last messages to keep"
            thumb-label="always"
            class="mb-3"
          >
            <template v-slot:append>
              <span class="text-caption">{{ options.lastMessages }} of {{ messageCount }}</span>
            </template>
          </v-slider>
          
          <p class="text-caption text-grey mb-3">
            Starting from the current leaf message, only the last {{ options.lastMessages }} messages 
            going upward will be copied. Use this to create a focused continuation from recent context.
          </p>
        </div>
        
        <v-divider class="mb-3" />
        
        <h4 class="text-subtitle-2 mb-2">Copy Options</h4>
        
        <v-checkbox
          v-model="options.includeSystemPrompt"
          label="Include system prompt"
          density="compact"
          hide-details
          class="mb-1"
        />
        
        <v-checkbox
          v-model="options.includeSettings"
          label="Include model settings (temperature, etc.)"
          density="compact"
          hide-details
        />
      </v-card-text>
      
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="$emit('update:modelValue', false)"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          variant="elevated"
          :loading="duplicating"
          @click="duplicate"
        >
          <v-icon start>mdi-content-copy</v-icon>
          Duplicate
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { Conversation } from '@deprecated-claude/shared';
import { api } from '@/services/api';

const props = defineProps<{
  modelValue: boolean;
  conversation: Conversation | null;
  messageCount: number;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'duplicated': [conversation: Conversation];
}>();

const duplicating = ref(false);
const trimMessages = ref(false);
const loadingMessages = ref(false);
const actualMessageCount = ref(0);

const options = ref({
  title: '',
  lastMessages: 10,
  includeSystemPrompt: true,
  includeSettings: true,
});

// Reset options when dialog opens
watch(() => props.modelValue, async (isOpen) => {
  if (isOpen && props.conversation) {
    options.value.title = `${props.conversation.title} (Copy)`;
    options.value.includeSystemPrompt = true;
    options.value.includeSettings = true;
    trimMessages.value = false;
    
    // Load actual message count if not provided
    if (props.messageCount > 0) {
      actualMessageCount.value = props.messageCount;
    } else {
      loadingMessages.value = true;
      try {
        const response = await api.get(`/conversations/${props.conversation.id}/messages`);
        actualMessageCount.value = response.data.length;
      } catch (error) {
        console.error('Failed to load messages:', error);
        actualMessageCount.value = 50; // Default fallback
      } finally {
        loadingMessages.value = false;
      }
    }
    
    options.value.lastMessages = Math.min(10, actualMessageCount.value);
  }
});

const messageCount = computed(() => actualMessageCount.value || props.messageCount);

async function duplicate() {
  if (!props.conversation) return;
  
  duplicating.value = true;
  try {
    const payload: any = {
      newTitle: options.value.title,
      includeSystemPrompt: options.value.includeSystemPrompt,
      includeSettings: options.value.includeSettings,
    };
    
    if (trimMessages.value) {
      payload.lastMessages = options.value.lastMessages;
    }
    
    const response = await api.post(`/conversations/${props.conversation.id}/duplicate`, payload);
    emit('duplicated', response.data);
    emit('update:modelValue', false);
  } catch (error) {
    console.error('Failed to duplicate conversation:', error);
  } finally {
    duplicating.value = false;
  }
}
</script>

