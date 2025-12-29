<template>
  <v-container fluid class="admin-view pa-6">
    <div class="d-flex align-center mb-6">
      <v-icon size="large" color="primary" class="mr-3">mdi-shield-crown</v-icon>
      <div>
        <h1 class="text-h4 font-weight-light">Admin Dashboard</h1>
        <p class="text-body-2 text-grey mt-1">Manage users, capabilities, and system settings</p>
      </div>
      <v-spacer />
      <v-btn 
        variant="outlined" 
        color="primary" 
        @click="refreshData"
        :loading="loading"
      >
        <v-icon start>mdi-refresh</v-icon>
        Refresh
      </v-btn>
    </div>

    <!-- System Stats -->
    <v-row class="mb-6">
      <v-col cols="12" md="4">
        <v-card variant="tonal" color="primary">
          <v-card-text class="d-flex align-center">
            <v-icon size="48" class="mr-4 opacity-70">mdi-account-group</v-icon>
            <div>
              <div class="text-h4 font-weight-bold">{{ systemStats?.totalUsers || 0 }}</div>
              <div class="text-body-2 opacity-70">Total Users</div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="4">
        <v-card variant="tonal" color="secondary">
          <v-card-text class="d-flex align-center">
            <v-icon size="48" class="mr-4 opacity-70">mdi-forum</v-icon>
            <div>
              <div class="text-h4 font-weight-bold">{{ systemStats?.totalConversations || 0 }}</div>
              <div class="text-body-2 opacity-70">Total Conversations</div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="4">
        <v-card variant="tonal" color="success">
          <v-card-text class="d-flex align-center">
            <v-icon size="48" class="mr-4 opacity-70">mdi-account-check</v-icon>
            <div>
              <div class="text-h4 font-weight-bold">{{ systemStats?.activeUsersLast7Days || 0 }}</div>
              <div class="text-body-2 opacity-70">Active (7 days)</div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- System Usage Chart -->
    <v-card class="mb-6">
      <v-card-text>
        <UsageChart 
          title="System-wide Token Usage" 
          :fetch-url="apiBaseUrl + '/admin/usage/system'"
          :show-model-breakdown="true"
        />
      </v-card-text>
    </v-card>

    <!-- Config Editor -->
    <ConfigEditor class="mb-6" />

    <!-- Legacy Migration Tools -->
    <v-card class="mb-6" variant="outlined" color="warning">
      <v-card-title class="text-subtitle-1">
        <v-icon color="warning" class="mr-2">mdi-database-sync</v-icon>
        Legacy Migration Tools
      </v-card-title>
      <v-card-text>
        <div class="d-flex flex-column" style="gap: 12px;">
          <!-- Verify Legacy Users -->
          <div class="d-flex align-center">
            <v-icon color="warning" size="small" class="mr-3">mdi-email-check</v-icon>
            <div class="flex-grow-1">
              <div class="font-weight-medium text-body-2">Verify Legacy Users</div>
              <div class="text-caption text-grey">Mark users registered before Dec 8, 2025 as email-verified</div>
            </div>
            <v-btn
              color="warning"
              variant="tonal"
              size="small"
              :loading="verifyingLegacyUsers"
              @click="verifyLegacyUsers"
            >
              <v-icon start size="small">mdi-check-all</v-icon>
              Run
            </v-btn>
          </div>
          
          <!-- Set Age Verified for All Users -->
          <div class="d-flex align-center">
            <v-icon color="info" size="small" class="mr-3">mdi-account-check</v-icon>
            <div class="flex-grow-1">
              <div class="font-weight-medium text-body-2">Set Age Verified (18+)</div>
              <div class="text-caption text-grey">Mark all existing users as age-verified (for legacy users before age gate)</div>
            </div>
            <v-btn
              color="info"
              variant="tonal"
              size="small"
              :loading="settingAgeVerified"
              @click="setAllUsersAgeVerified"
            >
              <v-icon start size="small">mdi-check-all</v-icon>
              Run
            </v-btn>
          </div>
          
          <!-- Set ToS Accepted for All Users -->
          <div class="d-flex align-center">
            <v-icon color="success" size="small" class="mr-3">mdi-file-document-check</v-icon>
            <div class="flex-grow-1">
              <div class="font-weight-medium text-body-2">Set ToS Accepted</div>
              <div class="text-caption text-grey">Mark all existing users as having accepted Terms of Service</div>
            </div>
            <v-btn
              color="success"
              variant="tonal"
              size="small"
              :loading="settingTosAccepted"
              @click="setAllUsersTosAccepted"
            >
              <v-icon start size="small">mdi-check-all</v-icon>
              Run
            </v-btn>
          </div>
        </div>
      </v-card-text>
    </v-card>

    <!-- Error Alert -->
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" closable @click:close="error = null">
      {{ error }}
    </v-alert>

    <!-- Success Alert -->
    <v-alert v-if="successMessage" type="success" variant="tonal" class="mb-4" closable @click:close="successMessage = null">
      {{ successMessage }}
    </v-alert>

    <!-- Users Table -->
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-account-multiple</v-icon>
        Users
        <v-spacer />
        <v-text-field
          v-model="searchQuery"
          density="compact"
          variant="outlined"
          placeholder="Search users..."
          prepend-inner-icon="mdi-magnify"
          hide-details
          clearable
          style="max-width: 300px;"
        />
      </v-card-title>
      
      <v-divider />
      
      <v-data-table
        :headers="tableHeaders"
        :items="filteredUsers"
        :loading="loading"
        :items-per-page="20"
        class="elevation-0"
        hover
      >
        <template #item.email="{ item }">
          <div class="d-flex align-center">
            <v-avatar size="32" color="primary" class="mr-2">
              <span class="text-caption font-weight-bold">{{ item.name?.charAt(0)?.toUpperCase() || '?' }}</span>
            </v-avatar>
            <div>
              <div class="font-weight-medium">{{ item.name }}</div>
              <div class="text-caption text-grey">{{ item.email }}</div>
            </div>
          </div>
        </template>

        <template #item.capabilities="{ item }">
          <div class="d-flex flex-wrap" style="gap: 4px;">
            <v-chip
              v-for="cap in item.capabilities"
              :key="cap"
              :color="getCapabilityColor(cap)"
              size="x-small"
              variant="flat"
            >
              {{ cap }}
            </v-chip>
            <span v-if="!item.capabilities?.length" class="text-grey text-caption">—</span>
          </div>
        </template>

        <template #item.balances="{ item }">
          <div class="d-flex flex-wrap" style="gap: 4px;">
            <v-chip
              v-for="(amount, currency) in item.balances"
              :key="currency"
              size="x-small"
              variant="outlined"
              :title="`${formatNumber(amount)} ${currency}`"
            >
              {{ currency }}: {{ formatNumber(amount) }}
            </v-chip>
            <span v-if="!Object.keys(item.balances || {}).length" class="text-grey text-caption">—</span>
          </div>
        </template>

        <template #item.lastActive="{ item }">
          <span v-if="item.lastActive" class="text-caption">{{ formatRelativeTime(item.lastActive) }}</span>
          <span v-else class="text-caption text-grey">Never</span>
        </template>

        <template #item.createdAt="{ item }">
          <span class="text-caption">{{ formatDate(item.createdAt) }}</span>
        </template>

        <template #item.conversationCount="{ item }">
          <v-chip size="small" variant="tonal">
            {{ item.conversationCount }}
          </v-chip>
        </template>

        <template #item.actions="{ item }">
          <v-btn
            icon="mdi-cog"
            size="small"
            variant="text"
            @click="openUserDialog(item)"
          />
        </template>
      </v-data-table>
    </v-card>

    <!-- User Detail Dialog -->
    <v-dialog v-model="userDialog" max-width="600">
      <v-card v-if="selectedUser">
        <v-card-title class="d-flex align-center">
          <v-avatar size="40" color="primary" class="mr-3">
            <span class="font-weight-bold">{{ selectedUser.name?.charAt(0)?.toUpperCase() || '?' }}</span>
          </v-avatar>
          <div>
            <div>{{ selectedUser.name }}</div>
            <div class="text-caption text-grey">{{ selectedUser.email }}</div>
          </div>
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" @click="userDialog = false" />
        </v-card-title>
        
        <v-divider />
        
        <v-card-text>
          <!-- Capabilities Section -->
          <h4 class="text-subtitle-1 font-weight-medium mb-3">
            <v-icon size="small" class="mr-1">mdi-shield-account</v-icon>
            Capabilities
          </h4>
          
          <div class="d-flex flex-wrap mb-4" style="gap: 8px;">
            <v-chip
              v-for="cap in allCapabilities"
              :key="cap"
              :color="hasCapability(cap) ? getCapabilityColor(cap) : 'grey'"
              :variant="hasCapability(cap) ? 'flat' : 'outlined'"
              @click="toggleCapability(cap)"
              :disabled="capabilityLoading"
            >
              <v-icon start size="small">
                {{ hasCapability(cap) ? 'mdi-check' : 'mdi-plus' }}
              </v-icon>
              {{ cap }}
            </v-chip>
          </div>

          <v-divider class="my-4" />

          <!-- Grant Credits Section -->
          <h4 class="text-subtitle-1 font-weight-medium mb-3">
            <v-icon size="small" class="mr-1">mdi-currency-usd</v-icon>
            Grant Credits
          </h4>
          
          <div class="d-flex align-center" style="gap: 8px;">
            <v-text-field
              v-model.number="grantAmount"
              type="number"
              label="Amount"
              density="compact"
              variant="outlined"
              hide-details
              style="max-width: 120px;"
            />
            <v-select
              v-model="grantCurrency"
              :items="currencies"
              label="Currency"
              density="compact"
              variant="outlined"
              hide-details
              style="max-width: 150px;"
            />
            <v-btn
              color="primary"
              :disabled="!grantAmount || grantAmount <= 0 || !grantCurrency || grantingCredits"
              :loading="grantingCredits"
              @click="grantCredits"
            >
              Grant
            </v-btn>
          </div>

          <v-divider class="my-4" />

          <!-- Current Balances -->
          <h4 class="text-subtitle-1 font-weight-medium mb-3">
            <v-icon size="small" class="mr-1">mdi-wallet</v-icon>
            Current Balances
          </h4>
          
          <v-list density="compact" v-if="Object.keys(selectedUser.balances || {}).length">
            <v-list-item v-for="(amount, currency) in selectedUser.balances" :key="currency">
              <v-list-item-title>{{ currency }}</v-list-item-title>
              <template #append>
                <span class="font-weight-medium">{{ formatNumber(amount) }}</span>
              </template>
            </v-list-item>
          </v-list>
          <p v-else class="text-grey text-body-2">No balances</p>

          <v-divider class="my-4" />

          <!-- User Stats -->
          <h4 class="text-subtitle-1 font-weight-medium mb-3">
            <v-icon size="small" class="mr-1">mdi-chart-bar</v-icon>
            Stats
          </h4>
          
          <v-row>
            <v-col cols="6">
              <div class="text-caption text-grey">Conversations</div>
              <div class="text-h6">{{ selectedUser.conversationCount }}</div>
            </v-col>
            <v-col cols="6">
              <div class="text-caption text-grey">Member Since</div>
              <div class="text-body-1">{{ formatDate(selectedUser.createdAt) }}</div>
            </v-col>
          </v-row>

          <v-divider class="my-4" />

          <!-- User Usage Chart -->
          <UsageChart 
            title="Token Usage" 
            :fetch-url="apiBaseUrl + '/admin/usage/user/' + selectedUser.id"
            :show-model-breakdown="true"
          />
        </v-card-text>

        <v-divider />

        <v-card-actions>
          <v-btn
            variant="text"
            color="warning"
            @click="reloadUser"
            :loading="reloadingUser"
          >
            <v-icon start>mdi-refresh</v-icon>
            Reload from Disk
          </v-btn>
          <v-spacer />
          <v-btn variant="text" @click="userDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '@/services/api';
