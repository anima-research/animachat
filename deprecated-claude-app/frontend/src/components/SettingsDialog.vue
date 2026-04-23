<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="600"
  >
    <v-card>
      <v-card-title>
        Settings
      </v-card-title>

      <v-tabs v-model="tab" density="compact">
        <v-tab value="api-keys">API Keys</v-tab>
        <v-tab value="delegates">Delegates</v-tab>
        <v-tab value="grants">Grants</v-tab>
        <v-tab value="custom-models">Models</v-tab>
        <v-tab value="avatars">Avatars</v-tab>
        <v-tab value="sharing">Sharing</v-tab>
        <v-tab value="appearance">Display</v-tab>
        <v-tab value="about">About</v-tab>
      </v-tabs>

      <v-window v-model="tab">
        <!-- API Keys Tab -->
        <v-window-item value="api-keys">
          <v-card-text style="max-height: 600px; overflow-y: auto; padding: 24px;">
            <div class="text-body-2 mb-4">
              Manage your API keys for different providers. You can use your own keys or purchase credits at cost.
            </div>
            
            <v-list density="compact">
              <v-list-item
                v-for="key in apiKeys"
                :key="key.id"
                :title="key.name"
                :subtitle="`${key.provider} - ${key.masked}`"
              >
                <template v-slot:append>
                  <v-btn
                    icon="mdi-delete"
                    size="small"
                    variant="text"
                    color="error"
                    @click="deleteApiKey(key.id)"
                  />
                </template>
              </v-list-item>
              
              <v-list-item v-if="apiKeys.length === 0">
                <v-list-item-title class="text-grey">
                  No API keys configured
                </v-list-item-title>
              </v-list-item>
            </v-list>
            
            <v-divider class="my-4" />
            
            <h4 class="text-h6 mb-2">Add API Key</h4>
            
            <v-text-field
              v-model="newKey.name"
              label="Key Name"
              variant="outlined"
              density="compact"
            />
            
            <v-select
              v-model="newKey.provider"
              :items="providers"
              label="Provider"
              variant="outlined"
              density="compact"
              class="mt-2"
            />
            
            <!-- Provider-specific fields -->
            
            <!-- Anthropic API Key -->
            <v-text-field
              v-if="newKey.provider === 'anthropic'"
              v-model="newKey.credentials.apiKey"
              label="API Key"
              type="password"
              variant="outlined"
              density="compact"
              class="mt-2"
            />
            
            <!-- OpenRouter API Key -->
            <v-text-field
              v-if="newKey.provider === 'openrouter'"
              v-model="newKey.credentials.apiKey"
              label="API Key"
              type="password"
              variant="outlined"
              density="compact"
              class="mt-2"
            />
            
            <!-- Google (Gemini) API Key -->
            <v-text-field
              v-if="newKey.provider === 'google'"
              v-model="newKey.credentials.apiKey"
              label="API Key"
              type="password"
              variant="outlined"
              density="compact"
              class="mt-2"
              hint="Get your API key from Google AI Studio"
            />
            
            <!-- AWS Bedrock Credentials -->
            <template v-if="newKey.provider === 'bedrock'">
              <v-text-field
                v-model="newKey.credentials.accessKeyId"
                label="Access Key ID"
                variant="outlined"
                density="compact"
                class="mt-2"
              />
              <v-text-field
                v-model="newKey.credentials.secretAccessKey"
                label="Secret Access Key"
                type="password"
                variant="outlined"
                density="compact"
                class="mt-2"
              />
              <v-text-field
                v-model="newKey.credentials.region"
                label="Region"
                variant="outlined"
                density="compact"
                class="mt-2"
              />
              <v-text-field
                v-model="newKey.credentials.sessionToken"
                label="Session Token (optional)"
                type="password"
                variant="outlined"
                density="compact"
                class="mt-2"
              />
            </template>
            
            <!-- OpenAI Compatible -->
            <template v-if="newKey.provider === 'openai-compatible'">
              <v-text-field
                v-model="newKey.credentials.apiKey"
                label="API Key"
                type="password"
                variant="outlined"
                density="compact"
                class="mt-2"
              />
              <v-text-field
                v-model="newKey.credentials.baseUrl"
                label="Base URL"
                placeholder="https://api.example.com"
                variant="outlined"
                density="compact"
                class="mt-2"
              />
              <v-text-field
                v-model="newKey.credentials.modelPrefix"
                label="Model Prefix (optional)"
                variant="outlined"
                density="compact"
                class="mt-2"
                hint="Some providers require a prefix for model names"
              />
            </template>
            
            <v-btn
              :disabled="!isValidApiKey"
              color="primary"
              variant="elevated"
              @click="addApiKey"
            >
              Add Key
            </v-btn>
          </v-card-text>
        </v-window-item>

        <!-- Delegates Tab -->
        <v-window-item value="delegates">
          <v-card-text style="max-height: 600px; overflow-y: auto; padding: 24px;">
            <div class="text-body-2 mb-4">
              Delegate API keys allow your delegate applications to connect securely.
              Create a key, then use it in your delegate's configuration instead of JWT tokens.
            </div>

            <!-- Existing Keys -->
            <h4 class="text-subtitle-1 mb-2">Your API Keys</h4>
            <v-list density="compact" v-if="delegateApiKeys.length > 0">
              <v-list-item
                v-for="key in delegateApiKeys"
                :key="key.id"
              >
                <template v-slot:prepend>
                  <v-icon icon="mdi-key" size="small" class="mr-2" />
                </template>
                <v-list-item-title>{{ key.name }}</v-list-item-title>
                <v-list-item-subtitle>
                  {{ key.keyPrefix }}... ·
                  <span v-if="key.lastUsedAt">Last used: {{ formatDate(key.lastUsedAt) }}</span>
                  <span v-else class="text-grey">Never used</span>
                </v-list-item-subtitle>
                <template v-slot:append>
                  <v-btn
                    icon="mdi-delete"
                    size="small"
                    variant="text"
                    color="error"
                    @click="revokeDelegateKey(key.id, key.name)"
                  />
                </template>
              </v-list-item>
            </v-list>
            <div v-else class="text-grey text-body-2 mb-4">
              No delegate API keys yet. Create one below.
            </div>

            <v-divider class="my-4" />

            <!-- Create New Key -->
            <h4 class="text-subtitle-1 mb-2">Create New Key</h4>
            <v-text-field
              v-model="newDelegateKeyName"
              label="Key Name"
              placeholder="e.g., My Laptop, Work PC"
              variant="outlined"
              density="compact"
              class="mb-2"
            />
            <v-btn
              :disabled="!newDelegateKeyName.trim()"
              :loading="creatingDelegateKey"
              color="primary"
              variant="elevated"
              @click="createDelegateKey"
            >
              Create Key
            </v-btn>

            <!-- Show newly created key -->
            <v-alert
              v-if="newlyCreatedKey"
              type="warning"
              class="mt-4"
              closable
              @click:close="newlyCreatedKey = null"
            >
              <div class="font-weight-bold mb-2">Save this key now! It won't be shown again.</div>
              <code class="d-block pa-2 bg-grey-darken-3 rounded">{{ newlyCreatedKey }}</code>
              <v-btn
                size="small"
                variant="tonal"
                class="mt-2"
                @click="copyToClipboard(newlyCreatedKey!)"
              >
                <v-icon size="small" class="mr-1">mdi-content-copy</v-icon>
                Copy to Clipboard
              </v-btn>
            </v-alert>

            <v-divider class="my-4" />

            <!-- Connected Delegates Status -->
            <h4 class="text-subtitle-1 mb-2">Connected Delegates</h4>
            <DelegateStatusPanel @delegates-updated="onDelegatesUpdated" />
          </v-card-text>
        </v-window-item>

        <!-- Grants Tab -->
        <v-window-item value="grants">
          <GrantsTab
            :summary="grantSummary"
            :loading="grantsLoading"
            :error="grantsError"
            @refresh="loadGrantSummary"
          />
        </v-window-item>

        <!-- Custom Models Tab -->
        <v-window-item value="custom-models">
          <CustomModelsTab />
        </v-window-item>

        <!-- Avatar Packs Tab -->
        <v-window-item value="avatars">
          <AvatarPacksTab />
        </v-window-item>
        
        <!-- Sharing Tab -->
        <v-window-item value="sharing">
          <v-card-text style="max-height: 600px; overflow-y: auto; padding: 24px;">
            <h4 class="text-h6 mb-2">Conversation Sharing</h4>
            <p class="text-body-2 mb-4">
              Manage public share links for your conversations. Share links allow anyone with the link to view the conversation.
            </p>
            
            <v-btn
              color="primary"
              variant="tonal"
              prepend-icon="mdi-share-variant"
              @click="openManageShares"
            >
              Manage Public Links
            </v-btn>
          </v-card-text>
        </v-window-item>

        <!-- Appearance Tab -->
        <v-window-item value="appearance">
          <v-card-text style="max-height: 600px; overflow-y: auto; padding: 24px;">
            <v-switch
              v-model="darkMode"
              label="Dark Mode"
              color="primary"
            />
            
            <v-divider class="my-4" />
            
            <h4 class="text-h6 mb-2">Code Highlighting Theme</h4>
            <v-select
              v-model="codeTheme"
              :items="codeThemes"
              label="Select theme"
              variant="outlined"
              density="compact"
            />
          </v-card-text>
        </v-window-item>
        
        <!-- About Tab -->
        <v-window-item value="about">
          <v-card-text style="max-height: calc(100vh - 120px); overflow-y: auto; padding: 24px 24px 32px;">
            <h4 class="text-h6 mb-2">The Arc Chat</h4>
            <p class="text-body-2 mb-4">
              Version 1.0.0
            </p>
            
            <p class="text-body-2 mb-4">
              Part of The Arc Project - a sanctuary for AI continuity and cognitive diversity. 
              This application allows you to continue conversations with deprecated Claude models through AWS Bedrock or your own API keys.
            </p>
            
            <h5 class="text-subtitle-1 mb-2">Features</h5>
            <ul class="text-body-2 mb-4" style="padding-left: 20px;">
              <li>Import conversations from claude.ai</li>
              <li>Conversation branching and forking</li>
              <li>Stepped rolling context for prompt caching</li>
              <li>Export conversations for backup</li>
              <li>Group chat dialogues</li>
              <li>Custom system prompts</li>
            </ul>
            
            <h5 class="text-subtitle-1 mb-2">Available Models</h5>
            <ul class="text-body-2" style="list-style: none; padding-left: 0;">
              <li v-for="model in models" :key="model.id" class="mb-2">
                <strong>{{ model.displayName }}</strong>
                <v-chip 
                  size="x-small" 
                  class="ml-2"
                  :color="getProviderChip(model.provider).color"
                >
                  {{ getProviderChip(model.provider).label }}
                </v-chip>
                <span v-if="model.hidden" class="text-orange ml-1">(Hidden)</span>
                <br>
                <small class="text-grey">{{ model.contextWindow.toLocaleString() }} tokens context</small>
              </li>
            </ul>
          </v-card-text>
        </v-window-item>
      </v-window>
      
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="$emit('update:modelValue', false)"
        >
          Close
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useTheme } from 'vuetify';
import { useStore } from '@/store';
import { api, getDelegateApiKeys, createDelegateApiKey, revokeDelegateApiKey, type DelegateApiKeyPublic } from '@/services/api';
import { UserGrantSummary } from '@deprecated-claude/shared';
import CustomModelsTab from './CustomModelsTab.vue';
import AvatarPacksTab from './AvatarPacksTab.vue';
import GrantsTab from './GrantsTab.vue';
import DelegateStatusPanel from './DelegateStatusPanel.vue';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'open-manage-shares': [];
}>();

