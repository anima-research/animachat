<template>
  <div class="verify-container">
    <div class="breadcrumb">
      <a href="/anima/index.html">anima</a> / 
      <a href="/about">arc</a> /
      verify
    </div>
    
    <div class="verify-box">
      <div class="verify-header">
        <h1>{{ state }}</h1>
        <div class="status-line">arc.email.verification <span class="pulse" :class="{ error: state === 'error', success: state === 'verified' }">●</span></div>
      </div>
      
      <div v-if="state === 'verifying'" class="loading">
        <div class="spinner"></div>
        <p>Verifying your email address...</p>
      </div>
      
      <div v-else-if="state === 'verified'" class="success">
        <div class="icon">✓</div>
        <p>Your email has been verified successfully!</p>
        <p class="sub">Redirecting to the app...</p>
      </div>
      
      <div v-else-if="state === 'error'" class="error-state">
        <div class="icon">✗</div>
        <p>{{ errorMessage }}</p>
        <div class="resend-form">
          <p class="sub">Enter your email to request a new verification link:</p>
          <input 
            v-model="email" 
            type="email" 
            placeholder="your@email.com"
            class="email-input"
          />
        </div>
        <div class="actions">
          <button class="btn-primary" @click="resendVerification" :disabled="resending || !email">
            {{ resending ? 'sending...' : 'resend.verification' }}
          </button>
          <button class="btn-secondary" @click="$router.push('/login')">back.to.login</button>
        </div>
        <div v-if="resendMessage" class="message" :class="{ success: !resendError }">
          {{ resendMessage }}
        </div>
      </div>
      
      <div v-else-if="state === 'pending'" class="pending">
        <div class="icon">✉</div>
        <p>Please check your email for a verification link.</p>
        <p class="sub">Didn't receive it?</p>
        <div class="actions">
          <button class="btn-primary" @click="resendVerification" :disabled="resending">
            {{ resending ? 'sending...' : 'resend.verification' }}
          </button>
        </div>
        <div v-if="resendMessage" class="message" :class="{ success: !resendError }">
          {{ resendMessage }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from '@/store';
import { api } from '@/services/api';

const route = useRoute();
const router = useRouter();
const store = useStore();

const state = ref<'verifying' | 'verified' | 'error' | 'pending'>('verifying');
const errorMessage = ref('');
const resending = ref(false);
const resendMessage = ref('');
const resendError = ref(false);
const email = ref('');

onMounted(async () => {
  const token = route.query.token as string;
  const pendingEmail = route.query.email as string;
  
  if (pendingEmail) {
    // Came from registration, show pending state
    email.value = pendingEmail;
    state.value = 'pending';
    return;
  }
  
  if (!token) {
    state.value = 'error';
    errorMessage.value = 'No verification token provided';
    return;
  }
  
  try {
    const response = await api.post('/auth/verify-email', { token });
    
    if (response.data.token) {
      // Store the auth token and user
      localStorage.setItem('token', response.data.token);
      store.state.user = response.data.user;
      store.state.isAuthenticated = true;
      
      state.value = 'verified';
      
      // Redirect after a short delay
      setTimeout(() => {
        router.push('/conversation');
      }, 2000);
    }
  } catch (error: any) {
    state.value = 'error';
    errorMessage.value = error.response?.data?.error || 'Verification failed. The link may be expired.';
  }
});

async function resendVerification() {
  if (!email.value) {
    resendError.value = true;
    resendMessage.value = 'Email address not available. Please register again.';
    return;
  }
  
  resending.value = true;
  resendMessage.value = '';
  
  try {
    const response = await api.post('/auth/resend-verification', { email: email.value });
    
    // Check if email was actually sent (handles 200 OK but sent: false case)
    if (response.data.sent === false) {
      resendError.value = true;
      resendMessage.value = response.data.error || 'Failed to send verification email. Please try again.';
      return;
    }
    
    resendError.value = false;
    resendMessage.value = 'Verification email sent! Please check your inbox.';
  } catch (error: any) {
    resendError.value = true;
    resendMessage.value = error.response?.data?.error || 'Failed to send verification email';
  } finally {
    resending.value = false;
  }
}
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&display=swap');

.verify-container {
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

.verify-box {
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(139, 122, 166, 0.3);
  padding: 60px;
  max-width: 450px;
  width: 100%;
  text-align: center;
}

.verify-header {
  margin-bottom: 40px;
}

.verify-header h1 {
  font-size: 24px;
  font-weight: 300;
  letter-spacing: 0.2em;
  color: #8b7aa6;
  margin-bottom: 5px;
  text-transform: lowercase;
}

.status-line {
  font-size: 10px;
  color: #4a7c8e;
  opacity: 0.6;
  letter-spacing: 0.1em;
}

.pulse {
  animation: pulse 2s infinite;
}

.pulse.error {
  color: #e8735d;
}

.pulse.success {
  color: #979853;
}

@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 2px solid rgba(139, 122, 166, 0.2);
  border-top-color: #8b7aa6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.icon {
  font-size: 48px;
  margin-bottom: 20px;
}

.success .icon {
  color: #979853;
}

.error-state .icon {
  color: #e8735d;
}

.pending .icon {
  color: #8b7aa6;
  font-size: 36px;
}

.resend-form {
  margin: 20px 0;
  text-align: center;
}

.resend-form .sub {
  margin-bottom: 15px;
}

.email-input {
  background: rgba(8, 8, 12, 0.8);
  border: 1px solid rgba(255,255,255,0.12);
  color: #fafaf8;
  padding: 12px 15px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  outline: none;
  transition: all 0.2s;
  width: 100%;
  max-width: 280px;
}

.email-input:focus {
  border-color: rgba(139, 122, 166, 0.5);
  background: rgba(5, 5, 10, 0.95);
}

.email-input::placeholder {
  color: rgba(255,255,255,0.3);
}

p {
  font-size: 14px;
  line-height: 1.6;
  opacity: 0.8;
  margin-bottom: 10px;
}

.sub {
  font-size: 12px;
  opacity: 0.5;
}

.actions {
  display: flex;
  gap: 15px;
  justify-content: center;
  margin-top: 30px;
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

.message {
  margin-top: 20px;
  padding: 10px 15px;
  font-size: 12px;
  background: rgba(232, 115, 93, 0.1);
  border: 1px solid rgba(232, 115, 93, 0.3);
}

.message.success {
  background: rgba(151, 152, 83, 0.1);
  border-color: rgba(151, 152, 83, 0.3);
  color: #979853;
}
</style>

