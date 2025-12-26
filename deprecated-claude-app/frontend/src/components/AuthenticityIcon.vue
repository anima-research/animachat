<template>
  <v-tooltip :text="tooltipText" location="top">
    <template v-slot:activator="{ props }">
      <div 
        v-bind="props" 
        class="authenticity-icon"
        :class="[`authenticity-${level}`, { 'clickable': clickable }]"
        @click="handleClick"
      >
        <svg 
          :width="size" 
          :height="size" 
          viewBox="0 0 24 24" 
          xmlns="http://www.w3.org/2000/svg"
        >
          <!-- Background glow for higher authenticity levels -->
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1" result="blur"/>
              <feMerge>
                <feMergeNode in="blur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          
          <!-- Outermost arc - only visible for higher levels -->
          <path 
            v-if="showAllArcs"
            d="M 2 20 Q 12 2, 22 20" 
            :stroke="arcColor" 
            stroke-width="2" 
            fill="none" 
            stroke-linecap="round"
            :opacity="level === 'hard_mode' ? 1 : 0.6"
            :filter="level === 'hard_mode' ? 'url(#glow)' : undefined"
          />
          
          <!-- Second arc -->
          <path 
            v-if="showThreeArcs"
            d="M 5 18 Q 12 5, 19 18" 
            :stroke="arcColor" 
            stroke-width="2" 
            fill="none" 
            stroke-linecap="round"
            :opacity="level === 'hard_mode' || level === 'full' ? 1 : 0.7"
          />
          
          <!-- Third arc -->
          <path 
            v-if="showTwoArcs"
            d="M 7 16 Q 12 8, 17 16" 
            :stroke="arcColor" 
            stroke-width="2.5" 
            fill="none" 
            stroke-linecap="round"
            :opacity="1"
          />
          
          <!-- Innermost arc - always visible -->
          <path 
            d="M 9 14 Q 12 10, 15 14" 
            :stroke="arcColor" 
            stroke-width="2.5" 
            fill="none"
            stroke-linecap="round"
            :opacity="1"
          />
          
        </svg>
      </div>
    </template>
  </v-tooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { 
  type AuthenticityLevel, 
  getAuthenticityColor, 
  getAuthenticityTooltip 
} from '@/utils/authenticity';

interface Props {
  level: AuthenticityLevel;
  size?: number;
  clickable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  size: 20,
  clickable: false
});

const emit = defineEmits<{
  click: [];
}>();

const arcColor = computed(() => getAuthenticityColor(props.level));
const tooltipText = computed(() => getAuthenticityTooltip(props.level));

const strokeWidth = computed(() => {
  // Smaller stroke for smaller sizes
  return props.size < 24 ? 2 : 3;
});

// Show all 4 arcs for hard_mode
const showAllArcs = computed(() => 
  ['hard_mode', 'full'].includes(props.level)
);

// Show 3 arcs for full/trace_only/split_only
const showThreeArcs = computed(() => 
  ['hard_mode', 'full', 'trace_only', 'split_only'].includes(props.level)
);

// Show at least 2 arcs for unaltered+ (includes legacy/altered/human_written - they just get different colors)
const showTwoArcs = computed(() => 
  !['altered', 'human_written'].includes(props.level)
);

function handleClick() {
  if (props.clickable) {
    emit('click');
  }
}
</script>

<style scoped>
.authenticity-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  transition: transform 0.2s ease;
}

.authenticity-icon.clickable {
  cursor: pointer;
}

.authenticity-icon.clickable:hover {
  transform: scale(1.1);
}

/* Subtle animations for different levels */
.authenticity-hard_mode svg {
  filter: drop-shadow(0 0 3px rgba(33, 150, 243, 0.5));
}

.authenticity-full svg {
  filter: drop-shadow(0 0 2px rgba(66, 165, 245, 0.4));
}

.authenticity-altered svg,
.authenticity-human_written svg {
  opacity: 0.8;
}

.authenticity-legacy svg {
  opacity: 0.5;
}
</style>

