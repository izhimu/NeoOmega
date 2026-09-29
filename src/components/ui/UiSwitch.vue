<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'radix-vue';
import { cn } from '../../lib/utils';

interface Props {
  checked?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  checked: false,
  disabled: false,
  size: 'md',
  class: '',
});

const emit = defineEmits<{
  (e: 'update:checked', value: boolean): void;
}>();
</script>

<template>
  <SwitchRoot
    :checked="checked"
    :disabled="disabled"
    :class="cn(
      'peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-slate-200 dark:data-[state=unchecked]:bg-slate-700',
      size === 'sm' ? 'h-4 w-7' : 'h-5 w-9',
      props.class
    )"
    @update:checked="emit('update:checked', $event)"
  >
    <SwitchThumb
      :class="cn(
        'pointer-events-none block rounded-full bg-white shadow-md ring-0 transition-transform duration-200 data-[state=unchecked]:translate-x-0',
        size === 'sm'
          ? 'h-3 w-3 data-[state=checked]:translate-x-3'
          : 'h-4 w-4 data-[state=checked]:translate-x-4'
      )"
    />
  </SwitchRoot>
</template>
