<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="900"
    scrollable
  >
    <v-card max-height="85vh" class="d-flex flex-column">
      <v-card-title class="flex-shrink-0">
        Import Conversation
      </v-card-title>
      
      <v-stepper v-model="step" hide-actions class="flex-grow-1 overflow-hidden d-flex flex-column">
        <!-- Step 1: Select Import Format & Content -->
        <v-stepper-header class="flex-shrink-0">
          <v-stepper-item 
            :complete="step > 1"
            :value="1"
            title="Select Format"
          />
          <v-divider />
          <v-stepper-item 
            :complete="step > 2"
            :value="2"
            title="Preview & Map"
          />
          <v-divider />
          <v-stepper-item 
            :value="3"
            title="Configure"
          />
        </v-stepper-header>
        
        <v-stepper-window class="flex-grow-1 overflow-auto">
          <!-- Step 1: Format Selection -->
          <v-stepper-window-item :value="1">
            <v-card-text>
              <v-select
                v-model="selectedFormat"
                :items="formatOptions"
                item-title="label"
                item-value="value"
                label="Import Format"
                variant="outlined"
                density="compact"
              >
                <template v-slot:item="{ props, item }">
                  <v-list-item v-bind="props">
                    <template v-slot:subtitle>
                      {{ item.raw.description }}
                    </template>
                  </v-list-item>
                </template>
              </v-select>

              <!-- File Input or Text Area based on format -->
              <div v-if="selectedFormat" class="mt-4">
                <v-file-input
                  v-if="!isTextFormat"
                  v-model="file"
                  :label="`Select ${formatLabels[selectedFormat]} file`"
                  :accept="acceptedFileTypes"
                  prepend-icon="mdi-file-document"
                  variant="outlined"
                  density="compact"
                  @change="readFile"
                />
                
                <v-textarea
                  v-else
                  v-model="textContent"
                  :label="`Paste ${formatLabels[selectedFormat]} content`"
                  variant="outlined"
                  rows="10"
                  placeholder="Name1: Message content...&#10;&#10;Name2: Response content..."
                />
              </div>

              <v-alert
                v-if="error"
                type="error"
                class="mt-4"
                dismissible
                @click:close="error = ''"
              >
                {{ error }}
              </v-alert>
            </v-card-text>

            <v-card-actions>
              <v-spacer />
              <v-btn
                variant="text"
                @click="close"
              >
                Cancel
              </v-btn>
              <v-btn
                :disabled="!canProceedToPreview"
                color="primary"
                variant="elevated"
                @click="previewImport"
              >
                Preview
              </v-btn>
            </v-card-actions>
          </v-stepper-window-item>

          <!-- Step 2: Preview & Participant Mapping -->
          <v-stepper-window-item :value="2">
            <v-card-text v-if="preview">
              <h4 class="text-h6 mb-4">Preview</h4>
              
              <!-- Participant Mapping -->
              <div class="mb-4">
                <div class="d-flex align-center mb-2">
                  <h5 class="text-subtitle-1">Participants</h5>
                  <v-spacer />
                  <v-btn
                    v-if="isTextFormat"
                    size="small"
                    variant="tonal"
                    color="primary"
                    :loading="reparsingPreview"
                    @click="reparseWithCurrentParticipants"
                  >
                    <v-icon start size="small">mdi-refresh</v-icon>
                    Re-parse
                  </v-btn>
                </div>
                
                <p v-if="isTextFormat" class="text-caption text-grey mb-3">
                  Edit participant names or delete false positives, then click "Re-parse" to update the preview.
                  Only text matching these participant names will be parsed as message headers.
                </p>
                
                <v-row
                  v-for="(mapping, index) in editableParticipants"
                  :key="index"
                  dense
                  class="mb-2 align-center"
                >
                  <v-col cols="3">
                    <v-text-field
                      v-model="mapping.sourceName"
                      label="From (in transcript)"
                      variant="outlined"
                      density="compact"
                      :readonly="!isTextFormat"
                      :hint="isTextFormat ? 'Name as it appears in transcript' : ''"
                    />
                  </v-col>
                  <v-col cols="3">
                    <v-text-field
                      v-model="mapping.targetName"
                      label="To (display name)"
                      variant="outlined"
                      density="compact"
                    />
                  </v-col>
                  <v-col cols="3">
                    <v-select
                      v-model="mapping.type"
                      :items="['user', 'assistant']"
                      label="Type"
                      variant="outlined"
                      density="compact"
                    />
                  </v-col>
                  <v-col cols="2" class="text-center">
                    <span class="text-caption text-grey">
                      {{ getMessageCountForParticipant(mapping.sourceName) }} msgs
                    </span>
                  </v-col>
                  <v-col cols="1">
                    <v-btn
                      icon
                      size="small"
                      variant="text"
                      color="error"
                      :disabled="editableParticipants.length <= 1"
                      @click="removeParticipant(index)"
                    >
                      <v-icon size="small">mdi-delete</v-icon>
                    </v-btn>
                  </v-col>
                </v-row>
                
                <v-btn
                  v-if="isTextFormat"
                  size="small"
                  variant="text"
                  color="primary"
                  class="mt-2"
                  @click="addParticipant"
                >
                  <v-icon start size="small">mdi-plus</v-icon>
                  Add Participant
                </v-btn>
              </div>

              <!-- Message Preview -->
              <v-expansion-panels>
                <v-expansion-panel>
                  <v-expansion-panel-title>
                    Preview Messages ({{ preview.messages.length }})
                  </v-expansion-panel-title>
                  <v-expansion-panel-text>
                    <div
                      v-for="(msg, index) in preview.messages.slice(0, 10)"
                      :key="index"
                      class="mb-3 pa-2 rounded"
                      :class="msg.role === 'user' ? 'bg-blue-lighten-5' : 'bg-grey-lighten-4'"
                    >
                      <div class="d-flex align-center mb-1">
                        <v-chip
                          :color="msg.role === 'user' ? 'primary' : 'secondary'"
                          size="small"
                          class="mr-2"
                        >
                          {{ msg.participantName || msg.role }}
                        </v-chip>
                        <span v-if="msg.timestamp" class="text-caption text-grey">
                          {{ formatDate(msg.timestamp) }}
                        </span>
                      </div>
                      <div class="text-body-2 message-content">
                        {{ msg.content }}
                      </div>
                    </div>
                    <div v-if="preview.messages.length > 10" class="text-caption text-grey text-center">
                      ... and {{ preview.messages.length - 10 }} more messages
                    </div>
                  </v-expansion-panel-text>
                </v-expansion-panel>
              </v-expansion-panels>
            </v-card-text>

            <v-card-actions>
              <v-btn
                variant="text"
                @click="step = 1"
              >
                Back
              </v-btn>
              <v-spacer />
              <v-btn
                variant="text"
                @click="close"
              >
                Cancel
              </v-btn>
              <v-btn
                color="primary"
                variant="elevated"
                @click="step = 3"
              >
                Continue
              </v-btn>
            </v-card-actions>
          </v-stepper-window-item>

          <!-- Step 3: Configuration -->
          <v-stepper-window-item :value="3">
            <v-card-text>
              <v-text-field
                v-model="conversationTitle"
                label="Conversation Title"
                variant="outlined"
                density="compact"
              />

              <v-select
                v-model="conversationFormat"
                :items="conversationFormatOptions"
                item-title="label"
                item-value="value"
                label="Conversation Format"
                variant="outlined"
                density="compact"
                class="mt-4"
              >
                <template v-slot:item="{ props, item }">
                  <v-list-item v-bind="props">
                    <template v-slot:subtitle>
                      {{ item.raw.description }}
                    </template>
                  </v-list-item>
                </template>
              </v-select>

              <!-- Only show model selector for standard (1-on-1) format -->
              <!-- Group chats get models from participant mappings -->
              <v-select
                v-if="conversationFormat === 'standard'"
                v-model="selectedModel"
                :items="activeModels"
                item-title="displayName"
                item-value="id"
                label="Model"
                variant="outlined"
                density="compact"
                class="mt-4"
              />

              <v-alert
                v-if="conversationFormat === 'prefill' && hasMultipleParticipants"
                type="info"
                density="compact"
                class="mt-4"
              >
                Group chat detected. Participant models will be preserved from the import.
              </v-alert>
            </v-card-text>

            <v-card-actions>
              <v-btn
                variant="text"
                @click="step = 2"
              >
                Back
              </v-btn>
              <v-spacer />
              <v-btn
                variant="text"
                @click="close"
              >
                Cancel
              </v-btn>
              <v-btn
                :loading="loading"
                :disabled="conversationFormat === 'standard' && !selectedModel"
                color="primary"
                variant="elevated"
                @click="executeImport"
              >
                Import
              </v-btn>
            </v-card-actions>
          </v-stepper-window-item>
        </v-stepper-window>
      </v-stepper>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useStore } from '@/store';