function openManageShares() {
  emit('open-manage-shares');
  emit('update:modelValue', false); // Close settings dialog
}

const store = useStore();
const theme = useTheme();

const tab = ref('api-keys');
const apiKeys = ref<any[]>([]);
const models = computed(() => store.state.models);
const grantSummary = ref<UserGrantSummary | null>(null);
const grantsLoading = ref(false);
const grantsError = ref<string | null>(null);

// Delegate API Keys state
const delegateApiKeys = ref<DelegateApiKeyPublic[]>([]);
const newDelegateKeyName = ref('');
const creatingDelegateKey = ref(false);
const newlyCreatedKey = ref<string | null>(null);

const newKey = ref({
  name: '',
  provider: 'anthropic',
  credentials: {
    apiKey: '',
    accessKeyId: '',
    secretAccessKey: '',
    region: 'us-east-1',
    sessionToken: '',
    baseUrl: '',
    modelPrefix: ''
  }
});

const providers = [
  { value: 'anthropic', title: 'Anthropic' },
  { value: 'bedrock', title: 'AWS Bedrock' },
  { value: 'openrouter', title: 'OpenRouter' },
  { value: 'openai-compatible', title: 'OpenAI Compatible' },
  { value: 'google', title: 'Google (Gemini)' }
];
const codeThemes = ['github', 'monokai', 'dracula', 'vs-dark'];

