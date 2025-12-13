<template>
  <div class="model-pill-bar" :class="{ 'is-mobile': isMobile }">
    <!-- Add new model button -->
    <div 
      class="pill add-pill"
      @click="$emit('add-model')"
      :title="isStandardConversation ? 'Add model and convert to group chat' : 'Add model to conversation'"
    >
      <v-icon size="small">mdi-plus</v-icon>
    </div>

    <!-- Single model pill for standard conversations -->
    <div
      v-if="isStandardConversation && singleModel"
      class="pill selected"
      :style="getSingleModelStyle()"
      @click="$emit('open-settings')"
    >
      <v-icon size="x-small" class="pill-icon">{{ getModelIcon(singleModel) }}</v-icon>
      <span class="pill-name">{{ singleModel.shortName || singleModel.displayName }}</span>
      <span class="pill-settings" @click.stop="$emit('open-settings')" title="Model settings">
        <v-icon size="x-small">mdi-cog</v-icon>
      </span>
    </div>

    <!-- Participant pills (for group chat) -->
    <template v-if="!isStandardConversation">
      <div
        v-for="participant in participants"
        :key="participant.id"
        class="pill"
        :class="{ 
          'selected': participant.id === selectedResponderId,
          'disabled': disabled
        }"
        :style="getPillStyle(participant)"
        @click="selectResponder(participant)"
      >
        <v-icon size="x-small" class="pill-icon">{{ getParticipantIcon(participant) }}</v-icon>
        <span class="pill-name">{{ getDisplayName(participant) }}</span>
        <span 
          class="pill-send"
          :class="{ 'selected': participant.id === selectedResponderId }"
          @click.stop="quickSend(participant)"
          title="Quick send with this model"
        >
          <v-icon size="x-small">mdi-send</v-icon>
        </span>
      </div>
    </template>

    <!-- Divider -->
    <div v-if="(participants.length > 0 || isStandardConversation) && suggestedModels.length > 0" class="pill-divider" />

    <!-- Suggested model pills (not yet in conversation) -->
    <div
      v-for="model in suggestedModels"
      :key="model.id"
      class="pill suggested"
      :class="{ 'disabled': disabled }"
      @click="isStandardConversation ? $emit('add-model', model) : $emit('add-suggested-model', model)"
      :title="isStandardConversation ? 'Add model and convert to group chat' : 'Add to conversation'"
    >
      <v-icon size="x-small" class="pill-icon">{{ getProviderIcon(model.provider) }}</v-icon>
      <span class="pill-name">{{ model.shortName || model.displayName }}</span>
      <span class="pill-send" @click.stop="isStandardConversation ? $emit('add-model', model) : $emit('quick-send-model', model)">
        <v-icon size="x-small">mdi-send</v-icon>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Participant } from '@deprecated-claude/shared';
import { getModelColor } from '@/utils/modelColors';

interface Model {
  id: string;
  displayName: string;
  shortName?: string;
  provider: string;
}

const props = defineProps<{
  participants: Participant[];
  suggestedModels: Model[];
  selectedResponderId: string;
  disabled?: boolean;
  // For one-on-one conversations
  singleModel?: Model | null;
  isStandardConversation?: boolean;
}>();

const emit = defineEmits<{
  'select-responder': [participant: Participant];
  'quick-send': [participant: Participant];
  'add-model': [model?: Model];
  'add-suggested-model': [model: Model];
  'quick-send-model': [model: Model];
  'open-settings': [];
}>();

const isMobile = computed(() => {
  return window.innerWidth < 768;
});

function selectResponder(participant: Participant) {
  if (!props.disabled) {
    emit('select-responder', participant);
  }
}

function quickSend(participant: Participant) {
  if (!props.disabled) {
    emit('quick-send', participant);
  }
}

function getDisplayName(participant: Participant): string {
  if (participant.name === '') {
    return participant.model || 'Continue';
  }
  return participant.name;
}

