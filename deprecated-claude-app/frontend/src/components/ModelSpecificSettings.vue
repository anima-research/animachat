<template>
  <div v-if="visibleSettings.length > 0" class="model-specific-settings">
    <v-divider v-if="showDivider" class="my-4" />
    <h4 v-if="showHeader" class="text-subtitle-1 mb-3">{{ headerText }}</h4>
    
    <div v-for="setting in visibleSettings" :key="setting.key" class="setting-item mb-4">
      <!-- Select dropdown -->
      <v-select
        v-if="setting.type === 'select'"
        :model-value="getValue(setting.key, setting.default)"
        @update:model-value="setValue(setting.key, $event)"
        :items="setting.options"
        :item-title="'label'"
        :item-value="'value'"
        :label="setting.label"
        :hint="setting.description"
        :persistent-hint="!!setting.description"
        variant="outlined"
        density="compact"
      />
      
      <!-- Boolean toggle -->
      <v-switch
        v-else-if="setting.type === 'boolean'"
        :model-value="getValue(setting.key, setting.default)"
        @update:model-value="setValue(setting.key, $event)"
        :label="setting.label"
        :hint="setting.description"
        :persistent-hint="!!setting.description"
        color="primary"
        density="compact"
        hide-details="auto"
      />
      
      <!-- Number slider -->
      <div v-else-if="setting.type === 'number'" class="number-setting">
        <v-slider
          :model-value="getValue(setting.key, setting.default)"
          @update:model-value="setValue(setting.key, $event)"
          :min="setting.min"
          :max="setting.max"
          :step="setting.step || 1"
          :label="setting.label"
          thumb-label
          color="primary"
          hide-details="auto"
        >
          <template v-slot:append>
            <v-text-field
              :model-value="getValue(setting.key, setting.default)"
              @update:model-value="setValue(setting.key, Number($event))"
              type="number"
              density="compact"
              style="width: 80px"
              variant="outlined"
              hide-details
              single-line
              :min="setting.min"
              :max="setting.max"
              :step="setting.step || 1"
            />
          </template>
        </v-slider>
        <p v-if="setting.description" class="text-caption text-grey mt-1">{{ setting.description }}</p>
      </div>
      
      <!-- Multi-select -->
      <v-select
        v-else-if="setting.type === 'multiselect'"
        :model-value="getValue(setting.key, setting.default)"
        @update:model-value="setValue(setting.key, $event)"
        :items="setting.options"
        :item-title="'label'"
        :item-value="'value'"
        :label="setting.label"
        :hint="setting.description"
        :persistent-hint="!!setting.description"
        variant="outlined"
        density="compact"
        multiple
        chips
        closable-chips
      >
        <template v-slot:chip="{ item, index }">
          <v-chip
            :color="item.value === 'IMAGE' ? 'purple' : 'blue'"
            size="small"
            variant="tonal"
          >
            <v-icon v-if="item.value === 'IMAGE'" size="small" class="mr-1">mdi-image</v-icon>
            <v-icon v-else-if="item.value === 'TEXT'" size="small" class="mr-1">mdi-text</v-icon>
            {{ item.title }}
          </v-chip>
        </template>
      </v-select>
      
      <!-- Text input -->
      <v-text-field
        v-else-if="setting.type === 'text'"
        :model-value="getValue(setting.key, setting.default)"
        @update:model-value="setValue(setting.key, $event)"
        :label="setting.label"
        :hint="setting.description"
        :persistent-hint="!!setting.description"
        :placeholder="setting.placeholder"
        :maxlength="setting.maxLength"
        variant="outlined"
        density="compact"
      />
    </div>
    
    <!-- Image generation info alert -->
    <v-alert
      v-if="hasImageOutput"
      type="info"
      density="compact"
      variant="tonal"
      class="mt-2"
    >
      <div class="text-caption">
        <strong>Image Generation Enabled</strong><br>
        The model will output images along with text. Generated images will appear inline in the conversation.
      </div>
    </v-alert>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ConfigurableSetting } from '@deprecated-claude/shared';

interface Props {
  settings: ConfigurableSetting[];
  modelValue: Record<string, unknown>;
  showDivider?: boolean;
  showHeader?: boolean;
  headerText?: string;
}

const props = withDefaults(defineProps<Props>(), {
  settings: () => [],
  modelValue: () => ({}),
  showDivider: true,
  showHeader: true,
  headerText: 'Model-Specific Settings',
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, unknown>): void;
}>();

// Get value from modelValue or use default
function getValue(key: string, defaultValue: unknown): unknown {
  return props.modelValue[key] !== undefined ? props.modelValue[key] : defaultValue;
}

// Set value and emit update
function setValue(key: string, value: unknown) {
  emit('update:modelValue', {
    ...props.modelValue,
    [key]: value,
  });
}

// Evaluate condition to determine if a setting should be visible
function evaluateCondition(condition: string | undefined): boolean {
  if (!condition) return true;
  
  // Simple condition parser: "key includes value" or "key equals value"
  const includesMatch = condition.match(/^(\S+)\s+includes\s+(\S+)$/);
  if (includesMatch) {
    const [, key, value] = includesMatch;
    const currentValue = getValue(key, []);
    if (Array.isArray(currentValue)) {
      return currentValue.includes(value);
    }
    return false;
  }
  
  const equalsMatch = condition.match(/^(\S+)\s+equals\s+(.+)$/);
  if (equalsMatch) {
    const [, key, value] = equalsMatch;
    const currentValue = getValue(key, undefined);
    return currentValue === value;
  }
  
  return true;
}

// Filter settings based on conditions
const visibleSettings = computed(() => {
  return props.settings.filter(setting => {
    const condition = (setting as any).condition;
    return evaluateCondition(condition);
  });
});

// Check if image output is enabled
const hasImageOutput = computed(() => {
  const responseModalities = getValue('responseModalities', []) as string[];
  return Array.isArray(responseModalities) && responseModalities.includes('IMAGE');
});
</script>

<style scoped>
.model-specific-settings {
  /* Container styles */
}

.setting-item {
  /* Individual setting container */
}

.number-setting {
  /* Number slider with text field combo */
}
</style>

