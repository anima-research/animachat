<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="1200"
    scrollable
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-bug</v-icon>
        Debug: LLM Request & Response
        <v-spacer />
        <v-btn
          icon="mdi-close"
          variant="text"
          @click="$emit('update:modelValue', false)"
        />
      </v-card-title>

      <v-card-text class="pa-0">
        <!-- Loading state -->
        <div v-if="isLoading" class="text-center py-8">
          <v-progress-circular indeterminate color="primary" />
          <p class="mt-4 text-grey">Loading debug data...</p>
        </div>
        
        <!-- Error state -->
        <div v-else-if="loadError" class="text-center py-8">
          <v-icon size="64" color="error">mdi-alert-circle</v-icon>
          <p class="mt-4 text-error">{{ loadError }}</p>
        </div>
        
        <!-- Content -->
        <template v-else>
          <v-tabs v-model="activeTab">
            <v-tab value="request">
              <v-icon start>mdi-export</v-icon>
              Request
            </v-tab>
            <v-tab value="response">
              <v-icon start>mdi-import</v-icon>
              Response
            </v-tab>
          </v-tabs>

          <v-window v-model="activeTab">
            <!-- Request Tab -->
            <v-window-item value="request" class="pa-4">
              <div v-if="!debugRequest" class="text-center text-grey py-8">
                <v-icon size="64" color="grey-lighten-1">mdi-information-outline</v-icon>
                <p class="mt-4">No debug request data available for this message.</p>
                <p class="text-caption">Debug data is only captured for new messages.</p>
              </div>
            <div v-else>
              <div class="d-flex mb-2">
                <v-chip size="small" class="mr-2">
                  <v-icon start size="small">mdi-server</v-icon>
                  {{ debugRequest.provider }}
                </v-chip>
                <v-chip size="small">
                  <v-icon start size="small">mdi-robot</v-icon>
                  {{ debugRequest.model }}
                </v-chip>
                <v-spacer />
                <v-btn
                  size="small"
                  variant="text"
                  prepend-icon="mdi-content-copy"
                  @click="copyToClipboard(JSON.stringify(debugRequest, null, 2))"
                >
                  Copy
                </v-btn>
              </div>
              <v-card variant="outlined" class="code-card">
                <pre class="code-content">{{ formatJSON(debugRequest) }}</pre>
              </v-card>
            </div>
          </v-window-item>

          <!-- Response Tab -->
          <v-window-item value="response" class="pa-4">
            <div v-if="!debugResponse" class="text-center text-grey py-8">
              <v-icon size="64" color="grey-lighten-1">mdi-information-outline</v-icon>
              <p class="mt-4">No debug response data available for this message.</p>
            </div>
            <div v-else>
              <div class="d-flex mb-2">
                <v-chip size="small">
                  <v-icon start size="small">mdi-robot</v-icon>
                  {{ debugResponse.model || 'Unknown Model' }}
                </v-chip>
                <v-spacer />
                <v-btn
                  size="small"
                  variant="text"
                  prepend-icon="mdi-content-copy"
                  @click="copyToClipboard(JSON.stringify(debugResponse, null, 2))"
                >
                  Copy
                </v-btn>
              </div>
              <v-card variant="outlined" class="code-card">
                <pre class="code-content">{{ formatJSON(debugResponse) }}</pre>
              </v-card>
            </div>
          </v-window-item>
          </v-window>
        </template>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">
          Close
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '@/services/api';

const props = defineProps<{
  modelValue: boolean;
  conversationId: string;
  messageId: string;
  branchId: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const activeTab = ref('request');
const isLoading = ref(false);
const loadError = ref<string | null>(null);
const debugRequest = ref<any>(null);
const debugResponse = ref<any>(null);

// Fetch debug data when dialog opens
watch(() => props.modelValue, async (isOpen) => {
  if (isOpen && props.conversationId && props.messageId && props.branchId) {
    isLoading.value = true;
    loadError.value = null;
    debugRequest.value = null;
    debugResponse.value = null;
    
    try {
      const response = await api.get(
        `/conversations/${props.conversationId}/messages/${props.messageId}/branches/${props.branchId}/debug`
      );
      debugRequest.value = response.data.debugRequest;
      debugResponse.value = response.data.debugResponse;
    } catch (error: any) {
      console.error('Failed to load debug data:', error);
      loadError.value = error.response?.data?.error || 'Failed to load debug data';
    } finally {
      isLoading.value = false;
    }
  }
}, { immediate: true });

function truncateLongStrings(obj: any, path: string = '', parentKey: string = ''): any {
  if (typeof obj === 'string') {
    // Detect base64 data in attachment tags: <attachment...>base64data</attachment>
    const attachmentMatch = obj.match(/<attachment[^>]*>\n([A-Za-z0-9+/=\n\r]+)\n<\/attachment>/);
    if (attachmentMatch && attachmentMatch[1].length > 500) {
      const base64Data = attachmentMatch[1];
      const truncated = base64Data.substring(0, 200);
      return obj.replace(attachmentMatch[1], truncated + '\n... [base64 truncated: ' + (base64Data.length - 200) + ' chars] ...\n');
    }

    // Also truncate standalone base64 (pure base64 strings over 1000 chars)
    const looksLikeBase64 = obj.length > 1000 && /^[A-Za-z0-9+/=\n\r\s]+$/.test(obj);
    if (looksLikeBase64) {
      return obj.substring(0, 500) + '\n... [base64 data truncated: ' + (obj.length - 500) + ' chars] ...\n';
    }

    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item, index) => truncateLongStrings(item, `${path}[${index}]`, ''));
  }

  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = truncateLongStrings(value, `${path}.${key}`, key);
    }
    return result;
  }

  return obj;
}

function formatJSON(obj: any): string {
  if (!obj) return '';

  try {
    // First truncate long strings (like base64 image data)
    const truncated = truncateLongStrings(obj, '');

    // Convert to JSON string with indentation
    let jsonStr = JSON.stringify(truncated, null, 2);

    // Unescape newlines and tabs for better readability
    // In JSON.stringify, \n becomes \\n (escaped), so we need to replace \\n with actual newline
    jsonStr = jsonStr.replace(/\\n/g, '\n');
    jsonStr = jsonStr.replace(/\\t/g, '\t');

    return jsonStr;
  } catch (error) {
    return 'Error formatting JSON: ' + error;
  }
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    // Could add a snackbar notification here
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
  }
}
</script>

<style scoped>
.code-card {
  background-color: #1e1e1e;
  max-height: 600px;
  overflow: auto;
}

.code-content {
  margin: 0;
  padding: 16px;
  font-family: 'Courier New', Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
  color: #d4d4d4;
}
</style>
