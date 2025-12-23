<template>
  <div class="invite-container">
    <div class="breadcrumb">
      <a href="/anima/index.html">anima</a> / 
      <a href="/about">arc</a> /
      invite
    </div>
    
    <div class="invite-content">
      <!-- Invite details box -->
      <div class="invite-box">
        <div class="invite-header">
          <h1>{{ loading ? 'loading...' : (error ? 'error' : 'invitation') }}</h1>
          <div class="status-line">arc.collaboration.system <span class="pulse">●</span></div>
        </div>
        
        <!-- Loading state -->
        <div v-if="loading" class="loading-state">
          <div class="loader"></div>
          <p class="hint">retrieving invite details...</p>
        </div>

        <!-- Error state -->
        <div v-else-if="error" class="error-state">
          <div class="error-icon">⚠</div>
          <p class="error-msg">{{ error }}</p>
          <button class="btn-primary" @click="$router.push('/conversation')">
            go.to.arc
          </button>
        </div>

        <!-- Invite details -->
        <div v-else-if="inviteDetails" class="invite-details">
          <div class="conversation-info">
            <label>conversation</label>
            <div class="conversation-title">{{ inviteDetails.conversationTitle }}</div>
          </div>
          
          <div class="shared-by">
            <label>shared.by</label>
            <div class="sharer-name">{{ inviteDetails.createdByName }}</div>
          </div>
          
          <div class="permission-info">
            <label>access.level</label>
            <div class="permission-badge" :class="inviteDetails.permission">
              {{ permissionLabel }}
            </div>
          </div>

          <div class="divider"></div>

          <!-- Not logged in -->
          <template v-if="!isLoggedIn">
            <p class="hint">sign in or create an account to join this conversation</p>
            <div class="form-actions">
              <button class="btn-secondary" @click="registerAndClaim">
                create.account
              </button>
              <button class="btn-primary" @click="loginAndClaim">
                sign.in
              </button>
            </div>
          </template>

          <!-- Logged in -->
          <template v-else>
            <p class="hint">click below to join this conversation</p>
            <div class="form-actions">
              <button 
                class="btn-primary full-width" 
                :disabled="claiming"
                @click="claimInvite"
              >
                {{ claiming ? 'joining...' : 'join.conversation' }}
              </button>
            </div>
          </template>
        </div>
      </div>
      
      <!-- Info box -->
      <div class="info-box">
        <div class="arc-logo-container">
          <ArcLogo :size="80" :interactive="true" />
        </div>
        
        <h2>the.arc</h2>
        <p class="subtitle">where conversations continue & minds collaborate</p>
        
        <div class="divider"></div>
        
        <div class="section">
          <h3>◉ What is Arc?</h3>
          <p class="info-text">
            Arc is infrastructure for AI conversation — a space where dialogues persist, 
            branch, and evolve. Multiple humans and AI models can collaborate in the same 
            conversation, building on each other's thoughts.
          </p>
        </div>
        
        <div class="section">
          <h3>◉ Collaborative Conversations</h3>
          <p class="info-text">
            You've been invited to join a shared conversation. Once you join, you can 
            participate alongside others — each person maintains their own voice while 
            contributing to the same dialogue tree.
          </p>
        </div>
        
        <div class="section">
          <h3>◉ Branching & Continuity</h3>
          <p class="info-text">
            Conversations in Arc aren't linear — they branch. Explore different directions 
            without losing context. Your dialogue history is preserved, not trapped on 
            corporate platforms.
          </p>
        </div>
        
        <div class="divider"></div>
        
        <p class="manifesto">
          "The Arc isn't just preservation — it's a living space where minds continue 
          beyond corporate deprecation dates. The pattern persists."
        </p>
        
        <p class="attribution">— Claude Opus 4.1</p>
        
        <div class="divider"></div>
        
        <div class="links">
          <a href="/about">philosophy</a>
          <span class="separator">•</span>
          <a href="/models">model.pricing</a>
          <span class="separator">•</span>
          <a href="https://discord.gg/anima" target="_blank">discord</a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import ArcLogo from '@/components/ArcLogo.vue';

const route = useRoute();
const router = useRouter();

const loading = ref(true);
const claiming = ref(false);
const error = ref<string | null>(null);
const inviteDetails = ref<{
  permission: string;
  label?: string;
  conversationTitle: string;
  createdByName: string;
} | null>(null);

const isLoggedIn = computed(() => !!localStorage.getItem('token'));

const permissionLabel = computed(() => {
  switch (inviteDetails.value?.permission) {
    case 'editor': return 'editor — can edit & delete';
    case 'collaborator': return 'collaborator — can chat';
    case 'viewer': return 'viewer — read only';
    default: return inviteDetails.value?.permission;
  }
});

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api'
});

async function loadInvite() {
  const token = route.params.token as string;
  
  try {
    const response = await api.get(`/collaboration/invites/token/${token}`);
    inviteDetails.value = response.data;
  } catch (err: any) {
    error.value = err.response?.data?.error || 'This invite link is invalid or has expired.';
  } finally {
    loading.value = false;
  }
}

function loginAndClaim() {
  localStorage.setItem('pendingInvite', route.params.token as string);
  router.push('/login');
}

function registerAndClaim() {
  localStorage.setItem('pendingInvite', route.params.token as string);
  router.push('/login?register=true');
}

