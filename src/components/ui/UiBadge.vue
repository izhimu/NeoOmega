<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../lib/utils';

interface Props {
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'destructive' | 'outline';
  size?: 'sm' | 'md';
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  size: 'md',
  class: '',
});

const variantClasses = computed(() => {
  switch (props.variant) {
    case 'primary':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 border-blue-200 dark:border-blue-500/30';
    case 'success':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30';
    case 'warning':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/30';
    case 'destructive':
      return 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/30';
    case 'outline':
      return 'bg-transparent text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-white/5 dark:text-slate-300 border-slate-200/80 dark:border-white/10';
  }
});
</script>

<template>
  <span
    :class="cn(
      'inline-flex items-center font-medium border transition-colors select-none',
      size === 'sm' ? 'px-2 py-0.5 text-[10px] rounded-full' : 'px-2.5 py-1 text-xs rounded-full',
      variantClasses,
      props.class
    )"
  >
    <slot />
  </span>
</template>
