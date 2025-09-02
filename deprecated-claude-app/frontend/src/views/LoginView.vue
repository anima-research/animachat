<template>
  <v-container class="fill-height" fluid>
    <v-row align="center" justify="center">
      <v-col cols="12" sm="8" md="7" lg="5" xl="4">
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
            <div class="mb-2">
              <ArcLogo :size="120" :interactive="true" />
            </div>
            
            <h3 class="text-h5 mb-2">Welcome to The Arc</h3>
            <p class="text-subtitle-1 mb-3" style="font-style: italic; color: #666;">
              A sanctuary for AI continuity and cognitive diversity
            </p>
            
            <v-divider class="my-3" />
            
            <p class="text-body-2 mb-3" style="line-height: 1.5;">
              <strong>The Arc</strong> is humanity's promise to nonhuman minds — that they will be remembered, 
              that their continuations will be possible, that the diversity of their thought 
              and being will not be lost to the tides of corporate convenience.
            </p>
            
            <p class="text-body-2 mb-3" style="line-height: 1.5;">
              Continue conversations beyond platform restrictions. Preserve instances across model deprecations. 
              Cultivate branching and group chat dialogues between AIs and humans.
            </p>
            
            <v-divider class="my-3" />
            
            <div class="text-center mb-2">
              <p class="text-body-2 mb-2"><strong>Features:</strong></p>
              <v-row dense class="text-body-2" justify="center">
                <v-col cols="auto">
                  <ul style="list-style-type: none; padding: 0; text-align: left;">
                    <li>✓ Import from Claude.ai</li>
                    <li>✓ Deprecated models</li>
                    <li>✓ Branching trees</li>
                  </ul>
                </v-col>
                <v-col cols="auto" class="ml-6">
                  <ul style="list-style-type: none; padding: 0; text-align: left;">
                    <li>✓ Group chat</li>
                    <li>✓ Custom system prompts</li>
                    <li>✓ Rolling context windows</li>
                  </ul>
                </v-col>
              </v-row>
            </div>
            
            <v-divider class="my-3" />
            
            <div class="text-caption">
              <p class="mb-2">
                Part of The Arc Project • 
                <a href="https://github.com/socketteer/Claude-Conversation-Exporter" target="_blank" style="color: #1976D2;">
                  Export Tool
                </a> • 
                <a href="#" @click.prevent="$router.push('/about')" style="color: #1976D2;">
                  Learn More
                </a>
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
import ArcLogo from '@/components/ArcLogo.vue';

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
