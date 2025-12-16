<template>
  <v-card-text style="max-height: calc(100vh - 220px); overflow-y: auto; padding: 24px 24px 32px;">
    <div class="text-body-2 mb-4">
      Avatar packs provide visual identities for AI models. Select an active pack to use its avatars in conversations.
    </div>
    
    <!-- Pack List -->
    <v-list density="compact">
      <v-list-item
        v-for="pack in packs"
        :key="pack.id"
        :title="pack.name"
        :subtitle="`${Object.keys(pack.avatars || {}).length} avatars • ${pack.isSystem ? 'System' : 'Custom'}${currentActivePackId === pack.id ? ' • Active' : ''}`"
        @click="selectPack(pack)"
        :class="{ 
          'v-list-item--active': selectedPack?.id === pack.id,
          'active-pack': currentActivePackId === pack.id 
        }"
      >
        <template v-slot:prepend>
          <v-avatar :color="currentActivePackId === pack.id ? 'success' : (pack.isSystem ? 'primary' : 'secondary')" size="32">
            <v-icon :icon="currentActivePackId === pack.id ? 'mdi-check' : (pack.isSystem ? 'mdi-package-variant' : 'mdi-palette')" size="18" />
          </v-avatar>
        </template>
        
        <template v-slot:append>
          <v-btn
            v-if="currentActivePackId !== pack.id"
            variant="tonal"
            size="small"
            color="success"
            @click.stop="activatePack(pack)"
            title="Use this pack"
          >
            Use
          </v-btn>
          <v-btn
            icon="mdi-content-copy"
            variant="text"
            size="small"
            @click.stop="openCloneDialog(pack)"
            title="Clone pack"
          />
          <v-btn
            v-if="!pack.isSystem"
            icon="mdi-delete"
            variant="text"
            size="small"
            color="error"
            @click.stop="confirmDeletePack(pack)"
            title="Delete pack"
          />
        </template>
      </v-list-item>
      
      <v-list-item v-if="packs.length === 0 && !loading">
        <v-list-item-title class="text-grey">
          No avatar packs found
        </v-list-item-title>
      </v-list-item>
    </v-list>

    <v-progress-linear v-if="loading" indeterminate class="my-2" />
    
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-3">
      {{ error }}
    </v-alert>
    
    <v-divider class="my-4" />
    
    <!-- Create New Pack -->
    <h4 class="text-h6 mb-2">Create New Pack</h4>
    
    <v-text-field
      v-model="newPackId"
      label="Pack ID"
      hint="Alphanumeric with hyphens (e.g., my-custom-pack)"
      variant="outlined"
      density="compact"
      class="mb-2"
    />
    
    <v-text-field
      v-model="newPackName"
      label="Pack Name"
      variant="outlined"
      density="compact"
      class="mb-2"
    />
    
    <v-textarea
      v-model="newPackDescription"
      label="Description (optional)"
      variant="outlined"
      density="compact"
      rows="2"
      class="mb-3"
    />
    
    <v-btn
      color="primary"
      variant="tonal"
      :loading="creating"
      :disabled="!newPackId || !newPackName"
      @click="createPack"
    >
      Create Pack
    </v-btn>

    <!-- Selected Pack Details -->
    <template v-if="selectedPack">
      <v-divider class="my-4" />
      
      <h4 class="text-h6 mb-2">{{ selectedPack.name }}</h4>
      <p v-if="selectedPack.description" class="text-body-2 mb-2">{{ selectedPack.description }}</p>
      <p v-if="selectedPack.history" class="text-caption text-grey mb-3">{{ selectedPack.history }}</p>
      
      <!-- Avatar Table -->
      <v-table density="compact" class="mb-4">
        <thead>
          <tr>
            <th style="width: 60px;"></th>
            <th>Canonical ID</th>
            <th>Filename</th>
            <th style="width: 100px;">Color</th>
            <th v-if="!selectedPack.isSystem" style="width: 50px;"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(filename, canonicalId) in selectedPack.avatars" :key="canonicalId">
            <td>
              <v-avatar 
                size="36" 
                class="avatar-clickable"
                @click="openAvatarPreview(canonicalId as string, filename as string)"
              >
                <v-img :src="getAvatarUrl(selectedPack, filename)" />
              </v-avatar>
            </td>
            <td class="text-body-2" style="font-family: monospace;">{{ canonicalId }}</td>
            <td class="text-caption text-grey">{{ filename }}</td>
            <td>
              <div class="d-flex align-center gap-1">
                <input
                  type="color"
                  :value="selectedPack.colors?.[canonicalId as string] || '#9E9E9E'"
                  class="color-picker-input"
                  :disabled="selectedPack.isSystem"
                  @change="updateAvatarColor(canonicalId as string, ($event.target as HTMLInputElement).value)"
                />
                <v-btn
                  v-if="selectedPack.colors?.[canonicalId as string] && !selectedPack.isSystem"
                  icon="mdi-close"
                  size="x-small"
                  variant="text"
                  density="compact"
                  @click="updateAvatarColor(canonicalId as string, '')"
                  title="Clear color"
                />
              </div>
            </td>
            <td v-if="!selectedPack.isSystem">
              <v-btn
                icon="mdi-delete"
                size="x-small"
                variant="text"
                color="error"
                @click="deleteAvatar(canonicalId as string)"
              />
            </td>
          </tr>
          <tr v-if="Object.keys(selectedPack.avatars || {}).length === 0">
            <td colspan="5" class="text-center text-grey py-4">No avatars in this pack</td>
          </tr>
        </tbody>
      </v-table>
      
      <!-- Upload New Avatar (for non-system packs) -->
      <template v-if="!selectedPack.isSystem">
        <h5 class="text-subtitle-1 mb-3">Add Avatar</h5>
        
        <v-row dense>
          <v-col cols="12" md="5">
            <v-combobox
              v-model="uploadCanonicalId"
              :items="availableModels"
              item-title="displayName"
              item-value="canonicalId"
              label="Model / Canonical ID"
              variant="outlined"
              density="compact"
              hint="Select a model or type a custom canonical ID"
              persistent-hint
            />
          </v-col>
          <v-col cols="12" md="5">
            <v-file-input
              v-model="uploadFile"
              label="Avatar Image"
              accept="image/png,image/jpeg,image/gif,image/webp"
              variant="outlined"
              density="compact"
              prepend-icon="mdi-image"
            />
          </v-col>
          <v-col cols="12" md="2" class="d-flex align-center">
            <v-btn
              color="secondary"
              variant="tonal"
              :loading="uploading"
              :disabled="!uploadCanonicalId || !uploadFile"
              @click="uploadAvatar"
              block
            >
              Upload
            </v-btn>
          </v-col>
        </v-row>
      </template>
    </template>
    
    <!-- Clone Dialog -->
    <v-dialog v-model="cloneDialog" max-width="400">
      <v-card>
        <v-card-title>Clone Pack</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="cloneNewId"
            label="New Pack ID"
            variant="outlined"
            density="compact"
            class="mb-2"
          />
          <v-text-field
            v-model="cloneNewName"
            label="New Pack Name"
            variant="outlined"
            density="compact"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="cloneDialog = false">Cancel</v-btn>
          <v-btn
            color="primary"
            variant="tonal"
            :loading="cloning"
            :disabled="!cloneNewId || !cloneNewName"
            @click="clonePack"
          >
            Clone
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    
    <!-- Delete Confirmation Dialog -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>Delete Pack</v-card-title>
        <v-card-text>
          Are you sure you want to delete "{{ packToDelete?.name }}"? This action cannot be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" variant="tonal" :loading="deleting" @click="deletePack">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    
    <!-- Avatar Preview Dialog -->
    <v-dialog v-model="previewDialog" max-width="500">
      <v-card>
        <v-card-title class="d-flex align-center">
          <span style="font-family: monospace;">{{ previewCanonicalId }}</span>
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" size="small" @click="previewDialog = false" />
        </v-card-title>
        <v-card-text class="text-center pa-6">
          <v-img 
            :src="previewUrl" 
            max-height="400"
            contain
            class="mx-auto rounded-lg"
          />
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-card-text>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useStore } from '@/store';
import { api } from '@/services/api';
import { setActivePack, activePack } from '@/utils/avatars';
import type { AvatarPack, Model } from '@deprecated-claude/shared';

