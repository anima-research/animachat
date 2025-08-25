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
      
      <v-tabs v-model="tab">
        <v-tab value="api-keys">API Keys</v-tab>
        <v-tab value="appearance">Appearance</v-tab>
        <v-tab value="about">About</v-tab>
      </v-tabs>
      
      <v-window v-model="tab">
        <!-- API Keys Tab -->
        <v-window-item value="api-keys">
          <v-card-text>
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
            
            <v-text-field
              v-model="newKey.key"
              label="API Key"
              type="password"
              variant="outlined"
              density="compact"
              class="mt-2"
            />
            
            <v-btn
              :disabled="!newKey.name || !newKey.provider || !newKey.key"
              color="primary"
              variant="elevated"
              @click="addApiKey"
            >
              Add Key
            </v-btn>
          </v-card-text>
        </v-window-item>
        
        <!-- Appearance Tab -->
        <v-window-item value="appearance">
          <v-card-text>
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
          <v-card-text>
            <h4 class="text-h6 mb-2">Deprecated Claude Models</h4>
            <p class="text-body-2 mb-4">
              Version 1.0.0
            </p>
            
            <p class="text-body-2 mb-4">
              This application allows you to continue using deprecated Claude models through AWS Bedrock or your own API keys.
            </p>
            
            <h5 class="text-subtitle-1 mb-2">Features</h5>
            <ul class="text-body-2 mb-4">
              <li>Import conversations from claude.ai</li>
              <li>Conversation branching and forking</li>
              <li>Stepped rolling context for prompt caching</li>
              <li>Export conversations for backup</li>
              <li>Use your own API keys or pay at cost</li>
            </ul>
            
            <h5 class="text-subtitle-1 mb-2">Available Models</h5>
            <ul class="text-body-2">
              <li v-for="model in models" :key="model.id">
                <strong>{{ model.displayName }}</strong>
                <v-chip 
                  size="x-small" 
                  class="ml-2"
                  :color="model.provider === 'anthropic' ? 'primary' : 'secondary'"
                >
                  {{ model.provider === 'anthropic' ? 'Anthropic API' : 'AWS Bedrock' }}
                </v-chip>
                <span v-if="model.deprecated" class="text-orange ml-1">(Deprecated)</span>
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
import { api } from '@/services/api';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const store = useStore();
const theme = useTheme();

const tab = ref('api-keys');
const apiKeys = ref<any[]>([]);
const models = computed(() => store.state.models);

const newKey = ref({
  name: '',
  provider: 'bedrock',
  key: ''
});

const providers = ['bedrock', 'anthropic'];
const codeThemes = ['github', 'monokai', 'dracula', 'vs-dark'];

const darkMode = ref(theme.global.current.value.dark);
const codeTheme = ref(localStorage.getItem('codeTheme') || 'github');

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

async function addApiKey() {
  try {
    const response = await api.post('/auth/api-keys', newKey.value);
    apiKeys.value.push(response.data);
    
    // Reset form
    newKey.value = {
      name: '',
      provider: 'bedrock',
      key: ''
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

// Load data when dialog opens
watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    loadApiKeys();
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
