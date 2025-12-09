<template>
  <div class="reset-container">
    <div class="breadcrumb">
      <a href="/anima/index.html">anima</a> / 
      <a href="/about">arc</a> /
      reset
    </div>
    
    <div class="reset-box">
      <div class="reset-header">
        <h1>{{ state === 'success' ? 'password.reset' : 'reset.password' }}</h1>
        <div class="status-line">arc.auth.system <span class="pulse" :class="{ error: state === 'error', success: state === 'success' }">●</span></div>
      </div>
      
      <div v-if="state === 'loading'" class="loading">
        <div class="spinner"></div>
        <p>Validating reset token...</p>
      </div>
      
      <div v-else-if="state === 'error'" class="error-state">
        <div class="icon">✗</div>
        <p>{{ errorMessage }}</p>
        <div class="actions">
          <button class="btn-primary" @click="$router.push('/login')">back.to.login</button>
        </div>
      </div>
      
      <div v-else-if="state === 'success'" class="success">
        <div class="icon">✓</div>
        <p>Your password has been reset successfully!</p>
        <div class="actions">
          <button class="btn-primary" @click="$router.push('/login')">sign.in</button>
        </div>
      </div>
      
      <form v-else @submit.prevent="submitReset" class="reset-form">
        <div class="field-group">
          <label for="password">new password</label>
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
        
        <div class="field-group">
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
        
        <div v-if="submitError" class="alert-error">
          <span class="alert-icon">⚠</span>
          <span>{{ submitError }}</span>
        </div>
        
        <div class="actions">
          <button type="submit" class="btn-primary" :disabled="submitting">
            {{ submitting ? 'resetting...' : 'reset.password' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/services/api';

const route = useRoute();
const router = useRouter();

const state = ref<'loading' | 'form' | 'success' | 'error'>('loading');
const errorMessage = ref('');
const token = ref('');

const password = ref('');
const confirmPassword = ref('');
const showPassword = ref(false);
const submitting = ref(false);
const submitError = ref('');

const passwordError = computed(() => {
  if (!password.value) return '';
  if (password.value.length < 8) return 'password.min.8.chars';
  return '';
});

const confirmPasswordError = computed(() => {
  if (!confirmPassword.value) return '';
  if (confirmPassword.value !== password.value) return 'passwords.must.match';
  return '';
});

onMounted(async () => {
  const urlToken = route.query.token as string;
  
  if (!urlToken) {
    state.value = 'error';
    errorMessage.value = 'No reset token provided';
    return;
  }
  
  token.value = urlToken;
  
  try {
    const response = await api.get(`/auth/reset-password/${urlToken}`);
    
    if (response.data.valid) {
      state.value = 'form';
    } else {
      state.value = 'error';
      errorMessage.value = 'Invalid or expired reset token';
    }
  } catch (error: any) {
    state.value = 'error';
    errorMessage.value = error.response?.data?.error || 'Invalid or expired reset token';
  }
});

async function submitReset() {
  if (password.value.length < 8) {
    submitError.value = 'Password must be at least 8 characters';
    return;
  }
  
  if (password.value !== confirmPassword.value) {
    submitError.value = 'Passwords do not match';
    return;
  }
  
  submitting.value = true;
  submitError.value = '';
  
  try {
    await api.post('/auth/reset-password', {
      token: token.value,
      password: password.value
    });
    
    state.value = 'success';
  } catch (error: any) {
    submitError.value = error.response?.data?.error || 'Failed to reset password';
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&display=swap');

.reset-container {
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

.reset-box {
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(139, 122, 166, 0.3);
  padding: 60px;
  max-width: 450px;
  width: 100%;
}

.reset-header {
  margin-bottom: 40px;
  text-align: center;
}

.reset-header h1 {
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
  text-align: center;
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
  text-align: center;
}

.success .icon {
  color: #979853;
}

.error-state .icon {
  color: #e8735d;
}

.success, .error-state {
  text-align: center;
}

p {
  font-size: 14px;
  line-height: 1.6;
  opacity: 0.8;
  margin-bottom: 10px;
}

.reset-form {
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

.alert-error {
  background: rgba(232, 115, 93, 0.1);
  border: 1px solid rgba(232, 115, 93, 0.3);
  padding: 12px 15px;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.alert-icon {
  color: #e8735d;
}

.actions {
  display: flex;
  gap: 15px;
  justify-content: center;
  margin-top: 20px;
}

.btn-primary {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.05em;
  padding: 12px 24px;
  border: 1px solid rgba(139, 122, 166, 0.5);
  color: #8b7aa6;
  cursor: pointer;
  transition: all 0.3s;
  background: transparent;
}

.btn-primary:hover:not(:disabled) {
  background: rgba(139, 122, 166, 0.1);
  transform: translate(2px, -2px);
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>