import UsageChart from '@/components/UsageChart.vue';
import ConfigEditor from '@/components/ConfigEditor.vue';

// Get API base URL from the api instance
const apiBaseUrl = (api.defaults.baseURL || '/api').replace(/\/$/, '');

interface UserWithStats {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  lastActive?: string;
  conversationCount: number;
  capabilities: string[];
  balances: Record<string, number>;
}

interface SystemStats {
  totalUsers: number;
  totalConversations: number;
  activeUsersLast7Days: number;
}

const loading = ref(false);
const error = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const users = ref<UserWithStats[]>([]);
const systemStats = ref<SystemStats | null>(null);
const searchQuery = ref('');

// User dialog state
const userDialog = ref(false);
const selectedUser = ref<UserWithStats | null>(null);
const capabilityLoading = ref(false);
const grantAmount = ref<number>(100);
const grantCurrency = ref('old_sonnets');
const grantingCredits = ref(false);
const reloadingUser = ref(false);

const allCapabilities = ['admin', 'mint', 'send', 'overspend', 'researcher'];
const currencies = ['credit', 'old_sonnets', 'claude3opus', 'haiku', 'gemini'];
const verifyingLegacyUsers = ref(false);
const settingAgeVerified = ref(false);
const settingTosAccepted = ref(false);

