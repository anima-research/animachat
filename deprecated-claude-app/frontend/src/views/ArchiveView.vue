<template>
  <div class="archive-view">
    <v-app-bar density="compact" color="surface">
      <v-btn icon="mdi-arrow-left" @click="goBack" />
      <v-app-bar-title>
        Message Archive
        <span v-if="conversationTitle" class="text-caption ml-2 text-grey">
          {{ conversationTitle }}
        </span>
      </v-app-bar-title>
      <v-spacer />
      <v-btn 
        icon="mdi-refresh" 
        @click="loadArchive" 
        :loading="loading"
        title="Refresh"
      />
    </v-app-bar>

    <v-container fluid class="pa-4">
      <!-- Stats Card -->
      <v-card v-if="stats" class="mb-4" variant="tonal">
        <v-card-text class="d-flex flex-wrap gap-4">
          <div class="stat-item">
            <div class="stat-value">{{ stats.totalMessages }}</div>
            <div class="stat-label">Messages</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">{{ stats.totalBranches }}</div>
            <div class="stat-label">Branches</div>
          </div>
          <div class="stat-item">
            <div class="stat-value" :class="{ 'text-warning': stats.orphanedBranches > 0 }">
              {{ stats.orphanedBranches }}
            </div>
            <div class="stat-label">Orphaned</div>
          </div>
          <div class="stat-item">
            <div class="stat-value" :class="{ 'text-error': stats.deletedBranches > 0 }">
              {{ stats.deletedBranches }}
            </div>
            <div class="stat-label">Deleted</div>
          </div>
          <div class="stat-item">
            <div class="stat-value text-success">{{ stats.rootBranches }}</div>
            <div class="stat-label">Roots</div>
          </div>
        </v-card-text>
      </v-card>

      <!-- Filters -->
      <v-card class="mb-4">
        <v-card-text class="d-flex flex-wrap gap-2 align-center">
          <v-checkbox
            v-model="showOrphans"
            label="Show Orphans Only"
            density="compact"
            hide-details
            class="mr-4"
          />
          <v-checkbox
            v-model="showDeleted"
            label="Show Deleted"
            density="compact"
            hide-details
            class="mr-4"
          />
          <v-text-field
            v-model="searchQuery"
            label="Search content"
            prepend-inner-icon="mdi-magnify"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            style="max-width: 300px"
          />
        </v-card-text>
      </v-card>

      <!-- Loading State -->
      <div v-if="loading" class="d-flex justify-center py-8">
        <v-progress-circular indeterminate size="64" />
      </div>

      <!-- Error State -->
      <v-alert v-else-if="error" type="error" class="mb-4">
        {{ error }}
      </v-alert>

      <!-- Messages Table -->
      <v-card v-else>
        <v-data-table
          :headers="headers"
          :items="filteredMessages"
          :items-per-page="50"
          class="archive-table"
          density="compact"
          hover
        >
          <template v-slot:item.order="{ item }">
            <span class="font-mono">{{ item.order }}</span>
          </template>

          <template v-slot:item.id="{ item }">
            <code class="text-caption">{{ item.id.slice(0, 8) }}</code>
          </template>

          <template v-slot:item.branches="{ item }">
            <div class="branches-cell">
              <div
                v-for="branch in item.branches"
                :key="branch.id"
                class="branch-row"
                :class="{
                  'branch-active': branch.isActive,
                  'branch-orphan': branch.isOrphan,
                  'branch-deleted': branch.isDeleted,
                }"
              >
                <div class="branch-meta">
                  <v-chip
                    v-if="branch.isOrphan"
                    size="x-small"
                    color="warning"
                    variant="flat"
                    class="mr-1"
                  >
                    ORPHAN
                  </v-chip>
                  <v-chip
                    v-if="branch.isDeleted"
                    size="x-small"
                    color="error"
                    variant="flat"
                    class="mr-1"
                  >
                    DELETED
                  </v-chip>
                  <v-chip
                    v-if="branch.isActive"
                    size="x-small"
                    color="success"
                    variant="flat"
                    class="mr-1"
                  >
                    ACTIVE
                  </v-chip>
                  <v-chip
                    v-if="!branch.parentBranchId"
                    size="x-small"
                    color="info"
                    variant="flat"
                    class="mr-1"
                  >
                    ROOT
                  </v-chip>
                  <span class="text-caption text-grey">
                    {{ branch.role }}
                    <span v-if="branch.model" class="ml-1">({{ branch.model }})</span>
                  </span>
                </div>
                <div class="branch-ids">
                  <code class="text-caption">B: {{ branch.id.slice(0, 8) }}</code>
                  <code v-if="branch.parentBranchId" class="text-caption ml-2">
                    P: {{ branch.parentBranchId.slice(0, 8) }}
                  </code>
                </div>
                <div class="branch-content">
                  {{ truncateContent(branch.content) }}
                </div>
              </div>
            </div>
          </template>
        </v-data-table>
      </v-card>
    </v-container>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/services/api';

