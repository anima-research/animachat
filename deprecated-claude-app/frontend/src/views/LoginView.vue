<template>
  <v-container class="fill-height" fluid>
    <v-row align="center" justify="center">
      <v-col cols="12" sm="8" md="6" lg="4">
        <v-card class="elevation-12">
          <v-toolbar dark color="primary">
            <v-toolbar-title>
              {{ isRegistering ? 'Create Account' : 'Sign In' }}
            </v-toolbar-title>
          </v-toolbar>
          
          <v-card-text>
            <v-form ref="form" v-model="valid" lazy-validation>
              <v-text-field
                v-model="name"
                v-if="isRegistering"
                :rules="nameRules"
                label="Name"
                prepend-icon="mdi-account"
                type="text"
                required
              />
              
              <v-text-field
                v-model="email"
                :rules="emailRules"
                label="Email"
                prepend-icon="mdi-email"
                type="email"
                required
              />
              
              <v-text-field
                v-model="password"
                :rules="passwordRules"
                label="Password"
                prepend-icon="mdi-lock"
                :type="showPassword ? 'text' : 'password'"
                :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
                @click:append="showPassword = !showPassword"
                required
              />
              
              <v-text-field
                v-if="isRegistering"
                v-model="confirmPassword"
                :rules="confirmPasswordRules"
                label="Confirm Password"
                prepend-icon="mdi-lock-check"
                :type="showPassword ? 'text' : 'password'"
                required
              />
            </v-form>
            
            <v-alert
              v-if="error"
              type="error"
              class="mt-4"
              dismissible
              @click:close="error = ''"
            >
              {{ error }}
            </v-alert>
          </v-card-text>
          
          <v-card-actions>
            <v-btn
              variant="text"
              @click="isRegistering = !isRegistering"
            >
              {{ isRegistering ? 'Already have an account?' : 'Need an account?' }}
            </v-btn>
            <v-spacer />
            <v-btn
              color="primary"
              variant="elevated"
              :loading="loading"
              :disabled="!valid"
              @click="submit"
            >
              {{ isRegistering ? 'Register' : 'Login' }}
            </v-btn>
          </v-card-actions>
        </v-card>
        
        <v-card class="mt-4" variant="outlined">
          <v-card-text class="text-center">
            <h3 class="text-h6 mb-2">Welcome to Deprecated Claude Models</h3>
            <p class="text-body-2 mb-3">
              Continue your conversations with deprecated Claude models through AWS Bedrock.
              Import your conversations from claude.ai and pick up where you left off.
            </p>
            
            <v-divider class="my-3" />
            
            <div class="text-left">
              <h4 class="text-subtitle-1 mb-2">🧪 Test Account</h4>
              <p class="text-body-2 mb-1">
                <strong>Email:</strong> test@example.com
              </p>
              <p class="text-body-2">
                <strong>Password:</strong> password123
              </p>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useStore } from '@/store';

const router = useRouter();
const store = useStore();

const form = ref();
const valid = ref(true);
const isRegistering = ref(false);
const loading = ref(false);
const error = ref('');
const showPassword = ref(false);

const name = ref('');
const email = ref('');
const password = ref('');
const confirmPassword = ref('');

// Validation rules
const nameRules = [
  (v: string) => !!v || 'Name is required',
  (v: string) => v.length >= 2 || 'Name must be at least 2 characters',
];

const emailRules = [
  (v: string) => !!v || 'Email is required',
  (v: string) => /.+@.+\..+/.test(v) || 'Email must be valid',
];

const passwordRules = [
  (v: string) => !!v || 'Password is required',
  (v: string) => v.length >= 8 || 'Password must be at least 8 characters',
];

const confirmPasswordRules = [
  (v: string) => !!v || 'Please confirm your password',
  (v: string) => v === password.value || 'Passwords must match',
];

async function submit() {
  const validation = await form.value.validate();
  if (!validation.valid) return;
  
  loading.value = true;
  error.value = '';
  
  try {
    if (isRegistering.value) {
      await store.register(email.value, password.value, name.value);
    } else {
      await store.login(email.value, password.value);
    }
    
    router.push('/conversation');
  } catch (err: any) {
    error.value = err.response?.data?.error || 'An error occurred';
  } finally {
    loading.value = false;
  }
}
</script>