const store = useStore();

// State
const packs = ref<(AvatarPack & { path?: string })[]>([]);
const selectedPack = ref<(AvatarPack & { path?: string }) | null>(null);
const loading = ref(false);
const creating = ref(false);
const uploading = ref(false);
const cloning = ref(false);
const deleting = ref(false);
const error = ref<string | null>(null);

// New pack form
const newPackId = ref('');
const newPackName = ref('');
const newPackDescription = ref('');

// Upload form
const uploadCanonicalId = ref<string | { displayName: string; canonicalId: string } | null>(null);
const uploadFile = ref<File | File[] | null>(null);

// Clone dialog
const cloneDialog = ref(false);
const cloneSourcePack = ref<AvatarPack | null>(null);
const cloneNewId = ref('');
const cloneNewName = ref('');

// Delete dialog
const deleteDialog = ref(false);
const packToDelete = ref<AvatarPack | null>(null);

// Preview dialog
const previewDialog = ref(false);
const previewCanonicalId = ref('');
const previewUrl = ref('');

// Currently active pack ID
const currentActivePackId = computed(() => activePack.value?.id || '');

// Activate a pack
function activatePack(pack: AvatarPack) {
  setActivePack(pack.id);
}

// Get models for the dropdown (filter to those with canonicalId)
const availableModels = computed(() => {
  const models = store.state.models as Model[];
  // Group by canonicalId to avoid duplicates
  const seen = new Set<string>();
  const result = models
    .filter(m => m.canonicalId && !seen.has(m.canonicalId) && seen.add(m.canonicalId))
    .map(m => ({ displayName: `${m.displayName} (${m.canonicalId})`, canonicalId: m.canonicalId }));
  console.log('[Avatars] availableModels:', result.length, 'models with canonicalId');
  return result;
});

