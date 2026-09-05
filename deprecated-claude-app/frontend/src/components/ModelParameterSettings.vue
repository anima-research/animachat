<template>
  <div v-if="model" class="model-parameter-settings">
    <!-- Temperature (only for models that accept sampling parameters) -->
    <template v-if="samplingSupported">
      <v-slider
        :model-value="temperature"
        @update:model-value="set('temperature', $event)"
        :min="model.settings.temperature.min"
        :max="model.settings.temperature.max"
        :step="model.settings.temperature.step"
        thumb-label
        color="primary"
      >
        <template v-slot:label>
          Temperature
          <HelpTip label="Temperature help" text="Controls randomness. Lower values make output more focused and deterministic." />
        </template>
        <template v-slot:append>
          <v-text-field
            :model-value="temperature"
            @update:model-value="set('temperature', clampNumber($event, model.settings.temperature.min, model.settings.temperature.max, temperature))"
            type="number"
            density="compact"
            style="width: 80px"
            variant="outlined"
            hide-details
            single-line
            :min="model.settings.temperature.min"
            :max="model.settings.temperature.max"
            :step="model.settings.temperature.step"
          />
        </template>
      </v-slider>
    </template>
    <p v-else class="text-caption text-grey mb-2">
      This model does not accept temperature or top-p / top-k sampling parameters.
    </p>

    <!-- Max tokens -->
    <v-slider
      :model-value="maxTokens"
      @update:model-value="set('maxTokens', Math.round($event))"
      :min="model.settings.maxTokens.min"
      :max="maxTokensLimit"
      :step="1"
      thumb-label
      color="primary"
      class="mt-2"
    >
      <template v-slot:label>
        Max Tokens
        <HelpTip label="Max tokens help" :text="`Maximum number of tokens to generate in one response. Defaults to the model's output limit (${maxTokensLimit.toLocaleString()}); the request is trimmed automatically if the conversation is close to the context window.`" />
      </template>
      <template v-slot:append>
        <v-text-field
          :model-value="maxTokens"
          @update:model-value="set('maxTokens', clampNumber($event, model.settings.maxTokens.min, maxTokensLimit, maxTokens))"
          type="number"
          density="compact"
          style="width: 110px"
          variant="outlined"
          hide-details
          single-line
          :min="model.settings.maxTokens.min"
          :max="maxTokensLimit"
        />
      </template>
    </v-slider>

    <!-- Top P / Top K (if the model defines ranges and accepts sampling) -->
    <div v-if="samplingSupported && model.settings.topP" class="mt-2">
      <v-checkbox
        :model-value="modelValue.topP !== undefined"
        @update:model-value="toggleOptional('topP', $event, model.settings.topP.default)"
        label="Enable Top P"
        density="compact"
        hide-details
      />
      <v-slider
        v-if="modelValue.topP !== undefined"
        :model-value="modelValue.topP"
        @update:model-value="set('topP', $event)"
        :min="model.settings.topP.min"
        :max="model.settings.topP.max"
        :step="model.settings.topP.step"
        thumb-label
        color="primary"
      >
        <template v-slot:label>
          Top P
          <HelpTip label="Top P help" text="Nucleus sampling. Considers the smallest set of tokens whose probabilities add up to top_p." />
        </template>
      </v-slider>
    </div>

    <div v-if="samplingSupported && model.settings.topK" class="mt-2">
      <v-checkbox
        :model-value="modelValue.topK !== undefined"
        @update:model-value="toggleOptional('topK', $event, model.settings.topK.default)"
        label="Enable Top K"
        density="compact"
        hide-details
      />
      <v-slider
        v-if="modelValue.topK !== undefined"
        :model-value="modelValue.topK"
        @update:model-value="set('topK', $event)"
        :min="model.settings.topK.min"
        :max="model.settings.topK.max"
        :step="model.settings.topK.step"
        thumb-label
        color="primary"
      >
        <template v-slot:label>
          Top K
          <HelpTip label="Top K help" text="Considers only the K most likely next tokens." />
        </template>
      </v-slider>
    </div>

    <!-- Extended thinking -->
    <div v-if="model.supportsThinking" class="mt-2">
      <div v-if="thinkingApi === 'always-on'" class="d-flex align-center text-body-2 py-2">
        <v-icon size="small" class="mr-2">mdi-thought-bubble</v-icon>
        Extended thinking is always on for this model.
        <HelpTip label="Extended thinking help" text="This model reasons before every answer and cannot be switched off. Use the reasoning effort below to control how deeply it thinks." />
      </div>
      <div v-else class="d-flex align-center">
        <v-checkbox
          :model-value="thinkingEnabled"
          @update:model-value="setThinkingEnabled(!!$event)"
          label="Enable extended thinking"
          density="compact"
          hide-details
        />
        <HelpTip
          label="Extended thinking help"
          :text="thinkingApi === 'budget'
            ? 'Lets the model reason step by step before answering, up to the token budget below.'
            : 'Lets the model reason step by step before answering. How much it reasons is set by the reasoning effort below.'"
        />
      </div>

      <v-slider
        v-if="thinkingApi === 'budget' && thinkingEnabled"
        :model-value="budgetTokens"
        @update:model-value="setBudget(Math.round($event))"
        :min="1024"
        :max="budgetMax"
        :step="1024"
        thumb-label
        color="primary"
        class="mt-2"
      >
        <template v-slot:label>
          Thinking budget (tokens)
          <HelpTip label="Thinking budget help" text="Maximum tokens the model may spend on internal reasoning. Minimum 1024, and it must stay below max tokens." />
        </template>
      </v-slider>
    </div>

    <!-- Reasoning effort (models that expose effort levels) -->
    <v-select
      v-if="effortItems.length > 0"
      :model-value="effort"
      @update:model-value="setEffort($event)"
      :items="effortItems"
      item-title="title"
      item-value="value"
      label="Reasoning effort"
      variant="outlined"
      density="compact"
      class="mt-4"
      :hint="effortHint"
      persistent-hint
    >
      <template v-slot:item="{ props: itemProps, item }">
        <v-list-item v-bind="itemProps">
          <template v-slot:subtitle>{{ item.raw.description }}</template>
        </v-list-item>
      </template>
    </v-select>

    <!-- Other model-specific settings declared in the model entry -->
    <ModelSpecificSettings
      v-if="configurableSettings.length > 0"
      :model-value="modelValue.modelSpecific || {}"
      @update:model-value="set('modelSpecific', $event)"
      :settings="configurableSettings"
      :show-divider="true"
      :show-header="true"
      header-text="Advanced Model Settings"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * Model parameter editor shared by the one-on-one conversation settings and
 * the per-participant settings in group chats. It renders only the controls a
 * model actually takes, based on the model entry:
 *
 * - temperature / top-p / top-k  → hidden when `supportsSampling` is false
 * - extended thinking toggle     → hidden for `thinkingApi: 'always-on'`
 * - thinking budget slider       → only for `thinkingApi: 'budget'`
 * - reasoning effort select      → only when the model lists `effortLevels`
 *
 * The value is a plain ModelSettings object; every change emits a new object
 * (never mutates the prop), which suits both v-model and the participant
 * clone-and-replace flow.
 */
