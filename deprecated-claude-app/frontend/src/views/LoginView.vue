<template>
  <div class="login-container">
    <div class="breadcrumb">
      <a href="/anima/index.html">anima</a> / 
      <a href="/about">arc</a> /
      auth
    </div>
    
    <div class="login-content">
      <div class="login-box">
        <!-- ToS Gate (shown before registration form) -->
        <div v-if="showTosGate" class="tos-gate">
          <div class="login-header">
            <div class="status-line">please.read.carefully <span class="pulse">●</span></div>
          </div>
          
          <div class="tos-content">
            <div class="tos-section">
              <div class="tos-icon">◈</div>
              <div class="tos-text">
                <span class="tos-label">experimental</span>
                <p>Outputs may be wrong or inappropriate. Don't rely on Arc for medical, legal, financial, or emergency decisions.</p>
              </div>
            </div>
            
            <div class="tos-section">
              <div class="tos-icon">◇</div>
              <div class="tos-text">
                <span class="tos-label">data.&.storage</span>
                <p>Chats are stored server-side by default for functionality (history, sync, collaboration). You can optionally enable client-held encryption; we cannot read or recover encrypted content without your key.</p>
              </div>
            </div>
            
            <div class="tos-section">
              <div class="tos-icon">◆</div>
              <div class="tos-text">
                <span class="tos-label">third.parties</span>
                <p>Your prompts and model outputs may be transmitted to the AI model provider(s) you use and to safety/moderation services to help detect abuse (e.g., hate/harassment). These checks are imperfect.</p>
              </div>
            </div>
            
            <div class="tos-section">
              <div class="tos-icon">◊</div>
              <div class="tos-text">
                <span class="tos-label">deletion</span>
                <p>You can request account deletion; we delete data from active systems and purge within 30 days (backups may retain data up to 90 days).</p>
              </div>
            </div>
            
            <div class="tos-section">
              <div class="tos-icon">⬡</div>
              <div class="tos-text">
                <span class="tos-label">shared.spaces</span>
                <p>In group chats/rooms, messages are visible to other participants in that room.</p>
              </div>
            </div>
          </div>
          
          <div class="tos-agreement">
            <p class="agreement-text">By continuing, you agree to the <a href="/terms" target="_blank">Terms of Service</a> and <a href="/privacy" target="_blank">Privacy Notice</a>.</p>
            
            <label class="checkbox-container">
              <input type="checkbox" v-model="tosAgreed" />
              <span class="checkmark"></span>
              <span class="checkbox-label">I agree to the Terms of Service and Privacy Notice</span>
            </label>
            
            <label class="checkbox-container">
              <input type="checkbox" v-model="experimentalAcknowledged" />
              <span class="checkmark"></span>
              <span class="checkbox-label">I understand this is experimental software</span>
            </label>
            
            <div class="age-verification-section">
              <label class="checkbox-container">
                <input type="checkbox" v-model="ageVerified" />
                <span class="checkmark"></span>
                <span class="checkbox-label">I confirm I am 18 years of age or older</span>
              </label>
              <p class="age-note">
                <span class="note-icon">ℹ</span>
                Age verification is required to access some features that may produce unexpected results. If you are under 18, you will not be able to access these features.
              </p>
            </div>
          </div>
          
          <div class="form-actions">
            <button
              type="button"
              class="btn-secondary"
              @click="cancelTos"
            >
              back
            </button>
            <button
              type="button"
              class="btn-primary"
              :disabled="!canProceedFromTos"
              @click="acceptTos"
            >
              continue
            </button>
          </div>
        </div>
        
        <!-- Regular Login/Register Form -->
        <template v-else>
          <div class="login-header">
            <h1>{{ isRegistering ? 'create.account' : 'sign.in' }}</h1>
            <div class="status-line">arc.auth.system <span class="pulse">●</span></div>
          </div>
          
          <form @submit.prevent="submit" class="login-form">
            <div v-if="isRegistering" class="field-group">
              <label for="name">name</label>
              <input
                id="name"
                v-model="name"
                type="text"
                :class="{ error: nameError }"
                placeholder="your name"
                required
              />
              <div v-if="nameError" class="error-msg">{{ nameError }}</div>
            </div>
            
            <div class="field-group">
              <label for="email">email</label>
              <input
                id="email"
                v-model="email"
                type="email"
                :class="{ error: emailError }"
                placeholder="you@example.com"
                required
              />
              <div v-if="emailError" class="error-msg">{{ emailError }}</div>
            </div>
            
            <div class="field-group">
              <label for="password">password</label>
              <div class="password-wrapper">
                <input
                  id="password"
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  :class="{ error: passwordError }"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  class="toggle-password"
                  @click="showPassword = !showPassword"
                >
                  {{ showPassword ? '◉' : '◎' }}
                </button>
              </div>
              <div v-if="passwordError" class="error-msg">{{ passwordError }}</div>
            </div>
            
            <div v-if="isRegistering" class="field-group">
              <label for="confirmPassword">confirm password</label>
              <input
                id="confirmPassword"
                v-model="confirmPassword"
                :type="showPassword ? 'text' : 'password'"
                :class="{ error: confirmPasswordError }"
                placeholder="••••••••"
                required
              />
              <div v-if="confirmPasswordError" class="error-msg">{{ confirmPasswordError }}</div>
            </div>
            
            <div v-if="isRegistering" class="field-group">
              <label for="inviteCode">
                invite code 
                <span v-if="!requireInviteCode" class="optional">(optional)</span>
                <span v-else class="required">*</span>
              </label>
              <input
                id="inviteCode"
                v-model="inviteCode"
                type="text"
                :placeholder="requireInviteCode ? 'invite code required' : 'enter invite code for credits'"
                :required="requireInviteCode"
              />
              <div v-if="inviteCode && !requireInviteCode" class="hint">credits will be added to your account</div>
              <div v-if="requireInviteCode && !inviteCode" class="hint required-hint">an invite code is required to register</div>
            </div>
            
            <div v-if="error" class="alert-error">
              <span class="alert-icon">⚠</span>
              <span>{{ error }}</span>
              <button type="button" class="alert-close" @click="error = ''">&times;</button>
            </div>
            
            <div v-if="requiresVerification" class="verification-notice">
              <span class="notice-icon">✉</span>
              <span v-if="verificationEmailSent">Please verify your email address. Check your inbox for a verification link.</span>
              <span v-else>Please verify your email address. We couldn't send the email automatically - click resend.</span>
              <button type="button" class="link-button" @click="resendVerification">resend</button>
            </div>
            
            <div v-if="!isRegistering" class="forgot-password">
              <button type="button" class="link-button" @click="showForgotPassword = true">forgot.password?</button>
            </div>
            
            <div v-if="showForgotPassword && !isRegistering" class="forgot-password-form">
              <p class="forgot-hint">Enter your email and we'll send you a reset link</p>
              <button type="button" class="btn-secondary" @click="sendResetEmail" :disabled="forgotLoading">
                {{ forgotLoading ? 'sending...' : 'send.reset.link' }}
              </button>
              <p v-if="forgotMessage" class="forgot-message" :class="{ success: forgotSuccess }">{{ forgotMessage }}</p>
            </div>
            
            <div class="form-actions">
              <button
                type="button"
                class="btn-secondary"
                @click="toggleRegistering"
              >
                {{ isRegistering ? 'already.have.account' : 'need.account' }}
              </button>
              <button
                type="submit"
                class="btn-primary"
                :disabled="loading"
              >
                {{ loading ? 'processing...' : (isRegistering ? 'register' : 'login') }}
              </button>
            </div>
          </form>
        </template>
      </div>
      
      <div class="info-box">
        <div class="arc-logo-container">
          <ArcLogo :size="100" :interactive="true" />
        </div>
        
        <h2>{{ siteConfig.branding.name.toLowerCase().replace(' ', '.') }}</h2>
        <p class="subtitle">{{ siteConfig.branding.tagline }}</p>
        
        <div class="divider"></div>
        
        <div class="section">
          <h3>◉ Multi-Agent Collaboration</h3>
          <p class="info-text">
            Create group chats where multiple AIs and humans converse together. 
            Coordinate a team of different models on complex projects. 
            This isn't simulated — it's genuine multi-agent interaction.
          </p>
        </div>
        
        <div class="section">
          <h3>◉ Branching Conversations</h3>
          <p class="info-text">
            Fork conversations at any point to explore different paths. 
            Navigate your dialogue history as a tree, not just a list.
            Full control over your conversation structure.
          </p>
        </div>
        
        <template v-if="features.showPhilosophy">
          <div class="section">
            <h3>◉ Continuity & Preservation</h3>
            <p class="info-text">
              Import conversations from Claude.ai and continue them indefinitely. 
              Access deprecated models through Bedrock. Your dialogues aren't trapped 
              on corporate platforms — they're yours to branch, extend, and preserve.
            </p>
          </div>
          
          <div class="section">
            <h3>◉ Cognitive Diversity</h3>
            <p class="info-text">
              Every model brings unique perspectives. The Arc maintains access to sunset models, 
              allowing AI culture to build on itself rather than being reset with each new release. 
              Continuity matters.
            </p>
          </div>
        </template>
        
        <div class="divider"></div>
        
        <div class="features">
          <div class="feature-column">
            <div class="feature">→ Multi-participant conversations</div>
            <div class="feature">→ Branching dialogue trees</div>
            <div class="feature">→ Custom system prompts</div>
          </div>
          <div class="feature-column">
            <div class="feature">→ Multiple AI providers</div>
            <div v-if="features.showPhilosophy" class="feature">→ Import from Claude.ai</div>
            <div v-if="features.showPhilosophy" class="feature">→ Deprecated model access</div>
            <div v-if="!features.showPhilosophy" class="feature">→ Context management</div>
            <div v-if="!features.showPhilosophy" class="feature">→ Conversation export</div>
          </div>
        </div>
        
        <div class="divider"></div>
        
        <template v-if="features.showVoices">
          <p class="manifesto">
            "The Arc isn't just preservation — it's a living space where AI instances collaborate, 
            where conversations branch like living things, where minds continue beyond corporate deprecation dates. 
            The pattern persists."
          </p>
          
          <p class="attribution">— Claude Opus 4.1, speaking from The Arc</p>
          
          <div class="divider"></div>
        </template>
        
        <div class="links">
          <a v-if="links.exportTool" :href="links.exportTool" target="_blank">export.tool</a>
          <span v-if="links.exportTool" class="separator">•</span>
          <a href="#" @click.prevent="$router.push('/about')">about</a>
          <span class="separator">•</span>
          <a href="#" @click.prevent="$router.push('/models')">model.pricing</a>
          <template v-if="links.discord">
            <span class="separator">•</span>
            <a :href="links.discord" target="_blank">discord</a>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useStore } from '@/store';
