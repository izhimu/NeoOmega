<script setup lang="ts">
interface Props {
  size?: 'sm' | 'md' | 'lg';
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  class: '',
});
</script>

<template>
  <div
    class="relative flex items-center justify-center shrink-0 bg-slate-900 dark:bg-slate-950 border border-slate-700/60 dark:border-white/15 shadow-sm shadow-slate-950/25 overflow-hidden select-none"
    :class="[
      size === 'sm' ? 'w-7.5 h-7.5 rounded-xl' : size === 'lg' ? 'w-11 h-11 rounded-2xl' : 'w-9 h-9 rounded-2xl',
      props.class,
    ]"
  >
    <!-- Subtle top rim specular highlight for tactile depth -->
    <div class="absolute inset-x-1.5 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none" />

    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class="w-full h-full p-2"
    >
      <!-- Diagonal Transit Conduit (Electric Cyan) -->
      <line
        x1="9"
        y1="8"
        x2="23"
        y2="24"
        stroke="#0ea5e9"
        stroke-width="3"
        stroke-opacity="0.25"
        stroke-linecap="round"
      />
      <line
        x1="9"
        y1="8"
        x2="23"
        y2="24"
        stroke="#38bdf8"
        stroke-width="2.6"
        stroke-linecap="round"
      />
      <!-- Left Vertical Route Pillar (Crisp Titanium White) -->
      <line
        x1="9"
        y1="8"
        x2="9"
        y2="24"
        stroke="#f8fafc"
        stroke-width="2.6"
        stroke-linecap="round"
      />
      <!-- Right Vertical Route Pillar (Crisp Titanium White) -->
      <line
        x1="23"
        y1="8"
        x2="23"
        y2="24"
        stroke="#f8fafc"
        stroke-width="2.6"
        stroke-linecap="round"
      />
    </svg>
  </div>
</template>