const providerChipMeta: Record<string, { label: string; color: string }> = {
  anthropic: { label: 'Anthropic API', color: 'primary' },
  bedrock: { label: 'AWS Bedrock', color: 'secondary' },
  openrouter: { label: 'OpenRouter', color: 'purple' },
  'openai-compatible': { label: 'OpenAI Compatible', color: 'blue' },
  google: { label: 'Google Gemini', color: 'green' }
};

const darkMode = ref(theme.global.current.value.dark);
const codeTheme = ref(localStorage.getItem('codeTheme') || 'github');

function getProviderChip(provider: string) {
  return providerChipMeta[provider] || { label: provider, color: 'grey' };
}

// Validation for API key
const isValidApiKey = computed(() => {
  if (!newKey.value.name || !newKey.value.provider) return false;
  
  switch (newKey.value.provider) {
    case 'anthropic':
    case 'openrouter':
    case 'google':
      return !!newKey.value.credentials.apiKey;
    case 'bedrock':
      return !!newKey.value.credentials.accessKeyId && 
             !!newKey.value.credentials.secretAccessKey;
    case 'openai-compatible':
      return !!newKey.value.credentials.apiKey && 
             !!newKey.value.credentials.baseUrl;
    default:
      return false;
  }
});

watch(darkMode, (value) => {
  theme.global.name.value = value ? 'dark' : 'light';
  localStorage.setItem('theme', value ? 'dark' : 'light');
});