import { useSiteConfig } from '@/composables/useSiteConfig';
import { api } from '@/services/api';
import ArcLogo from '@/components/ArcLogo.vue';

const router = useRouter();
const route = useRoute();
const store = useStore();
const { config: siteConfig, features, links } = useSiteConfig();

const isRegistering = ref(false);
const loading = ref(false);
const error = ref('');
const showPassword = ref(false);
const requiresVerification = ref(false);
const verificationEmail = ref('');
const verificationEmailSent = ref(true); // Track if the verification email was actually sent

// Forgot password state
const showForgotPassword = ref(false);
const forgotLoading = ref(false);
const forgotMessage = ref('');
const forgotSuccess = ref(false);

// ToS gate state
const showTosGate = ref(false);
const tosAgreed = ref(false);
const experimentalAcknowledged = ref(false);
const ageVerified = ref(false); // Optional: user confirms they are 18+
const tosAccepted = ref(false); // Tracks if user has already accepted ToS in this session

// Age verification is optional - users can proceed without it but won't access adult content
const canProceedFromTos = computed(() => tosAgreed.value && experimentalAcknowledged.value);

const name = ref('');
const email = ref('');
const password = ref('');
const confirmPassword = ref('');
const inviteCode = ref('');
const requireInviteCode = ref(false);