import { useRouter } from 'vue-router';
import { api } from '@/services/api';
import type { 
  ImportFormat, 
  ImportPreview, 
  ParticipantMapping,
  Model 
} from '@deprecated-claude/shared';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const store = useStore();
const router = useRouter();

// Step control
const step = ref(1);

// Step 1: Format selection
const selectedFormat = ref<ImportFormat | null>(null);
const file = ref<File | null>(null);
const textContent = ref('');
const fileContent = ref('');

// Step 2: Preview
const preview = ref<ImportPreview | null>(null);
const participantMappings = ref<Record<string, ParticipantMapping>>({});
const editableParticipants = ref<Array<{ sourceName: string; targetName: string; type: 'user' | 'assistant' }>>([]);
const reparsingPreview = ref(false);

// Step 3: Configuration
const conversationTitle = ref('');
const conversationFormat = ref<'standard' | 'prefill'>('standard');
const selectedModel = ref('');

// UI state
const error = ref('');
const loading = ref(false);

// Format options
const formatOptions = [
  {
    value: 'chrome_extension',
    label: 'Claude Conversation Exporter',
    description: 'Export from our Claude Conversation Exporter Chrome extension'
  },
  {
    value: 'arc_chat',
    label: 'Arc Chat',
    description: 'Export from Arc Chat (this app)'
  },
  {
    value: 'cursor',
    label: 'Cursor IDE (Markdown)',
    description: 'Markdown export from Cursor composer/chat'
  },
  {
    value: 'cursor_json',
    label: 'Cursor IDE (JSON)',
    description: 'JSON export with chain-of-thought and tool calls'
  },
  {
    value: 'anthropic',
    label: 'Anthropic/Claude.ai',
    description: 'Export from Claude.ai or Anthropic API'
  },
  {
    value: 'basic_json',
    label: 'Basic JSON',
    description: 'Simple {"messages": [...]} format'
  },
  {
    value: 'openai',
    label: 'OpenAI/ChatGPT',
    description: 'Export from ChatGPT'
  },
  {
    value: 'colon_single',
    label: 'Colon Format (Single Line)',
    description: 'Name: message\\nName: message'
  },
  {
    value: 'colon_double',
    label: 'Colon Format (Double Line)',
    description: 'Name: message\\n\\nName: message'
  }
];