// Helper to get the canonical ID from combobox value (can be string or object)
function getCanonicalIdValue(): string {
  const val = uploadCanonicalId.value;
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val.canonicalId) return val.canonicalId;
  return String(val);
}

// Load packs on mount
onMounted(async () => {
  await loadPacks();
});

async function loadPacks() {
  loading.value = true;
  error.value = null;
  try {
    const response = await api.get('/avatars/packs');
    packs.value = response.data;
    // Auto-select first pack if none selected
    if (!selectedPack.value && packs.value.length > 0) {
      selectedPack.value = packs.value[0];
    }
  } catch (e: any) {
    error.value = e.response?.data?.error || 'Failed to load avatar packs';
  } finally {
    loading.value = false;
  }
}

function selectPack(pack: AvatarPack & { path?: string }) {
  selectedPack.value = pack;
}

function getAvatarUrl(pack: AvatarPack & { path?: string; originals?: Record<string, string> }, filename: string): string {
  return `/avatars/${pack.path}/${filename}`;
}

function getOriginalAvatarUrl(pack: AvatarPack & { path?: string; originals?: Record<string, string> }, canonicalId: string): string {
  // Try to get the original, fall back to thumbnail
  const original = pack.originals?.[canonicalId];
  const thumb = pack.avatars?.[canonicalId];
  const filename = original || thumb;
  return filename ? `/avatars/${pack.path}/${filename}` : '';
}

function openAvatarPreview(canonicalId: string, _filename: string) {
  if (!selectedPack.value) return;
  previewCanonicalId.value = canonicalId;
  previewUrl.value = getOriginalAvatarUrl(selectedPack.value, canonicalId);
  previewDialog.value = true;
}

async function createPack() {
  creating.value = true;
  error.value = null;
  try {
    await api.post('/avatars/packs', {
      id: newPackId.value,
      name: newPackName.value,
      description: newPackDescription.value
    });
    newPackId.value = '';
    newPackName.value = '';
    newPackDescription.value = '';
    await loadPacks();
  } catch (e: any) {
    error.value = e.response?.data?.error || 'Failed to create pack';
  } finally {
    creating.value = false;
  }
}

