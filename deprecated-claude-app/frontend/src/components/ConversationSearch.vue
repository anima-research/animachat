<template>
  <div class="conversation-search">
    <div class="conversation-search-input">
      <v-text-field
        ref="inputRef"
        :model-value="modelValue"
        @update:model-value="onInput"
        @keydown="onKeydown"
        placeholder="Search all branches…"
        prepend-inner-icon="mdi-magnify"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        autofocus
        @click:clear="onInput('')"
      />
      <div class="text-caption text-grey mt-1">{{ countLine }}</div>
    </div>

    <div ref="listRef" class="conversation-search-results">
      <div
        v-for="(result, i) in shownResults"
        :key="result.branchId"
        class="conversation-search-result"
        :class="{ 'conversation-search-result--active': i === activeIndex }"
        :data-index="i"
        @click="jump(result)"
        @mousemove="activeIndex = i"
      >
        <div class="d-flex align-center text-caption text-grey">
          <v-icon size="x-small" class="mr-1">{{ roleIcon(result.role) }}</v-icon>
          <span>{{ result.date }}</span>
          <v-spacer />
          <v-chip
            size="x-small"
            :color="result.onCurrentPath ? 'primary' : undefined"
            variant="tonal"
          >
            {{ result.onCurrentPath ? 'current path' : 'other branch' }}
          </v-chip>
        </div>
        <!-- snippet is HTML-escaped in buildSnippet; only <mark> is ours -->
        <div class="conversation-search-snippet text-body-2" v-html="result.snippet" />
      </div>

      <div
        v-if="results.length > shownResults.length"
        class="conversation-search-more text-caption"
        @click="limit += RESULT_CAP"
      >
        more… ({{ results.length - shownResults.length }} not shown)
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Message } from '@deprecated-claude/shared';
import { parseQuery, matchIndex, buildSnippet, branchSearchText, type SearchQuery } from '@/utils/conversationSearch';

const RESULT_CAP = 200;
const DEBOUNCE_MS = 150;

const props = defineProps<{
  messages: Message[];
  /** Branch ids of the displayed path, in document order. */
  currentPath: string[];
  isMobile: boolean;
  modelValue: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'jump', messageId: string, branchId: string): void;
  (e: 'close'): void;
}>();

interface SearchResult {
  messageId: string;
  branchId: string;
  role: string;
  date: string;
  snippet: string;
  onCurrentPath: boolean;
  sortKey: number;
}

const inputRef = ref<any>(null);
const listRef = ref<HTMLElement | null>(null);
const activeIndex = ref(0);
const limit = ref(RESULT_CAP);
// The query actually searched; trails modelValue by the debounce.
const query = ref<SearchQuery | null>(parseQuery(props.modelValue || ''));
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function onInput(value: string | null) {
  emit('update:modelValue', value ?? '');
}

watch(() => props.modelValue, (value) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    query.value = parseQuery(value || '');
    lastJumpedBranchId = null;
    activeIndex.value = 0;
    limit.value = RESULT_CAP;
  }, DEBOUNCE_MS);
});

onBeforeUnmount(() => clearTimeout(debounceTimer));

onMounted(async () => {
  await nextTick();
  inputRef.value?.focus?.();
});

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const results = computed<SearchResult[]>(() => {
  const q = query.value;
  if (!q) return [];
  const pathIndex = new Map(props.currentPath.map((id, i) => [id, i]));
  const onPath: SearchResult[] = [];
  const others: SearchResult[] = [];

  for (const message of props.messages) {
    for (const branch of message.branches) {
      const text = branchSearchText(branch);
      if (matchIndex(text, q) === -1) continue;
      const created = branch.createdAt ? new Date(branch.createdAt) : null;
      const time = created && !isNaN(created.getTime()) ? created.getTime() : 0;
      const position = pathIndex.get(branch.id);
      const result: SearchResult = {
        messageId: message.id,
        branchId: branch.id,
        role: branch.role,
        date: time ? dateFormat.format(created!) : '',
        snippet: buildSnippet(text, q),
        onCurrentPath: position !== undefined,
        sortKey: position ?? time,
      };
      (position !== undefined ? onPath : others).push(result);
    }
  }
  onPath.sort((a, b) => a.sortKey - b.sortKey);
  others.sort((a, b) => a.sortKey - b.sortKey);
  return [...onPath, ...others];
});

const shownResults = computed(() => results.value.slice(0, limit.value));

const countLine = computed(() => {
  if (!query.value) return 'Type at least 2 characters. "Quotes" for an exact phrase.';
  const n = results.value.length;
  return n === 0 ? 'No matches' : `${n} match${n === 1 ? '' : 'es'}`;
});

function roleIcon(role: string) {
  if (role === 'user') return 'mdi-account';
  if (role === 'system') return 'mdi-cog-outline';
  return 'mdi-robot';
}

// A jump changes the displayed path, which re-sorts the results; keep the
// selection on the result that was jumped to.
let lastJumpedBranchId: string | null = null;
watch(results, (list) => {
  if (!lastJumpedBranchId) return;
  const i = list.findIndex(r => r.branchId === lastJumpedBranchId);
  if (i !== -1 && i < limit.value) {
    activeIndex.value = i;
    scrollActiveIntoView();
  }
});

function jump(result: SearchResult) {
  lastJumpedBranchId = result.branchId;
  activeIndex.value = shownResults.value.indexOf(result);
  emit('jump', result.messageId, result.branchId);
}

function scrollActiveIntoView() {
  nextTick(() => {
    listRef.value
      ?.querySelector(`[data-index="${activeIndex.value}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  });
}

function onKeydown(e: KeyboardEvent) {
  const count = shownResults.value.length;
  if (e.key === 'ArrowDown' && count > 0) {
    e.preventDefault();
    activeIndex.value = Math.min(count - 1, activeIndex.value + 1);
    scrollActiveIntoView();
  } else if (e.key === 'ArrowUp' && count > 0) {
    e.preventDefault();
    activeIndex.value = Math.max(0, activeIndex.value - 1);
    scrollActiveIntoView();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const result = shownResults.value[activeIndex.value];
    if (result) jump(result);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    if (props.modelValue) onInput('');
    else emit('close');
  }
}
</script>

<style scoped>
.conversation-search {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.conversation-search-input {
  flex: 0 0 auto;
  padding: 12px 12px 8px;
}
.conversation-search-results {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 4px 12px;
}
.conversation-search-result {
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
}
.conversation-search-result--active {
  background: rgba(var(--v-theme-primary), 0.12);
}
.conversation-search-snippet {
  margin-top: 2px;
  word-break: break-word;
  opacity: 0.9;
}
.conversation-search-snippet :deep(mark) {
  background: rgba(var(--v-theme-warning), 0.35);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}
.conversation-search-more {
  padding: 8px;
  text-align: center;
  cursor: pointer;
  opacity: 0.8;
}
</style>
