<template>
  <v-container fluid class="personas-view pa-6">
    <div class="d-flex align-center mb-6">
      <v-icon size="large" color="primary" class="mr-3">mdi-account-multiple-outline</v-icon>
      <div>
        <h1 class="text-h4 font-weight-light">Personas</h1>
        <p class="text-body-2 text-grey mt-1">Manage AI identities with persistent history across conversations</p>
      </div>
      <v-spacer />
      <v-btn
        color="primary"
        @click="showCreateDialog = true"
      >
        <v-icon start>mdi-plus</v-icon>
        Create Persona
      </v-btn>
    </div>

    <!-- Error Alert -->
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" closable @click:close="error = null">
      {{ error }}
    </v-alert>

    <!-- Success Alert -->
    <v-alert v-if="successMessage" type="success" variant="tonal" class="mb-4" closable @click:close="successMessage = null">
      {{ successMessage }}
    </v-alert>

    <!-- Loading State -->
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <!-- Empty State -->
    <v-card v-if="!loading && personas.length === 0" variant="outlined" class="text-center pa-8">
      <v-icon size="80" color="grey-lighten-1" class="mb-4">mdi-account-multiple-outline</v-icon>
      <h3 class="text-h6 mb-2">No Personas Yet</h3>
      <p class="text-body-2 text-grey mb-4">
        Create a persona to give an AI model persistent identity and memory across conversations.
      </p>
      <v-btn color="primary" @click="showCreateDialog = true">
        <v-icon start>mdi-plus</v-icon>
        Create Your First Persona
      </v-btn>
    </v-card>

    <!-- Personas List -->
    <v-row v-else>
      <v-col
        v-for="persona in personas"
        :key="persona.id"
        cols="12"
        md="6"
        lg="4"
      >
        <v-card
          :class="{ 'persona-archived': persona.archivedAt }"
          @click="viewPersona(persona)"
          style="cursor: pointer;"
        >
          <v-card-title class="d-flex align-center">
            <v-avatar size="40" :color="getPersonaColor(persona)" class="mr-3">
              <span class="text-body-1 font-weight-bold">{{ persona.name?.charAt(0)?.toUpperCase() || '?' }}</span>
            </v-avatar>
            <div class="flex-grow-1">
              <div class="d-flex align-center">
                {{ persona.name || 'Unnamed' }}
                <v-chip
                  v-if="persona.archivedAt"
                  size="x-small"
                  color="grey"
                  class="ml-2"
                >
                  Archived
                </v-chip>
              </div>
              <div class="text-caption text-grey">{{ getModelName(persona.modelId) }}</div>
            </div>
            <v-menu location="bottom end">
              <template v-slot:activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon="mdi-dots-vertical"
                  variant="text"
                  size="small"
                  @click.stop
                />
              </template>
              <v-list density="compact">
                <v-list-item
                  v-if="!persona.archivedAt"
                  prepend-icon="mdi-archive"
                  title="Archive"
                  @click="archivePersona(persona)"
                />
                <v-list-item
                  prepend-icon="mdi-delete"
                  title="Delete"
                  class="text-error"
                  @click="confirmDelete(persona)"
                />
              </v-list>
            </v-menu>
          </v-card-title>

          <v-card-text>
            <div class="d-flex flex-wrap mb-2" style="gap: 8px;">
              <v-chip size="small" variant="outlined">
                <v-icon start size="small">mdi-cog</v-icon>
                {{ persona.contextStrategy?.type === 'rolling' ? 'Rolling' : 'Anchored' }}
              </v-chip>
              <v-chip size="small" variant="outlined">
                <v-icon start size="small">mdi-history</v-icon>
                {{ getParticipationCount(persona.id || '') }} conversations
              </v-chip>
            </div>
            <div class="text-caption text-grey">
              Created {{ persona.createdAt ? formatDate(persona.createdAt) : 'Unknown' }}
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Create Dialog -->
    <CreatePersonaDialog
      v-model="showCreateDialog"
      :models="models"
      :availability="store.state.modelAvailability"
      @create="handleCreatePersona"
    />

    <!-- Delete Confirmation Dialog -->
    <v-dialog v-model="showDeleteDialog" max-width="400">
      <v-card>
        <v-card-title>Delete Persona</v-card-title>
        <v-card-text>
          Are you sure you want to delete <strong>{{ personaToDelete?.name }}</strong>?
          This action cannot be undone and will remove all history.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showDeleteDialog = false">Cancel</v-btn>
          <v-btn color="error" variant="elevated" :loading="deleting" @click="deletePersona">
            Delete
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Persona Detail Dialog -->
    <v-dialog v-model="showDetailDialog" max-width="600">
      <v-card v-if="selectedPersona">
        <v-card-title class="d-flex align-center">
          <v-avatar size="40" :color="getPersonaColor(selectedPersona)" class="mr-3">
            <span class="text-body-1 font-weight-bold">{{ selectedPersona.name.charAt(0).toUpperCase() }}</span>
          </v-avatar>
          {{ selectedPersona.name }}
        </v-card-title>

        <v-card-text>
          <v-list density="compact">
            <v-list-item>
              <template v-slot:prepend>
                <v-icon>mdi-robot</v-icon>
              </template>
              <v-list-item-title>Model</v-list-item-title>
              <v-list-item-subtitle>{{ getModelName(selectedPersona.modelId) }}</v-list-item-subtitle>
            </v-list-item>

            <v-list-item>
              <template v-slot:prepend>
                <v-icon>mdi-cog</v-icon>
              </template>
              <v-list-item-title>Context Strategy</v-list-item-title>
              <v-list-item-subtitle>
                {{ selectedPersona.contextStrategy.type === 'rolling'
                  ? `Rolling (${selectedPersona.contextStrategy.maxTokens?.toLocaleString()} tokens)`
                  : `Anchored (${selectedPersona.contextStrategy.prefixTokens?.toLocaleString()} prefix + ${selectedPersona.contextStrategy.rollingTokens?.toLocaleString()} rolling)`
                }}
              </v-list-item-subtitle>
            </v-list-item>

            <v-list-item>
              <template v-slot:prepend>
                <v-icon>mdi-arrow-expand-vertical</v-icon>
              </template>
              <v-list-item-title>Backscroll Tokens</v-list-item-title>
              <v-list-item-subtitle>{{ selectedPersona.backscrollTokens.toLocaleString() }}</v-list-item-subtitle>
            </v-list-item>

            <v-list-item>
              <template v-slot:prepend>
                <v-icon>mdi-swap-horizontal</v-icon>
              </template>
              <v-list-item-title>Interleaved Participation</v-list-item-title>
              <v-list-item-subtitle>{{ selectedPersona.allowInterleavedParticipation ? 'Allowed' : 'Sequential only' }}</v-list-item-subtitle>
            </v-list-item>

            <v-list-item>
              <template v-slot:prepend>
                <v-icon>mdi-calendar</v-icon>
              </template>
              <v-list-item-title>Created</v-list-item-title>
              <v-list-item-subtitle>{{ formatDate(selectedPersona.createdAt) }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>

          <!-- History Branches Section -->
          <v-divider class="my-4" />
          <h4 class="text-subtitle-1 mb-2">History Branches</h4>
          <v-chip-group>
            <v-chip
              v-for="branch in personaBranches"
              :key="branch.id"
              :color="branch.isHead ? 'primary' : undefined"
              :variant="branch.isHead ? 'flat' : 'outlined'"
              size="small"
            >
              <v-icon v-if="branch.isHead" start size="small">mdi-source-branch</v-icon>
              {{ branch.name }}
            </v-chip>
          </v-chip-group>
          <p v-if="personaBranches.length === 0" class="text-caption text-grey">No branches loaded</p>

          <!-- Participations Section -->
          <v-divider class="my-4" />
          <h4 class="text-subtitle-1 mb-2">Recent Participations</h4>
          <v-list v-if="personaParticipations.length > 0" density="compact">
            <v-list-item
              v-for="participation in personaParticipations.slice(0, 5)"
              :key="participation.id"
            >
              <v-list-item-title>
                Conversation {{ participation.conversationId.slice(0, 8) }}...
              </v-list-item-title>
              <v-list-item-subtitle>
                Logical time: {{ participation.logicalStart }} - {{ participation.logicalEnd }}
                <span v-if="!participation.leftAt" class="text-success"> (active)</span>
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
          <p v-else class="text-caption text-grey">No participations yet</p>
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showDetailDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import type { Persona, PersonaHistoryBranch, PersonaParticipation, Model, CreatePersonaRequest } from '@deprecated-claude/shared';
import { api } from '@/services/api';
import { useStore } from '@/store';
import CreatePersonaDialog from '@/components/CreatePersonaDialog.vue';

const store = useStore();

const personas = ref<Persona[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const successMessage = ref<string | null>(null);

const showCreateDialog = ref(false);
const showDeleteDialog = ref(false);
const showDetailDialog = ref(false);

const personaToDelete = ref<Persona | null>(null);
const selectedPersona = ref<Persona | null>(null);
const personaBranches = ref<PersonaHistoryBranch[]>([]);
const personaParticipations = ref<PersonaParticipation[]>([]);
const participationCounts = ref<Map<string, number>>(new Map());

const deleting = ref(false);

const models = computed(() => store.state.models);

// Color palette for personas
const colors = ['primary', 'secondary', 'success', 'warning', 'info', 'error', 'purple', 'teal', 'orange', 'cyan'];

function getPersonaColor(persona: Persona): string {
  // Use persona id to deterministically pick a color
  if (!persona || !persona.id) return 'primary';
  const hash = persona.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function getModelName(modelId: string): string {
  const model = models.value.find(m => m.id === modelId);
  return model?.displayName || model?.shortName || modelId;
}

function getParticipationCount(personaId: string): number {
  return participationCounts.value.get(personaId) || 0;
}

function formatDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

async function loadPersonas() {
  loading.value = true;
  error.value = null;

  try {
    const response = await api.get('/personas');
    console.log('Personas API response:', response.data);
    // API returns {owned: [], shared: []}, combine them
    personas.value = [...response.data.owned, ...response.data.shared];

    // Load participation counts for each persona
    for (const persona of personas.value) {
      try {
        const participationsResponse = await api.get(`/personas/${persona.id}/participations`);
        participationCounts.value.set(persona.id, participationsResponse.data.length);
      } catch {
        participationCounts.value.set(persona.id, 0);
      }
    }
  } catch (e: any) {
    error.value = e.response?.data?.error || 'Failed to load personas';
  } finally {
    loading.value = false;
  }
}

async function handleCreatePersona(request: CreatePersonaRequest) {
  try {
    const response = await api.post('/personas', request);
    personas.value.unshift(response.data);
    participationCounts.value.set(response.data.id, 0);
    showCreateDialog.value = false;
    successMessage.value = `Persona "${response.data.name}" created successfully`;
  } catch (e: any) {
    error.value = e.response?.data?.error || 'Failed to create persona';
  }
}

async function archivePersona(persona: Persona) {
  try {
    const response = await api.post(`/personas/${persona.id}/archive`);
    const index = personas.value.findIndex(p => p.id === persona.id);
    if (index !== -1) {
      personas.value[index] = response.data;
    }
    successMessage.value = `Persona "${persona.name}" archived`;
  } catch (e: any) {
    error.value = e.response?.data?.error || 'Failed to archive persona';
  }
}

function confirmDelete(persona: Persona) {
  personaToDelete.value = persona;
  showDeleteDialog.value = true;
}

async function deletePersona() {
  if (!personaToDelete.value) return;

  deleting.value = true;
  try {
    await api.delete(`/personas/${personaToDelete.value.id}`);
    personas.value = personas.value.filter(p => p.id !== personaToDelete.value!.id);
    participationCounts.value.delete(personaToDelete.value.id);
    showDeleteDialog.value = false;
    successMessage.value = `Persona "${personaToDelete.value.name}" deleted`;
    personaToDelete.value = null;
  } catch (e: any) {
    error.value = e.response?.data?.error || 'Failed to delete persona';
  } finally {
    deleting.value = false;
  }
}

async function viewPersona(persona: Persona) {
  selectedPersona.value = persona;
  showDetailDialog.value = true;

  // Load branches and participations
  try {
    const [branchesResponse, participationsResponse] = await Promise.all([
      api.get(`/personas/${persona.id}/branches`),
      api.get(`/personas/${persona.id}/participations`)
    ]);
    personaBranches.value = branchesResponse.data;
    personaParticipations.value = participationsResponse.data;
  } catch (e: any) {
    console.error('Failed to load persona details:', e);
    personaBranches.value = [];
    personaParticipations.value = [];
  }
}

onMounted(() => {
  loadPersonas();
  // Ensure models are loaded
  if (models.value.length === 0) {
    store.loadModels();
  }
});
</script>

<style scoped>
.persona-archived {
  opacity: 0.6;
}
</style>