const formatLabels: Record<string, string> = {
  basic_json: 'JSON',
  anthropic: 'Anthropic',
  chrome_extension: 'Claude Conversation Exporter',
  arc_chat: 'Arc Chat',
  cursor: 'Cursor (Markdown)',
  cursor_json: 'Cursor (JSON)',
  openai: 'OpenAI',
  colon_single: 'text',
  colon_double: 'text'
};

const conversationFormatOptions = [
  {
    value: 'standard',
    label: 'Standard',
    description: 'Traditional user/assistant format'
  },
  {
    value: 'prefill',
    label: 'Group Chat',
    description: 'Supports multiple participants with custom names'
  }
];

// Computed properties
const models = computed(() => store.state.models);

const activeModels = computed(() => {
  return models.value.filter(m => !m.hidden);
});

const isTextFormat = computed(() => 
  selectedFormat.value === 'colon_single' || 
  selectedFormat.value === 'colon_double'
);

const acceptedFileTypes = computed(() => {
  if (selectedFormat.value === 'basic_json' || 
      selectedFormat.value === 'anthropic' ||
      selectedFormat.value === 'chrome_extension' ||
      selectedFormat.value === 'arc_chat' ||
      selectedFormat.value === 'openai' ||
      selectedFormat.value === 'cursor_json') {
    return '.json,application/json';
  }
  if (selectedFormat.value === 'cursor') {
    return '.md,.markdown,text/markdown';
  }
  return '.txt,text/plain';
});

const canProceedToPreview = computed(() => {
  if (!selectedFormat.value) return false;
  if (isTextFormat.value) return textContent.value.trim().length > 0;
  return fileContent.value.length > 0;
});

const hasMultipleParticipants = computed(() => 
  (preview.value?.detectedParticipants.length || 0) > 2
);

// Methods
async function readFile() {
  if (!file.value) return;
  
  try {
    fileContent.value = await file.value.text();
  } catch (err: any) {
    error.value = 'Failed to read file';
    fileContent.value = '';
  }
}