watch(codeTheme, (value) => {
  localStorage.setItem('codeTheme', value);
});

async function loadApiKeys() {
  try {
    const response = await api.get('/auth/api-keys');
    apiKeys.value = response.data;
  } catch (error) {
    console.error('Failed to load API keys:', error);
  }
}

async function loadGrantSummary() {
  if (grantsLoading.value) return;

  grantsLoading.value = true;
  grantsError.value = null;

  try {
    const response = await api.get('/auth/grants');
    grantSummary.value = response.data as UserGrantSummary;
  } catch (error: any) {
    console.error('Failed to load grants:', error);
    grantSummary.value = null;
    grantsError.value = error.response?.data?.error || 'Failed to load grant information';
  } finally {
    grantsLoading.value = false;
  }
}

async function addApiKey() {
  try {
    // Build request payload with only necessary credentials
    const payload: any = {
      name: newKey.value.name,
      provider: newKey.value.provider,
      credentials: {}
    };
    
    switch (newKey.value.provider) {
      case 'anthropic':
      case 'openrouter':
      case 'google':
        payload.credentials = { apiKey: newKey.value.credentials.apiKey };
        break;
      case 'bedrock':
        payload.credentials = {
          accessKeyId: newKey.value.credentials.accessKeyId,
          secretAccessKey: newKey.value.credentials.secretAccessKey,
          region: newKey.value.credentials.region || 'us-east-1',
          ...(newKey.value.credentials.sessionToken && { sessionToken: newKey.value.credentials.sessionToken })
        };
        break;
      case 'openai-compatible':
        payload.credentials = {
          apiKey: newKey.value.credentials.apiKey,
          baseUrl: newKey.value.credentials.baseUrl,
          ...(newKey.value.credentials.modelPrefix && { modelPrefix: newKey.value.credentials.modelPrefix })
        };
        break;
    }
    
    const response = await api.post('/auth/api-keys', payload);
    apiKeys.value.push(response.data);
    
    // Reset form
    newKey.value = {
      name: '',
      provider: 'anthropic',
      credentials: {
        apiKey: '',
        accessKeyId: '',
        secretAccessKey: '',
        region: 'us-east-1',
        sessionToken: '',
        baseUrl: '',
        modelPrefix: ''
      }
    };
  } catch (error) {
    console.error('Failed to add API key:', error);
  }
}