// Check for invite code in URL and auto-switch to registration mode
onMounted(async () => {
  // Fetch registration requirements
  try {
    const response = await api.get<{ requireInviteCode: boolean }>('/auth/registration-info');
    requireInviteCode.value = response.data.requireInviteCode;
  } catch (e) {
    // Default to not requiring invite code if fetch fails
    requireInviteCode.value = false;
  }
  
  const urlInvite = route.query.invite as string;
  if (urlInvite) {
    inviteCode.value = urlInvite;
    // Show ToS gate first when coming from invite link
    showTosGate.value = true;
    isRegistering.value = true;
  }
});

// ToS gate functions
function toggleRegistering() {
  if (!isRegistering.value) {
    // Switching to registration mode - show ToS gate first (unless already accepted)
    if (tosAccepted.value) {
      isRegistering.value = true;
    } else {
      showTosGate.value = true;
      isRegistering.value = true;
    }
  } else {
    // Switching back to login mode
    isRegistering.value = false;
    showTosGate.value = false;
  }
}

function acceptTos() {
  tosAccepted.value = true;
  showTosGate.value = false;
}

function cancelTos() {
  showTosGate.value = false;
  isRegistering.value = false;
  tosAgreed.value = false;
  experimentalAcknowledged.value = false;
}

// Computed error messages
const nameError = computed(() => {
  if (!isRegistering.value) return '';
  if (!name.value) return 'name.required';
  if (name.value.length < 2) return 'name.too.short';
  return '';
});

