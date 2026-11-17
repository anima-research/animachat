<template>
  <!-- Keys are handled on the root (focusable), so they still work after a click on a result. -->
  <div class="conversation-search" tabindex="-1" @keydown="onKeydown">
    <div class="conversation-search-input">
      <v-text-field
        ref="inputRef"
        :model-value="modelValue"
        @update:model-value="onInput"
        placeholder="Search all branches…"
        prepend-inner-icon="mdi-magnify"
        density="compact"
        variant="outlined"
        hide-details
        clearable
      />
      <div class="text-caption text-grey mt-1" aria-live="polite">{{ countLine }}</div>
    </div>

    <div ref="listRef" class="conversation-search-results" @scroll="onScroll">
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
          <v-icon size="x-small" class="mr-1" :aria-label="result.role">{{ roleIcon(result.role) }}</v-icon>
          <span>{{ result.date }}</span>
          <v-spacer />
          <v-chip
            size="x-small"
            :color="currentPathSet.has(result.branchId) ? 'primary' : undefined"
            variant="tonal"
          >
            {{ currentPathSet.has(result.branchId) ? 'current path' : 'other branch' }}
          </v-chip>
        </div>
        <!-- snippet is HTML-escaped in buildSnippet; only <mark> is ours -->
        <div class="conversation-search-snippet text-body-2" v-html="result.snippet" />
      </div>

      <v-btn
        v-if="results.length > shownResults.length"
        variant="text"
        size="small"
        block
        class="conversation-search-more text-caption"
        @click="limit += RESULT_CAP"
      >
        more… ({{ results.length - shownResults.length }} not shown)
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, toRef, watch } from 'vue';
import type { Message } from '@deprecated-claude/shared';
import { parseQuery, buildSnippet, searchConversation, type SearchHit, type SearchQuery } from '@/utils/conversationSearch';

const RESULT_CAP = 200;
const DEBOUNCE_MS = 150;

export interface SearchPanelState {
  activeIndex: number;
  limit: number;
  scrollTop: number;
  /** The displayed path when the query ran; fixes the order so a jump does not reshuffle the list. */
  orderPath: string[] | null;
}

const props = defineProps<{
  messages: Message[];
  /** Branch ids of the displayed path, in document order. */
  currentPath: string[];
  isMobile: boolean;
  modelValue: string;
  /** Owned by the parent so the panel reopens as it was left. */
  state: SearchPanelState;
  /** A reply is streaming; its text is searched when the stream ends. */
  streaming: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'jump', messageId: string, branchId: string): void;
  (e: 'close'): void;
}>();

const inputRef = ref<any>(null);
const listRef = ref<HTMLElement | null>(null);
// The parent owns the object, so these writes survive unmount.
const activeIndex = toRef(props.state, 'activeIndex');
const limit = toRef(props.state, 'limit');
// The query actually searched; trails modelValue by the debounce.
const query = ref<SearchQuery | null>(parseQuery(props.modelValue || ''));
if (query.value && !props.state.orderPath) props.state.orderPath = props.currentPath.slice();
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function onInput(value: string | null) {
  emit('update:modelValue', value ?? '');
}

watch(() => props.modelValue, (value) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    query.value = parseQuery(value || '');
    activeIndex.value = 0;
    limit.value = RESULT_CAP;
    props.state.orderPath = props.currentPath.slice();
    props.state.scrollTop = 0;
    if (listRef.value) listRef.value.scrollTop = 0;
  }, DEBOUNCE_MS);
});

onBeforeUnmount(() => clearTimeout(debounceTimer));

onMounted(async () => {
  await nextTick();
  if (listRef.value) listRef.value.scrollTop = props.state.scrollTop;
  // On phones a reopen with results should show them, not the keyboard.
  if (!props.isMobile || !props.modelValue) inputRef.value?.focus?.();
});

function onScroll(e: Event) {
  props.state.scrollTop = (e.target as HTMLElement).scrollTop;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// Reruns when a branch is added or removed and when a stream starts or ends,
// not on every streamed token: the text itself is read untracked.
const structureKey = computed(() => props.messages.reduce((n, m) => n + m.branches.length, 0));

const results = computed<SearchHit[]>(() => {
  const q = query.value;
  if (!q) return [];
  void structureKey.value;
  void props.streaming;
  return searchConversation(toRaw(props.messages), q, props.state.orderPath ?? []);
});

// Snippets only for what is shown.
const shownResults = computed(() => {
  const q = query.value;
  if (!q) return [];
  return results.value.slice(0, limit.value).map(hit => ({
    ...hit,
    date: hit.created ? dateFormat.format(hit.created) : '',
    snippet: buildSnippet(hit.text, q),
  }));
});

// The chip follows the live path; a string key keeps it from re-rendering
// the list when the path array is rebuilt with the same ids.
const currentPathKey = computed(() => props.currentPath.join('\n'));
const currentPathSet = computed(() => new Set(currentPathKey.value.split('\n')));

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

function jump(result: SearchHit) {
  activeIndex.value = shownResults.value.findIndex(r => r.branchId === result.branchId);
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
  // keyCode 229: Safari sends the IME-committing Enter after compositionend.
  if (e.isComposing || e.keyCode === 229) return;
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
    // A held Enter would jump again and again; Enter on "more…" is that button's.
    if (e.repeat || (e.target as HTMLElement).closest('button')) return;
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
  outline: none;
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
  opacity: 0.8;
}
</style>
