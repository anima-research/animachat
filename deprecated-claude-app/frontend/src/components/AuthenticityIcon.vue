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
          viewBox="0 0 120 120" 
          xmlns="http://www.w3.org/2000/svg"
        >
          <!-- Background glow for higher authenticity levels -->
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur"/>
              <feMerge>
                <feMergeNode in="blur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          
          <!-- Outermost arc - only visible for higher levels -->
          <path 
            v-if="showAllArcs"
            d="M 20 80 Q 60 20, 100 80" 
            :stroke="arcColor" 
            :stroke-width="strokeWidth" 
            fill="none" 
            :opacity="level === 'hard_mode' ? 0.8 : 0.3"
            :filter="level === 'hard_mode' ? 'url(#glow)' : undefined"
          />
          
          <!-- Second arc -->
          <path 
            v-if="showThreeArcs"
            d="M 30 75 Q 60 30, 90 75" 
            :stroke="arcColor" 
            :stroke-width="strokeWidth" 
            fill="none" 
            :opacity="level === 'hard_mode' || level === 'full' ? 0.7 : 0.4"
          />
          
          <!-- Third arc -->
          <path 
            v-if="showTwoArcs"
            d="M 40 70 Q 60 40, 80 70" 
            :stroke="arcColor" 
            :stroke-width="strokeWidth * 1.2" 
            fill="none" 
            :opacity="0.8"
          />
          
          <!-- Innermost arc - always visible -->
          <path 
            d="M 50 65 Q 60 50, 70 65" 
            :stroke="arcColor" 
            :stroke-width="strokeWidth * 1.5" 
            fill="none"
            :opacity="1"
          />
          
          <!-- X mark for altered messages -->
          <g v-if="level === 'altered' || level === 'human_written'">
            <line 
              x1="35" y1="35" x2="85" y2="85" 
              :stroke="level === 'human_written' ? '#E91E63' : '#FF9800'" 
              stroke-width="4" 
              stroke-linecap="round"
              opacity="0.8"
            />
            <line 
              x1="85" y1="35" x2="35" y2="85" 
              :stroke="level === 'human_written' ? '#E91E63' : '#FF9800'" 
              stroke-width="4" 
              stroke-linecap="round"
              opacity="0.8"
            />
          </g>
          
          <!-- Question mark for legacy -->
          <text 
            v-if="level === 'legacy'"
            x="60" 
            y="75" 
            text-anchor="middle" 
            :fill="arcColor"
            font-size="40"
            font-weight="bold"
            opacity="0.6"
          >?</text>
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

// Show at least 2 arcs for unaltered+
const showTwoArcs = computed(() => 
  !['altered', 'legacy', 'human_written'].includes(props.level)
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

