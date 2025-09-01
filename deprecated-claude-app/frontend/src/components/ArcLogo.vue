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
    :class="{ 'arc-logo-hover': interactive }"
  >
    <!-- Multiple nested arcs -->
    <path d="M 20 80 Q 60 20, 100 80" :stroke="color" stroke-width="2" fill="none" opacity="0.3"/>
    <path d="M 30 75 Q 60 30, 90 75" :stroke="color" stroke-width="2" fill="none" opacity="0.5"/>
    <path d="M 40 70 Q 60 40, 80 70" :stroke="color" stroke-width="3" fill="none" opacity="0.7"/>
    <path d="M 50 65 Q 60 50, 70 65" :stroke="color" stroke-width="4" fill="none"/>
  </svg>
</template>

<script setup lang="ts">
interface Props {
  size?: number | string;
  color?: string;
  interactive?: boolean;
}

withDefaults(defineProps<Props>(), {
  size: 60,
  color: '#BB86FC',
  interactive: false
});
</script>

<style scoped>
.arc-logo-hover:hover {
  transform: scale(1.05);
}
</style>