const tableHeaders = [
  { title: 'User', key: 'email', sortable: true },
  { title: 'Capabilities', key: 'capabilities', sortable: false },
  { title: 'Balances', key: 'balances', sortable: false },
  { title: 'Convos', key: 'conversationCount', sortable: true },
  { title: 'Last Active', key: 'lastActive', sortable: true },
  { title: 'Joined', key: 'createdAt', sortable: true },
  { title: '', key: 'actions', sortable: false, width: 50 },
];

const filteredUsers = computed(() => {
  if (!searchQuery.value) return users.value;
  const query = searchQuery.value.toLowerCase();
  return users.value.filter(user => 
    user.email.toLowerCase().includes(query) ||
    user.name.toLowerCase().includes(query)
  );
});

function hasCapability(cap: string): boolean {
  return selectedUser.value?.capabilities?.includes(cap) || false;
}

function getCapabilityColor(cap: string): string {
  const colors: Record<string, string> = {
    admin: 'error',
    mint: 'success',
    send: 'primary',
    overspend: 'warning',
    researcher: 'info'
  };
  return colors[cap] || 'grey';
}

function formatNumber(num: number): string {
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k';
  }
  return num.toFixed(2);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  
  return formatDate(dateStr);
}

async function fetchUsers() {
  loading.value = true;
  error.value = null;
  try {
    const response = await api.get('/admin/users');
    users.value = response.data.users;
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Failed to fetch users';
    if (e?.response?.status === 403) {
      error.value = 'Access denied. Admin privileges required.';
    }
  } finally {
    loading.value = false;
  }
}