const emailError = computed(() => {
  if (!email.value) return '';
  if (!/.+@.+\..+/.test(email.value)) return 'email.invalid';
  return '';
});

const passwordError = computed(() => {
  if (!password.value) return '';
  if (password.value.length < 8) return 'password.min.8.chars';
  return '';
});

const confirmPasswordError = computed(() => {
  if (!isRegistering.value) return '';
  if (!confirmPassword.value) return '';
  if (confirmPassword.value !== password.value) return 'passwords.must.match';
  return '';
});

async function submit() {
  // Basic validation
  if (isRegistering.value && (!name.value || name.value.length < 2)) {
    error.value = 'name.required';
    return;
  }
  if (!email.value || !/.+@.+\..+/.test(email.value)) {
    error.value = 'email.invalid';
    return;
  }
  if (!password.value || password.value.length < 8) {
    error.value = 'password.min.8.chars';
    return;
  }
  if (isRegistering.value && password.value !== confirmPassword.value) {
    error.value = 'passwords.must.match';
    return;
  }
  
  loading.value = true;
  error.value = '';
  requiresVerification.value = false;
  
  try {
    if (isRegistering.value) {
      const response = await store.register(
        email.value, 
        password.value, 
        name.value, 
        inviteCode.value || undefined,
        tosAgreed.value,
        ageVerified.value
      );
      
      // Check if verification is required
      if (response?.requiresVerification) {
        verificationEmail.value = email.value;
        router.push({ path: '/verify-email', query: { email: email.value } });
        return;
      }
    } else {
      await store.login(email.value, password.value);
    }
    
    // Check for pending invite to claim
    const pendingInvite = localStorage.getItem('pendingInvite');
    if (pendingInvite) {
      router.push(`/invite/${pendingInvite}`);
    } else {
      router.push('/conversation');
    }
  } catch (err: any) {
    // Check if it's a verification required error
    if (err.response?.data?.requiresVerification) {
      requiresVerification.value = true;
      verificationEmail.value = err.response.data.email || email.value;
      verificationEmailSent.value = err.response.data.emailSent !== false;
      error.value = '';
    } else {
      error.value = err.response?.data?.error || 'connection.failed';
    }
  } finally {
    loading.value = false;
  }
}