async function previewImport() {
  if (!selectedFormat.value) return;
  
  loading.value = true;
  error.value = '';
  
  try {
    // Ensure models are loaded before preview
    if (models.value.length === 0) {
      await store.loadModels();
    }
    
    const content = isTextFormat.value ? textContent.value : fileContent.value;
    
    const response = await api.post('/import/preview', {
      format: selectedFormat.value,
      content
    });
    
    preview.value = response.data;
    
    // Initialize participant mappings and editable list
    participantMappings.value = {};
    editableParticipants.value = [];
    for (const participant of preview.value.detectedParticipants) {
      const mapping = {
        sourceName: participant.name,
        targetName: participant.name,
        type: (participant.role === 'unknown' ? 'user' : participant.role) as 'user' | 'assistant'
      };
      participantMappings.value[participant.name] = mapping;
      editableParticipants.value.push(mapping);
    }
    
    // Set suggested values
    conversationTitle.value = preview.value.title || 'Imported Conversation';
    conversationFormat.value = preview.value.suggestedFormat;
    
    // For Arc Chat format, get model from participants or conversation
    if (selectedFormat.value === 'arc_chat') {
      // Use conversation format from metadata
      if (preview.value.metadata?.conversation?.format) {
        conversationFormat.value = preview.value.metadata.conversation.format;
      }
      
      // Get primary model from participants or conversation
      const participants = preview.value.metadata?.participants || [];
      const assistantParticipant = participants.find((p: any) => p.type === 'assistant');
      const importedModel = assistantParticipant?.model || preview.value.metadata?.conversation?.model;
      
      if (importedModel) {
        const matchingModel = models.value.find(m => m.id === importedModel);
        if (matchingModel) {
          selectedModel.value = matchingModel.id;
        }
      }
    } else {
      // Try to match the model from the import metadata for other formats
      const importedModel = preview.value.metadata?.model;
      if (importedModel) {
        // Check if we have a direct match by ID
        const matchingModel = models.value.find(m => m.id === importedModel);
        if (matchingModel) {
          selectedModel.value = matchingModel.id;
        } else {
          // Try to find a partial match (e.g., 'claude-sonnet-4' in 'claude-sonnet-4-20250514')
          const partialMatch = models.value.find(m => 
            m.id.includes(importedModel) || importedModel.includes(m.id)
          );
          if (partialMatch) {
            selectedModel.value = partialMatch.id;
          } else {
            // Default to first model if no match found
            selectedModel.value = models.value[0]?.id || '';
          }
        }
      } else {
        // Default to first model if no model specified
        selectedModel.value = models.value[0]?.id || '';
      }
    }
    
    step.value = 2;
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to preview import';
  } finally {
    loading.value = false;
  }
}

async function executeImport() {
  if (!selectedFormat.value || !preview.value) return;
  
  loading.value = true;
  error.value = '';
  
  try {
    const content = isTextFormat.value ? textContent.value : fileContent.value;
    
    // For text formats, pass allowed participants to re-parse on server
    // This ensures the final import uses the same parsing as the preview
    const allowedParticipants = isTextFormat.value 
      ? editableParticipants.value.map(p => p.sourceName)
      : undefined;
    
    const response = await api.post('/import/execute', {
      format: selectedFormat.value,
      content,
      participantMappings: editableParticipants.value.map(p => ({
        sourceName: p.sourceName,
        targetName: p.targetName,
        type: p.type
      })),
      allowedParticipants, // Pass to server for re-parsing
      conversationFormat: conversationFormat.value,
      title: conversationTitle.value,
      // Only include model for standard format - group chats derive from participants
      ...(conversationFormat.value === 'standard' && selectedModel.value && { model: selectedModel.value })
    });
    
    // Reload conversations to include the new one
    await store.loadConversations();
    
    // Navigate to the imported conversation
    router.push(`/conversation/${response.data.conversationId}`);
    close();
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to import conversation';
  } finally {
    loading.value = false;
  }
}

function formatDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleString();
}

// Get message count for a participant from current preview
function getMessageCountForParticipant(sourceName: string): number {
  if (!preview.value) return 0;
  return preview.value.messages.filter(m => m.participantName === sourceName).length;
}

// Add a new participant
function addParticipant() {
  const newName = `Participant ${editableParticipants.value.length + 1}`;
  editableParticipants.value.push({
    sourceName: newName,
    targetName: newName,
    type: 'user'
  });
}

// Remove a participant
function removeParticipant(index: number) {
  editableParticipants.value.splice(index, 1);
}

// Re-parse the transcript with current participant names
async function reparseWithCurrentParticipants() {
  if (!selectedFormat.value) return;
  
  reparsingPreview.value = true;
  error.value = '';
  
  try {
    const content = isTextFormat.value ? textContent.value : fileContent.value;
    
    // Get the list of source names from editable participants
    const allowedParticipants = editableParticipants.value.map(p => p.sourceName);
    
    const response = await api.post('/import/preview', {
      format: selectedFormat.value,
      content,
      allowedParticipants
    });
    
    // Update preview with new parsing
    preview.value = response.data;
    
    // Keep the editable participants as-is (user may have edited names/types)
    // but update message counts by matching source names
    // Note: New participants detected won't be added automatically
    // The user has full control over the participant list now
    
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to re-parse import';
  } finally {
    reparsingPreview.value = false;
  }
}

function close() {
  step.value = 1;
  selectedFormat.value = null;
  file.value = null;
  textContent.value = '';
  fileContent.value = '';
  preview.value = null;
  participantMappings.value = {};
  editableParticipants.value = [];
  conversationTitle.value = '';
  conversationFormat.value = 'standard';
  selectedModel.value = '';
  error.value = '';
  emit('update:modelValue', false);
}

// Load models when dialog opens
watch(() => props.modelValue, async (isOpen) => {
  if (isOpen && models.value.length === 0) {
    await store.loadModels();
  }
});
</script>

<style scoped>
.message-content {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}
</style>