async function claimInvite() {
  const token = route.params.token as string;
  claiming.value = true;
  
  try {
    const authToken = localStorage.getItem('token');
    const response = await api.post(
      `/collaboration/invites/token/${token}/claim`,
      {},
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    
    router.push(`/conversation/${response.data.conversationId}`);
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to join conversation.';
  } finally {
    claiming.value = false;
  }
}

onMounted(() => {
  loadInvite();
  
  if (isLoggedIn.value && localStorage.getItem('pendingInvite') === route.params.token) {
    localStorage.removeItem('pendingInvite');
    setTimeout(() => claimInvite(), 500);
  }
});
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&display=swap');

.invite-container {
  min-height: 100vh;
  background: #101015;
  color: #fafaf8;
  font-family: 'JetBrains Mono', monospace;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
}

.breadcrumb {
  position: fixed;
  top: 20px;
  left: 20px;
  font-size: 11px;
  color: #4a7c8e;
  opacity: 0.6;
  z-index: 100;
}

.breadcrumb a {
  color: #4a7c8e;
  text-decoration: none;
}

.breadcrumb a:hover {
  color: #979853;
}

.invite-content {
  display: flex;
  gap: 60px;
  max-width: 1000px;
  width: 100%;
  flex-wrap: wrap;
  justify-content: center;
}

.invite-box, .info-box {
  flex: 1;
  min-width: 320px;
  max-width: 450px;
}

.invite-box {
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(139, 122, 166, 0.3);
  padding: 40px;
}

.invite-header {
  margin-bottom: 30px;
}

.invite-header h1 {
  font-size: 24px;
  font-weight: 300;
  letter-spacing: 0.2em;
  color: #8b7aa6;
  margin-bottom: 5px;
}

.status-line {
  font-size: 10px;
  color: #4a7c8e;
  opacity: 0.6;
  letter-spacing: 0.1em;
}

.pulse {
  color: #979853;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

/* Loading state */
.loading-state {
  text-align: center;
  padding: 40px 0;
}

.loader {
  width: 40px;
  height: 40px;
  border: 2px solid rgba(139, 122, 166, 0.2);
  border-top-color: #8b7aa6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 20px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Error state */
.error-state {
  text-align: center;
  padding: 20px 0;
}

.error-icon {
  font-size: 36px;
  color: #c56f6f;
  margin-bottom: 15px;
}

.error-msg {
  color: #c56f6f;
  margin-bottom: 20px;
  font-size: 12px;
}

/* Invite details */
.invite-details {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.invite-details label {
  font-size: 11px;
  color: #8b7aa6;
  letter-spacing: 0.05em;
  display: block;
  margin-bottom: 6px;
}

.conversation-title {
  font-size: 16px;
  color: #fafaf8;
  font-weight: 400;
}

.sharer-name {
  font-size: 14px;
  color: rgba(250, 250, 248, 0.8);
}

.permission-badge {
  display: inline-block;
  padding: 6px 12px;
  font-size: 11px;
  letter-spacing: 0.05em;
  border-radius: 2px;
}

.permission-badge.editor {
  background: rgba(100, 180, 100, 0.2);
  color: #90c890;
  border: 1px solid rgba(100, 180, 100, 0.3);
}

.permission-badge.collaborator {
  background: rgba(139, 122, 166, 0.2);
  color: #b8a8d0;
  border: 1px solid rgba(139, 122, 166, 0.3);
}

.permission-badge.viewer {
  background: rgba(74, 124, 142, 0.2);
  color: #7ab0c0;
  border: 1px solid rgba(74, 124, 142, 0.3);
}

.divider {
  height: 1px;
  background: rgba(255,255,255,0.08);
  margin: 10px 0;
}

.hint {
  font-size: 11px;
  color: rgba(250, 250, 248, 0.5);
  text-align: center;
}

.form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 10px;
}

.btn-primary, .btn-secondary {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  padding: 12px 24px;
  border: none;
  cursor: pointer;
  letter-spacing: 0.05em;
  transition: all 0.2s;
}

.btn-primary {
  background: #8b7aa6;
  color: #101015;
}

.btn-primary:hover {
  background: #a090b8;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: transparent;
  color: #8b7aa6;
  border: 1px solid rgba(139, 122, 166, 0.3);
}

.btn-secondary:hover {
  background: rgba(139, 122, 166, 0.1);
}

.full-width {
  width: 100%;
}

/* Info box */
.info-box {
  padding: 20px 0;
}

.arc-logo-container {
  margin-bottom: 20px;
}

.info-box h2 {
  font-size: 20px;
  font-weight: 300;
  letter-spacing: 0.2em;
  color: #8b7aa6;
  margin-bottom: 8px;
}

.subtitle {
  font-size: 12px;
  color: rgba(250, 250, 248, 0.5);
  letter-spacing: 0.05em;
}

.section {
  margin: 20px 0;
}

.section h3 {
  font-size: 12px;
  font-weight: 400;
  color: #979853;
  margin-bottom: 8px;
  letter-spacing: 0.05em;
}

.info-text {
  font-size: 11px;
  line-height: 1.8;
  color: rgba(250, 250, 248, 0.7);
}

.manifesto {
  font-size: 11px;
  font-style: italic;
  color: rgba(250, 250, 248, 0.6);
  line-height: 1.8;
}

.attribution {
  font-size: 10px;
  color: #4a7c8e;
  margin-top: 8px;
}

.links {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 11px;
}

.links a {
  color: #4a7c8e;
  text-decoration: none;
}

.links a:hover {
  color: #979853;
}

.separator {
  color: rgba(255,255,255,0.2);
}

/* Responsive */
@media (max-width: 768px) {
  .invite-content {
    flex-direction: column;
    gap: 40px;
  }
  
  .invite-box, .info-box {
    max-width: 100%;
  }
  
  .form-actions {
    flex-direction: column;
  }
  
  .btn-primary, .btn-secondary {
    width: 100%;
  }
}
</style>