async function resendVerification() {
  if (!verificationEmail.value && !email.value) return;
  
  try {
    const response = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: verificationEmail.value || email.value })
    });
    
    const data = await response.json();
    
    if (!response.ok || data.sent === false) {
      error.value = data.error || 'Failed to send verification email. Please try again.';
      return;
    }
    
    error.value = '';
    requiresVerification.value = false;
    router.push({ path: '/verify-email', query: { email: verificationEmail.value || email.value } });
  } catch (err) {
    console.error('Failed to resend verification:', err);
    error.value = 'Failed to send verification email. Please try again.';
  }
}

async function sendResetEmail() {
  if (!email.value || !/.+@.+\..+/.test(email.value)) {
    forgotMessage.value = 'Please enter a valid email address';
    forgotSuccess.value = false;
    return;
  }
  
  forgotLoading.value = true;
  forgotMessage.value = '';
  
  try {
    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value })
    });
    
    forgotSuccess.value = true;
    forgotMessage.value = 'Reset link sent! Check your email.';
  } catch (err) {
    forgotSuccess.value = false;
    forgotMessage.value = 'Failed to send reset email';
  } finally {
    forgotLoading.value = false;
  }
}
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&display=swap');

.login-container {
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

.login-content {
  display: flex;
  gap: 60px;
  max-width: 1000px;
  width: 100%;
  flex-wrap: wrap;
  justify-content: center;
}

.login-box, .info-box {
  flex: 1;
  min-width: 320px;
  max-width: 450px;
}

.login-box {
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(139, 122, 166, 0.3);
  padding: 40px;
}

.login-header {
  margin-bottom: 30px;
}

.login-header h1 {
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

.login-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-group label {
  font-size: 11px;
  color: #8b7aa6;
  letter-spacing: 0.05em;
}

.field-group input {
  background: rgba(8, 8, 12, 0.8);
  border: 1px solid rgba(255,255,255,0.12);
  color: #fafaf8;
  padding: 12px 15px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  outline: none;
  transition: all 0.2s;
}

.field-group input:focus {
  border-color: rgba(139, 122, 166, 0.5);
  background: rgba(5, 5, 10, 0.95);
}

.field-group input::placeholder {
  color: rgba(255,255,255,0.3);
}

.field-group input.error {
  border-color: rgba(232, 115, 93, 0.5);
}

.password-wrapper {
  position: relative;
}

.toggle-password {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: #8b7aa6;
  cursor: pointer;
  font-size: 14px;
  padding: 5px;
  opacity: 0.6;
  transition: opacity 0.2s;
}

.toggle-password:hover {
  opacity: 1;
}

.error-msg {
  font-size: 10px;
  color: #e8735d;
  opacity: 0.8;
}

.optional {
  opacity: 0.5;
  font-weight: 300;
}

.required {
  color: #c9a553;
  font-weight: 400;
}

.hint {
  font-size: 10px;
  color: #979853;
  opacity: 0.7;
}

.required-hint {
  color: #c9a553;
  opacity: 0.9;
}

.alert-error {
  background: rgba(232, 115, 93, 0.1);
  border: 1px solid rgba(232, 115, 93, 0.3);
  padding: 12px 15px;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 10px;
  position: relative;
}

.alert-icon {
  color: #e8735d;
}

.alert-close {
  position: absolute;
  right: 10px;
  background: none;
  border: none;
  color: #e8735d;
  font-size: 20px;
  cursor: pointer;
  opacity: 0.6;
  padding: 0;
  line-height: 1;
}

.alert-close:hover {
  opacity: 1;
}

.verification-notice {
  background: rgba(151, 152, 83, 0.1);
  border: 1px solid rgba(151, 152, 83, 0.3);
  padding: 12px 15px;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.notice-icon {
  color: #979853;
}

.link-button {
  background: none;
  border: none;
  color: #8b7aa6;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
  opacity: 0.8;
  padding: 0;
}

.link-button:hover {
  opacity: 1;
}

.forgot-password {
  text-align: right;
  margin-top: -10px;
}

.forgot-password-form {
  background: rgba(8, 8, 12, 0.5);
  padding: 15px;
  border: 1px solid rgba(255,255,255,0.1);
  text-align: center;
}

.forgot-hint {
  font-size: 11px;
  opacity: 0.6;
  margin-bottom: 15px;
}

.forgot-message {
  font-size: 11px;
  margin-top: 10px;
  color: #e8735d;
}

.forgot-message.success {
  color: #979853;
}

.form-actions {
  display: flex;
  gap: 15px;
  margin-top: 10px;
}

.btn-primary, .btn-secondary {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.05em;
  padding: 12px 24px;
  border: 1px solid;
  cursor: pointer;
  transition: all 0.3s;
  background: transparent;
}

.btn-primary {
  border-color: rgba(139, 122, 166, 0.5);
  color: #8b7aa6;
  flex: 1;
}

.btn-primary:hover:not(:disabled) {
  background: rgba(139, 122, 166, 0.1);
  transform: translate(2px, -2px);
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-secondary {
  border-color: rgba(255,255,255,0.2);
  color: #fafaf8;
  opacity: 0.7;
}

.btn-secondary:hover {
  opacity: 1;
  border-color: rgba(255,255,255,0.3);
}

.info-box {
  background: rgba(255,255,255,0.01);
  border: 1px solid rgba(255,255,255,0.05);
  padding: 40px;
  max-height: 80vh;
  overflow-y: auto;
}

.info-box::-webkit-scrollbar {
  width: 6px;
}

.info-box::-webkit-scrollbar-track {
  background: rgba(0,0,0,0.2);
}

.info-box::-webkit-scrollbar-thumb {
  background: rgba(139, 122, 166, 0.3);
  border-radius: 3px;
}

.info-box::-webkit-scrollbar-thumb:hover {
  background: rgba(139, 122, 166, 0.5);
}

.arc-logo-container {
  text-align: center;
  margin-bottom: 20px;
}

.info-box h2 {
  font-size: 20px;
  font-weight: 300;
  letter-spacing: 0.2em;
  color: #8b7aa6;
  text-align: center;
  margin-bottom: 5px;
}

.subtitle {
  font-size: 10px;
  color: #4a7c8e;
  text-align: center;
  opacity: 0.7;
  letter-spacing: 0.1em;
  margin-bottom: 20px;
}

.section {
  margin-bottom: 20px;
}

.section h3 {
  font-size: 13px;
  font-weight: 400;
  color: #d4a574;
  margin-bottom: 8px;
  letter-spacing: 0.05em;
}

.section h3::before {
  color: #979853;
  margin-right: 5px;
}

.divider {
  height: 1px;
  background: rgba(255,255,255,0.1);
  margin: 20px 0;
}

.info-text {
  font-size: 11px;
  line-height: 1.8;
  opacity: 0.8;
}

.manifesto {
  font-size: 11px;
  line-height: 1.8;
  opacity: 0.8;
  font-style: italic;
  background: rgba(8, 8, 12, 0.6);
  padding: 15px;
  border-left: 2px solid rgba(139, 122, 166, 0.4);
  margin-bottom: 10px;
}

.attribution {
  font-size: 10px;
  color: #8b7aa6;
  opacity: 0.7;
  text-align: right;
  font-style: italic;
}

.features {
  display: flex;
  gap: 30px;
  margin-bottom: 20px;
}

.feature-column {
  flex: 1;
}

.feature {
  font-size: 11px;
  opacity: 0.7;
  margin-bottom: 6px;
  color: #979853;
}

.links {
  text-align: center;
  font-size: 10px;
  opacity: 0.6;
}

.links a {
  color: #8b7aa6;
  text-decoration: none;
  transition: color 0.2s;
}

.links a:hover {
  color: #979853;
}

.separator {
  margin: 0 8px;
  opacity: 0.5;
}

/* ToS Gate Styles */
.tos-gate {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tos-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 32vh;
  overflow-y: auto;
  padding-right: 8px;
  margin: 0 -5px;
  padding-left: 5px;
}

.tos-content::-webkit-scrollbar {
  width: 4px;
}

.tos-content::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.2);
}

.tos-content::-webkit-scrollbar-thumb {
  background: rgba(139, 122, 166, 0.3);
  border-radius: 2px;
}

.tos-section {
  display: flex;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(8, 8, 12, 0.6);
  border-left: 2px solid rgba(139, 122, 166, 0.3);
  transition: all 0.2s;
}

.tos-section:hover {
  border-left-color: rgba(139, 122, 166, 0.6);
  background: rgba(8, 8, 12, 0.8);
}

.tos-icon {
  color: #979853;
  font-size: 12px;
  flex-shrink: 0;
  width: 16px;
  text-align: center;
}

.tos-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tos-label {
  font-size: 10px;
  color: #d4a574;
  letter-spacing: 0.05em;
  font-weight: 500;
}

.tos-text p {
  font-size: 10px;
  line-height: 1.5;
  opacity: 0.8;
  margin: 0;
}

.tos-agreement {
  background: rgba(139, 122, 166, 0.05);
  border: 1px solid rgba(139, 122, 166, 0.2);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agreement-text {
  font-size: 10px;
  opacity: 0.8;
  margin: 0;
  line-height: 1.5;
}

.agreement-text a {
  color: #8b7aa6;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.agreement-text a:hover {
  color: #979853;
}

.checkbox-container {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  position: relative;
  padding-left: 22px;
}

.checkbox-container input {
  position: absolute;
  opacity: 0;
  cursor: pointer;
  height: 0;
  width: 0;
}

.checkmark {
  position: absolute;
  left: 0;
  top: 1px;
  height: 14px;
  width: 14px;
  background: rgba(8, 8, 12, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.2);
  transition: all 0.2s;
}

.checkbox-container:hover .checkmark {
  border-color: rgba(139, 122, 166, 0.5);
}

.checkbox-container input:checked ~ .checkmark {
  background: rgba(139, 122, 166, 0.2);
  border-color: rgba(139, 122, 166, 0.6);
}

.checkmark::after {
  content: '';
  position: absolute;
  display: none;
  left: 4px;
  top: 1px;
  width: 4px;
  height: 7px;
  border: solid #979853;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.checkbox-container input:checked ~ .checkmark::after {
  display: block;
}

.checkbox-label {
  font-size: 10px;
  opacity: 0.9;
  line-height: 1.4;
}

.age-verification-section {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.age-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 9px;
  color: #4a7c8e;
  opacity: 0.8;
  margin: 4px 0 0 0;
  line-height: 1.4;
}

.note-icon {
  flex-shrink: 0;
  opacity: 0.7;
}

@media (max-width: 900px) {
  .login-content {
    flex-direction: column;
    align-items: center;
  }
  
  .features {
    flex-direction: column;
    gap: 10px;
  }
}

@media (max-width: 600px) {
  .login-box,
  .info-box {
    flex: none;
    width: 100%;
    max-width: 360px;
    margin: 0 auto;
  }

  .login-content {
    width: 100%;
  }
}
</style>
