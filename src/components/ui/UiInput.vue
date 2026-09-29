<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../lib/utils';

interface Props {
  modelValue?: string | number;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  type: 'text',
  placeholder: '',
  disabled: false,
  size: 'md',
  class: '',
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const onInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  emit('update:modelValue', target.value);
};

const sizeClasses = computed(() => {
  return props.size === 'sm'
    ? 'h-8 px-3 text-xs rounded-xl'
    : 'h-9 px-3.5 text-xs rounded-2xl';
});
</script>

<template>
  <input
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :class="cn(
      'w-full bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 shadow-xs transition-all duration-150 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50',
      sizeClasses,
      props.class
    )"
    @input="onInput"
  />
</template>