async function fetchStats() {
  try {
    const response = await api.get('/admin/stats');
    systemStats.value = response.data;
  } catch (e) {
    console.error('Failed to fetch stats:', e);
  }
}

async function refreshData() {
  await Promise.all([fetchUsers(), fetchStats()]);
}

function openUserDialog(user: UserWithStats) {
  selectedUser.value = { ...user };
  userDialog.value = true;
}

async function toggleCapability(cap: string) {
  if (!selectedUser.value) return;
  
  capabilityLoading.value = true;
  const action = hasCapability(cap) ? 'revoke' : 'grant';
  
  try {
    await api.post(`/admin/users/${selectedUser.value.id}/capabilities`, {
      capability: cap,
      action
    });
    
    // Update local state
    if (action === 'grant') {
      selectedUser.value.capabilities = [...(selectedUser.value.capabilities || []), cap];
    } else {
      selectedUser.value.capabilities = selectedUser.value.capabilities?.filter(c => c !== cap) || [];
    }
    
    // Update in users list
    const userIndex = users.value.findIndex(u => u.id === selectedUser.value?.id);
    if (userIndex !== -1) {
      users.value[userIndex].capabilities = [...selectedUser.value.capabilities];
    }
    
    successMessage.value = `${cap} capability ${action}ed for ${selectedUser.value.email}`;
  } catch (e: any) {
    error.value = e?.response?.data?.error || `Failed to ${action} capability`;
  } finally {
    capabilityLoading.value = false;
  }
}