const route = useRoute();
const router = useRouter();

const loading = ref(true);
const error = ref<string | null>(null);
const conversationTitle = ref('');
const messages = ref<any[]>([]);
const stats = ref<any>(null);

const showOrphans = ref(false);
const showDeleted = ref(false);
const searchQuery = ref('');

const headers = [
  { title: 'Order', key: 'order', width: '80px' },
  { title: 'Message ID', key: 'id', width: '100px' },
  { title: 'Branches', key: 'branches', sortable: false },
];

const filteredMessages = computed(() => {
  let result = messages.value;

  if (showOrphans.value) {
    result = result.filter(m => m.branches.some((b: any) => b.isOrphan));
  }

  if (!showDeleted.value) {
    result = result.map(m => ({
      ...m,
      branches: m.branches.filter((b: any) => !b.isDeleted),
    })).filter(m => m.branches.length > 0);
  }

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(m =>
      m.branches.some((b: any) =>
        b.content.toLowerCase().includes(query) ||
        b.id.includes(query) ||
        (b.parentBranchId && b.parentBranchId.includes(query))
      )
    );
  }

  return result;
});

function truncateContent(content: string): string {
  if (!content) return '(empty)';
  const cleaned = content.replace(/\n/g, ' ').trim();
  return cleaned.length > 150 ? cleaned.slice(0, 150) + '...' : cleaned;
}

function goBack() {
  const conversationId = route.params.id as string;
  router.push(`/conversation/${conversationId}`);
}

async function loadArchive() {
  const conversationId = route.params.id as string;
  if (!conversationId) {
    error.value = 'No conversation ID provided';
    loading.value = false;
    return;
  }

  loading.value = true;
  error.value = null;

  try {
    // Get conversation info
    const convResponse = await api.get(`/conversations/${conversationId}`);
    conversationTitle.value = convResponse.data.title || 'Untitled';

    // Get archive data
    const archiveResponse = await api.get(`/conversations/${conversationId}/archive`);
    messages.value = archiveResponse.data.messages;
    stats.value = archiveResponse.data.stats;
  } catch (e: any) {
    error.value = e.response?.data?.error || e.message || 'Failed to load archive';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadArchive();
});
</script>

<style scoped>
.archive-view {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: rgb(var(--v-theme-background));
}

.stat-item {
  text-align: center;
  min-width: 80px;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: bold;
  font-family: monospace;
}

.stat-label {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
  text-transform: uppercase;
}

.branches-cell {
  padding: 4px 0;
}

.branch-row {
  padding: 6px 8px;
  margin: 4px 0;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.03);
  border-left: 3px solid transparent;
}

.branch-row.branch-active {
  border-left-color: rgb(var(--v-theme-success));
  background: rgba(var(--v-theme-success), 0.1);
}

.branch-row.branch-orphan {
  border-left-color: rgb(var(--v-theme-warning));
  background: rgba(var(--v-theme-warning), 0.1);
}

.branch-row.branch-deleted {
  opacity: 0.5;
  text-decoration: line-through;
  border-left-color: rgb(var(--v-theme-error));
}

.branch-meta {
  margin-bottom: 4px;
}

.branch-ids {
  margin-bottom: 4px;
}

.branch-content {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.7);
  word-break: break-word;
}

.font-mono {
  font-family: monospace;
}

.gap-2 {
  gap: 8px;
}

.gap-4 {
  gap: 16px;
}

:deep(.v-data-table__td) {
  vertical-align: top !important;
}
</style>


