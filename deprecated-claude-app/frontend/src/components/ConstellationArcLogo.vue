<template>
  <svg 
    :width="size" 
    :height="size" 
    :viewBox="`0 0 120 120`" 
    xmlns="http://www.w3.org/2000/svg"
    :style="{ 
      display: 'inline-block', 
      verticalAlign: 'middle',
      transition: 'transform 0.3s ease'
    }"
    :class="{ 'constellation-logo-hover': interactive }"
  >
    <!-- Arc made of connected points -->
    <circle cx="20" cy="70" r="3" :fill="color"/>
    <circle cx="35" cy="50" r="3" :fill="color"/>
    <circle cx="50" cy="35" r="3" :fill="color"/>
    <circle cx="70" cy="30" r="3" :fill="color"/>
    <circle cx="85" cy="40" r="3" :fill="color"/>
    <circle cx="100" cy="60" r="3" :fill="color"/>
    <!-- Connecting lines -->
    <path d="M 20 70 L 35 50 L 50 35 L 70 30 L 85 40 L 100 60" :stroke="color" stroke-width="1" fill="none" opacity="0.4"/>
    <!-- Central star -->
    <circle cx="60" cy="60" r="5" :fill="accentColor"/>
    <circle cx="60" cy="60" r="8" fill="none" :stroke="accentColor" stroke-width="1" opacity="0.4"/>
  </svg>
</template>

<script setup lang="ts">
interface Props {
  size?: number | string;
  color?: string;
  accentColor?: string;
  interactive?: boolean;
}

withDefaults(defineProps<Props>(), {
  size: 60,
  color: '#BB86FC',
  accentColor: '#03DAC6',
  interactive: false
});
</script>

<style scoped>
.constellation-logo-hover:hover {
  transform: scale(1.05);
}
</style>
