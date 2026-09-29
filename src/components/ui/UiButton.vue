<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../lib/utils';
import { Loader2 } from 'lucide-vue-next';

interface Props {
  variant?: 'primary' | 'secondary' | 'outline' | 'destructive' | 'ghost' | 'dashed';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  disabled: false,
  loading: false,
  type: 'button',
  class: '',
});

const variantClasses = computed(() => {
  switch (props.variant) {
    case 'primary':
      return 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-xs dark:shadow-blue-900/20';
    case 'secondary':
      return 'bg-slate-100 hover:bg-slate-200 active:bg-slate-300 dark:bg-white/10 dark:hover:bg-white/15 dark:active:bg-white/20 text-slate-800 dark:text-slate-200 border border-slate-200/80 dark:border-white/10 shadow-xs';
    case 'outline':
      return 'bg-white dark:bg-slate-900/80 hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10 shadow-xs hover:border-slate-300 dark:hover:border-white/20';
    case 'destructive':
      return 'bg-red-50 dark:bg-red-500/10 hover:bg-red-600 hover:text-white text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/30 shadow-xs';
    case 'ghost':
      return 'bg-transparent hover:bg-slate-100 dark:hover:bg-white/10 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white';
    case 'dashed':
      return 'bg-slate-100/60 dark:bg-white/5 hover:bg-slate-200/60 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 border border-dashed border-slate-300 dark:border-white/20 hover:border-blue-500 dark:hover:border-blue-400 shadow-xs';
    default:
      return '';
  }
});

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'h-8 px-3 text-xs rounded-xl gap-1.5';
    case 'md':
      return 'h-9 px-4 text-xs font-semibold rounded-2xl gap-2';
    case 'lg':
      return 'h-11 px-5 text-sm font-semibold rounded-2xl gap-2.5';
    case 'icon':
      return 'h-8 w-8 p-1.5 rounded-xl justify-center';
    default:
      return 'h-9 px-4 text-xs rounded-2xl gap-2';
  }
});
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :class="cn(
      'inline-flex items-center justify-center font-medium transition-all duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
      variantClasses,
      sizeClasses,
      props.class
    )"
  >
    <Loader2 v-if="loading" class="animate-spin shrink-0" :size="size === 'sm' || size === 'icon' ? 14 : 16" />
    <slot />
  </button>
</template>