async function grantCredits() {
  if (!selectedUser.value || !grantAmount.value || !grantCurrency.value) return;
  
  grantingCredits.value = true;
  try {
    await api.post(`/admin/users/${selectedUser.value.id}/credits`, {
      amount: grantAmount.value,
      currency: grantCurrency.value
    });
    
    // Update local state
    selectedUser.value.balances = {
      ...selectedUser.value.balances,
      [grantCurrency.value]: (selectedUser.value.balances?.[grantCurrency.value] || 0) + grantAmount.value
    };
    
    // Update in users list
    const userIndex = users.value.findIndex(u => u.id === selectedUser.value?.id);
    if (userIndex !== -1) {
      users.value[userIndex].balances = { ...selectedUser.value.balances };
    }
    
    successMessage.value = `Granted ${grantAmount.value} ${grantCurrency.value} to ${selectedUser.value.email}`;
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Failed to grant credits';
  } finally {
    grantingCredits.value = false;
  }
}

async function reloadUser() {
  if (!selectedUser.value) return;
  
  reloadingUser.value = true;
  try {
    await api.post(`/admin/users/${selectedUser.value.id}/reload`);
    successMessage.value = `Reloaded user data for ${selectedUser.value.email}`;
    
    // Refresh the users list to get updated data
    await fetchUsers();
    
    // Update selected user with fresh data
    const freshUser = users.value.find(u => u.id === selectedUser.value?.id);
    if (freshUser) {
      selectedUser.value = { ...freshUser };
    }
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Failed to reload user';
  } finally {
    reloadingUser.value = false;
  }
}

async function verifyLegacyUsers() {
  if (!confirm('This will mark all users registered before Dec 8, 2025 as email-verified. Continue?')) {
    return;
  }
  
  verifyingLegacyUsers.value = true;
  try {
    const response = await api.post('/admin/verify-legacy-users', {
      beforeDate: '2025-12-08T00:00:00Z'
    });
    successMessage.value = response.data.message;
    if (response.data.verifiedUsers?.length > 0) {
      successMessage.value += `: ${response.data.verifiedUsers.join(', ')}`;
    }
    // Show debug info if present
    if (response.data.debug) {
      const debug = response.data.debug;
      console.log('[Admin] Legacy users debug:', debug);
      if (debug.skipped?.length > 0) {
        successMessage.value += ` (${debug.totalUsers} total, skipped: ${debug.skipped.map((s: any) => `${s.email}: ${s.reason}`).join('; ')})`;
      }
    }
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Failed to verify legacy users';
  } finally {
    verifyingLegacyUsers.value = false;
  }
}

async function setAllUsersAgeVerified() {
  if (!confirm('This will mark ALL existing users as age-verified (18+). This is for legacy users who registered before the age gate was added. Continue?')) {
    return;
  }
  
  settingAgeVerified.value = true;
  try {
    const response = await api.post('/admin/set-all-age-verified');
    successMessage.value = response.data.message || `Updated ${response.data.updatedCount} users`;
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Failed to set age verification';
  } finally {
    settingAgeVerified.value = false;
  }
}

async function setAllUsersTosAccepted() {
  if (!confirm('This will mark ALL existing users as having accepted the Terms of Service. This is for legacy users who registered before the ToS gate was added. Continue?')) {
    return;
  }
  
  settingTosAccepted.value = true;
  try {
    const response = await api.post('/admin/set-all-tos-accepted');
    successMessage.value = response.data.message || `Updated ${response.data.updatedCount} users`;
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Failed to set ToS acceptance';
  } finally {
    settingTosAccepted.value = false;
  }
}

onMounted(() => {
  refreshData();
});
</script>

<style scoped>
.admin-view {
  max-width: 1400px;
  margin: 0 auto;
}
</style>

