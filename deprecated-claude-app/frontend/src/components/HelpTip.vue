<template>
  <v-tooltip location="top" open-on-click open-on-focus :max-width="maxWidth">
    <template v-slot:activator="{ props: activatorProps }">
      <v-icon
        v-bind="activatorProps"
        size="small"
        class="ml-1 help-tip-icon"
        role="button"
        tabindex="0"
        :aria-label="label || 'Help'"
      >
        mdi-help-circle-outline
      </v-icon>
    </template>
    <slot>{{ text }}</slot>
  </v-tooltip>
</template>

<script setup lang="ts">
// Small "?" icon with a tooltip that also opens on tap (touch screens have no hover).
withDefaults(defineProps<{
  text?: string;
  label?: string;
  maxWidth?: number | string;
}>(), {
  text: '',
  label: '',
  maxWidth: 320,
});
</script>

<style scoped>
.help-tip-icon {
  cursor: pointer;
  opacity: 0.7;
}
.help-tip-icon:focus-visible {
  outline: 2px solid rgba(var(--v-theme-primary), 0.9);
  border-radius: 50%;
}
</style>
