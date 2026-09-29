<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'radix-vue';
import { X } from 'lucide-vue-next';
import { cn } from '../../lib/utils';

interface Props {
  open?: boolean;
  title?: string;
  description?: string;
  maxWidth?: string;
  showClose?: boolean;
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  open: false,
  title: '',
  description: '',
  maxWidth: 'max-w-md',
  showClose: true,
  class: '',
});

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay
        class="dialog-overlay fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      />
      <DialogContent
        :class="cn(
          'dialog-content fixed left-1/2 top-1/2 z-50 w-full p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl focus:outline-none',
          maxWidth,
          props.class
        )"
      >
        <div class="flex justify-between items-start mb-4">
          <div class="flex flex-col gap-1 pr-4">
            <DialogTitle v-if="title" class="text-base font-bold text-slate-900 dark:text-white leading-tight">
              {{ title }}
            </DialogTitle>
            <DialogDescription v-if="description" class="text-xs text-slate-500 dark:text-slate-400">
              {{ description }}
            </DialogDescription>
          </div>
          <DialogClose
            v-if="showClose"
            class="p-1 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X :size="16" />
          </DialogClose>
        </div>

        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