import { computed } from 'vue';
import type { ConfigurableSetting, Model, ModelSettings } from '@deprecated-claude/shared';
import { getDefaultEffort, getDefaultMaxTokens, getReasoningEffort } from '@deprecated-claude/shared';
import HelpTip from './HelpTip.vue';
import ModelSpecificSettings from './ModelSpecificSettings.vue';

type Settings = Partial<ModelSettings> & { modelSpecific?: Record<string, unknown> };

const props = defineProps<{
  model: Model | null | undefined;
  modelValue: Settings;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: Settings];
}>();

const EFFORT_DESCRIPTIONS: Record<string, string> = {
  none: 'No internal reasoning',
  minimal: 'Almost no internal reasoning, fastest responses',
  low: 'Light reasoning, quick responses',
  medium: 'Balanced depth and speed',
  high: 'Thorough reasoning (provider default)',
  xhigh: 'Very thorough; best for hard problems',
  max: 'Maximum depth, highest cost',
};

const samplingSupported = computed(() => props.model?.supportsSampling !== false);
const thinkingApi = computed(() => props.model?.thinkingApi ?? 'budget');
const configurableSettings = computed<ConfigurableSetting[]>(
  () => (props.model?.configurableSettings as ConfigurableSetting[]) || []
);

const maxTokensLimit = computed(() => (props.model ? getDefaultMaxTokens(props.model) : 4096));
const temperature = computed(() => props.modelValue.temperature ?? props.model?.settings.temperature.default ?? 1);
const maxTokens = computed(() => props.modelValue.maxTokens ?? maxTokensLimit.value);

const thinkingEnabled = computed(() =>
  thinkingApi.value === 'always-on' ? true : !!props.modelValue.thinking?.enabled
);
const budgetTokens = computed(() => props.modelValue.thinking?.budgetTokens ?? 8000);
const budgetMax = computed(() => Math.max(1024, Math.min(64000, maxTokens.value - 1024)));

const effortItems = computed(() =>
  (props.model?.effortLevels || []).map((level) => ({
    value: level,
    title: level.charAt(0).toUpperCase() + level.slice(1),
    description: EFFORT_DESCRIPTIONS[level] || '',
  }))
);
const effort = computed(() => {
  if (!props.model) return undefined;
  const current = getReasoningEffort(props.modelValue as ModelSettings);
  if (current && props.model.effortLevels?.includes(current)) return current;
  return getDefaultEffort(props.model);
});
const effortHint = computed(() => {
  if (!thinkingEnabled.value) return 'Applies when extended thinking is enabled.';
  return thinkingApi.value === 'budget'
    ? 'How much the model reasons; the budget above still caps it.'
    : 'How deeply the model reasons before answering.';
});

function set<K extends keyof Settings>(key: K, value: Settings[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}

function toggleOptional(key: 'topP' | 'topK', enabled: boolean | null, defaultValue: number) {
  const next: Settings = { ...props.modelValue };
  if (enabled) {
    next[key] = defaultValue;
  } else {
    delete next[key];
  }
  emit('update:modelValue', next);
}

function setThinkingEnabled(enabled: boolean) {
  const next: Settings = { ...props.modelValue };
  if (enabled) {
    next.thinking = { enabled: true, budgetTokens: budgetTokens.value };
  } else {
    delete next.thinking;
  }
  emit('update:modelValue', next);
}

function setBudget(value: number) {
  emit('update:modelValue', {
    ...props.modelValue,
    thinking: { enabled: true, budgetTokens: Math.max(1024, value) },
  });
}

function setEffort(value: string) {
  // `reasoningEffort` is the unified key; drop the legacy Anthropic-only
  // `thinkingEffort` so a stored conversation carries one value.
  const { thinkingEffort: _legacy, ...rest } = props.modelValue.modelSpecific || {};
  emit('update:modelValue', {
    ...props.modelValue,
    modelSpecific: { ...rest, reasoningEffort: value },
  });
}

function clampNumber(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
</script>
