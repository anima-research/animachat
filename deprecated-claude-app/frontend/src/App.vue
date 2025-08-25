<template>
  <v-app>
    <router-view />
  </v-app>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useStore } from './store';

const store = useStore();

onMounted(async () => {
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