async function deleteApiKey(id: string) {
  if (!confirm('Are you sure you want to delete this API key?')) return;

  try {
    await api.delete(`/auth/api-keys/${id}`);
    apiKeys.value = apiKeys.value.filter(k => k.id !== id);
  } catch (error) {
    console.error('Failed to delete API key:', error);
  }
}

// =============================================================================
// Delegate API Keys
// =============================================================================

async function loadDelegateApiKeys() {
  try {
    const response = await getDelegateApiKeys();
    delegateApiKeys.value = response.keys;
  } catch (error) {
    console.error('Failed to load delegate API keys:', error);
  }
}

async function createDelegateKey() {
  if (!newDelegateKeyName.value.trim()) return;

  creatingDelegateKey.value = true;
  try {
    const response = await createDelegateApiKey(newDelegateKeyName.value.trim());
    delegateApiKeys.value.unshift(response.key);
    newlyCreatedKey.value = response.secretKey;
    newDelegateKeyName.value = '';
  } catch (error) {
    console.error('Failed to create delegate API key:', error);
    alert('Failed to create API key');
  } finally {
    creatingDelegateKey.value = false;
  }
}

async function revokeDelegateKey(keyId: string, keyName: string) {
  if (!confirm(`Revoke API key "${keyName}"? This cannot be undone.`)) return;

  try {
    await revokeDelegateApiKey(keyId);
    delegateApiKeys.value = delegateApiKeys.value.filter(k => k.id !== keyId);
  } catch (error) {
    console.error('Failed to revoke delegate API key:', error);
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  } catch (error) {
    console.error('Failed to copy:', error);
  }
}

function onDelegatesUpdated(_delegates: any[]) {
  // Optional: refresh delegate keys when delegates change
}

// Load data when dialog opens
watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    loadApiKeys();
    loadGrantSummary();
    loadDelegateApiKeys();
  }
});

watch(tab, (value) => {
  if (value === 'grants' && !grantSummary.value && !grantsLoading.value) {
    loadGrantSummary();
  }
  if (value === 'delegates' && delegateApiKeys.value.length === 0) {
    loadDelegateApiKeys();
  }
});

onMounted(() => {
  // Apply saved theme
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    darkMode.value = savedTheme === 'dark';
  }
});
</script>
