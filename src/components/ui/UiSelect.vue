<script setup lang="ts">
import { computed } from 'vue';
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'radix-vue';
import { Check, ChevronDown } from '@lucide/vue';
import { cn } from '../../lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  modelValue?: string;
  options?: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  class?: string;
  triggerClass?: string;
  contentClass?: string;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  options: () => [],
  placeholder: 'Select...',
  disabled: false,
  size: 'md',
  class: '',
  triggerClass: '',
  contentClass: '',
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const onValueChange = (val: string) => {
  emit('update:modelValue', val);
};

const triggerSizeClass = computed(() => {
  return props.size === 'sm'
    ? 'h-8 px-2.5 text-xs rounded-xl gap-2'
    : 'h-9 px-3.5 text-xs rounded-2xl gap-2.5';
});
</script>

<template>
  <div :class="cn('relative inline-block w-full', props.class)">
    <SelectRoot
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="onValueChange"
    >
      <SelectTrigger
        :class="cn(
          'flex w-full items-center justify-between bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-white/10 text-slate-800 dark:text-slate-100 shadow-xs transition-all duration-150 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50 select-none cursor-pointer',
          triggerSizeClass,
          props.triggerClass
        )"
      >
        <SelectValue :placeholder="placeholder" class="truncate" />
        <ChevronDown :size="14" class="shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200" />
      </SelectTrigger>

      <SelectPortal>
        <SelectContent
          position="popper"
          :side-offset="4"
          :class="cn(
            'select-content z-50 min-w-[8rem] max-h-60 overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-1 text-slate-800 dark:text-slate-100 shadow-xl dark:shadow-2xl',
            props.contentClass
          )"
        >
          <SelectViewport class="p-1">
            <SelectItem
              v-for="opt in options"
              :key="opt.value"
              :value="opt.value"
              :disabled="opt.disabled"
              class="relative flex w-full cursor-pointer select-none items-center rounded-xl py-1.5 pl-7 pr-2.5 text-xs font-medium outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-40 hover:bg-slate-100 dark:hover:bg-white/5 focus:bg-blue-50 dark:focus:bg-blue-500/10 focus:text-blue-600 dark:focus:text-blue-400"
            >
              <span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                <SelectItemIndicator>
                  <Check :size="13" class="text-blue-600 dark:text-blue-400 font-bold" />
                </SelectItemIndicator>
              </span>
              <SelectItemText>{{ opt.label }}</SelectItemText>
            </SelectItem>
          </SelectViewport>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>
  </div>
</template>