function getPillStyle(participant: Participant) {
  const color = getModelColor(participant.model || '');
  const isSelected = participant.id === props.selectedResponderId;
  
  return {
    '--pill-color': color,
    '--pill-bg': isSelected ? color : 'transparent',
    '--pill-text': isSelected ? '#fff' : color,
    borderColor: color
  };
}

function getSingleModelStyle() {
  const color = getModelColor(props.singleModel?.id || '');
  return {
    '--pill-color': color,
    '--pill-bg': color,
    '--pill-text': '#fff',
    borderColor: color
  };
}

function getModelIcon(model: Model): string {
  const id = model.id?.toLowerCase() || '';
  if (id.includes('opus')) return 'mdi-star-four-points';
  if (id.includes('sonnet')) return 'mdi-star-outline';
  if (id.includes('haiku')) return 'mdi-feather';
  if (id.includes('claude')) return 'mdi-robot';
  if (id.includes('gpt')) return 'mdi-creation';
  if (id.includes('gemini')) return 'mdi-diamond-stone';
  if (id.includes('llama')) return 'mdi-llama';
  return 'mdi-robot';
}

function getParticipantIcon(participant: Participant): string {
  if (participant.type === 'user') return 'mdi-account';
  
  const provider = participant.model?.toLowerCase() || '';
  if (provider.includes('opus')) return 'mdi-star-four-points';
  if (provider.includes('sonnet')) return 'mdi-star-outline';
  if (provider.includes('claude')) return 'mdi-robot';
  if (provider.includes('gpt')) return 'mdi-creation';
  if (provider.includes('gemini')) return 'mdi-diamond-stone';
  if (provider.includes('llama')) return 'mdi-llama';
  return 'mdi-robot';
}

function getProviderIcon(provider: string): string {
  switch (provider?.toLowerCase()) {
    case 'anthropic': return 'mdi-robot';
    case 'openai': return 'mdi-creation';
    case 'google': return 'mdi-diamond-stone';
    case 'openrouter': return 'mdi-router-wireless';
    default: return 'mdi-chip';
  }
}
</script>

<style scoped>
.model-pill-bar {
  display: flex;
  flex-wrap: wrap-reverse;
  align-items: center;
  gap: 6px;
  padding: 8px 4px;
  align-content: flex-end;
}

/* Mobile: single row, horizontal scroll */
.model-pill-bar.is-mobile {
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.model-pill-bar.is-mobile::-webkit-scrollbar {
  display: none;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px 4px 8px;
  border-radius: 16px;
  border: 1.5px solid var(--pill-color, rgba(255,255,255,0.3));
  background: var(--pill-bg, transparent);
  color: var(--pill-text, inherit);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  font-family: inherit;
}

.pill:hover:not(.disabled) {
  filter: brightness(1.1);
}

.pill.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pill.selected {
  font-weight: 500;
}

.pill.suggested {
  border-color: rgba(255,255,255,0.2);
  color: rgba(255,255,255,0.6);
}

.pill.suggested:hover:not(.disabled) {
  border-color: rgba(255,255,255,0.4);
  color: rgba(255,255,255,0.8);
}

.add-pill {
  padding: 4px 8px;
  border-style: dashed;
  border-color: rgba(255,255,255,0.3);
  color: rgba(255,255,255,0.5);
}

.add-pill:hover {
  border-color: rgba(255,255,255,0.5);
  color: rgba(255,255,255,0.8);
}

.pill-icon {
  opacity: 0.8;
}

.pill-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pill-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(255,255,255,0.1);
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  color: inherit;
}

.pill-send:hover:not(:disabled) {
  background: rgba(255,255,255,0.25);
  transform: scale(1.1);
}

.pill-send.selected {
  background: rgba(0,0,0,0.2);
}

.pill-settings {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(0,0,0,0.2);
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  color: inherit;
}

.pill-settings:hover {
  background: rgba(0,0,0,0.35);
  transform: scale(1.1);
}

.pill-divider {
  width: 1px;
  height: 20px;
  background: rgba(255,255,255,0.2);
  margin: 0 4px;
}
</style>

