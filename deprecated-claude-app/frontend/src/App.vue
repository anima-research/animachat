<template>
  <v-app>
    <router-view />
  </v-app>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useStore } from './store';
import { useSiteConfig } from './composables/useSiteConfig';

const store = useStore();
const { ensureLoaded: loadSiteConfig } = useSiteConfig();

onMounted(async () => {
  // Load site configuration (deployment-specific content)
  // This runs in parallel with user loading and doesn't block rendering
  loadSiteConfig();
  
  // Check if user is authenticated and load user data
  const token = localStorage.getItem('token');
  if (token) {
    try {
      await store.loadUser();
    } catch (error) {
      console.error('Failed to load user:', error);
      localStorage.removeItem('token');
    }
  }
});
</script>

<style>
html {
  overflow-y: auto !important;
}
</style>