async function uploadAvatar() {
  const canonicalId = getCanonicalIdValue();
  console.log('[Upload] uploadAvatar called');
  console.log('[Upload] selectedPack:', selectedPack.value);
  console.log('[Upload] canonicalId:', canonicalId);
  console.log('[Upload] uploadFile:', uploadFile.value);
  
  // Handle both single file and array (Vuetify 3 returns single file by default)
  const file = Array.isArray(uploadFile.value) ? uploadFile.value[0] : uploadFile.value;
  
  if (!selectedPack.value || !canonicalId || !file) {
    console.log('[Upload] Early return - missing required values');
    return;
  }
  
  uploading.value = true;
  error.value = null;
  try {
    const formData = new FormData();
    // IMPORTANT: canonicalId must come BEFORE the file so multer can access it
    formData.append('canonicalId', canonicalId);
    formData.append('avatar', file);
    console.log('[Upload] Sending request to:', `/avatars/packs/${selectedPack.value.id}/avatars`);
    
    await api.post(`/avatars/packs/${selectedPack.value.id}/avatars`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    
    uploadCanonicalId.value = null;
    uploadFile.value = null;
    await loadPacks();
    // Re-select the pack to refresh its data
    const updatedPack = packs.value.find(p => p.id === selectedPack.value?.id);
    if (updatedPack) selectedPack.value = updatedPack;
  } catch (e: any) {
    error.value = e.response?.data?.error || 'Failed to upload avatar';
  } finally {
    uploading.value = false;
  }
}

async function deleteAvatar(canonicalId: string) {
  if (!selectedPack.value) return;
  
  try {
    await api.delete(`/avatars/packs/${selectedPack.value.id}/avatars/${canonicalId}`);
    await loadPacks();
    const updatedPack = packs.value.find(p => p.id === selectedPack.value?.id);
    if (updatedPack) selectedPack.value = updatedPack;
  } catch (e: any) {
    error.value = e.response?.data?.error || 'Failed to delete avatar';
  }
}

async function updateAvatarColor(canonicalId: string, color: string) {
  if (!selectedPack.value || selectedPack.value.isSystem) return;
  
  try {
    await api.put(`/avatars/packs/${selectedPack.value.id}/colors/${canonicalId}`, { color });
    await loadPacks();
    const updatedPack = packs.value.find(p => p.id === selectedPack.value?.id);
    if (updatedPack) selectedPack.value = updatedPack;
  } catch (e: any) {
    error.value = e.response?.data?.error || 'Failed to update color';
  }
}

function openCloneDialog(pack: AvatarPack) {
  cloneSourcePack.value = pack;
  cloneNewId.value = `${pack.id}-copy`;
  cloneNewName.value = `${pack.name} (Copy)`;
  cloneDialog.value = true;
}

async function clonePack() {
  if (!cloneSourcePack.value) return;
  
  cloning.value = true;
  error.value = null;
  try {
    await api.post(`/avatars/packs/${cloneSourcePack.value.id}/clone`, {
      newId: cloneNewId.value,
      newName: cloneNewName.value
    });
    cloneDialog.value = false;
    await loadPacks();
  } catch (e: any) {
    error.value = e.response?.data?.error || 'Failed to clone pack';
  } finally {
    cloning.value = false;
  }
}

function confirmDeletePack(pack: AvatarPack) {
  packToDelete.value = pack;
  deleteDialog.value = true;
}

async function deletePack() {
  if (!packToDelete.value) return;
  
  deleting.value = true;
  try {
    await api.delete(`/avatars/packs/${packToDelete.value.id}`);
    deleteDialog.value = false;
    if (selectedPack.value?.id === packToDelete.value.id) {
      selectedPack.value = null;
    }
    await loadPacks();
  } catch (e: any) {
    error.value = e.response?.data?.error || 'Failed to delete pack';
  } finally {
    deleting.value = false;
  }
}
</script>

<style scoped>
/* Table styles */
.v-table {
  background: transparent !important;
}

/* Active pack highlight */
.active-pack {
  border-left: 3px solid rgb(var(--v-theme-success));
  background: rgba(var(--v-theme-success), 0.05) !important;
}

/* Clickable avatar */
.avatar-clickable {
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.avatar-clickable:hover {
  transform: scale(1.1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

/* Color picker input */
.color-picker-input {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: transparent;
  padding: 0;
}
.color-picker-input::-webkit-color-swatch-wrapper {
  padding: 2px;
}
.color-picker-input::-webkit-color-swatch {
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}
.color-picker-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

