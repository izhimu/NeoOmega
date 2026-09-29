<script setup lang="ts">
import UiDialog from './UiDialog.vue';
import UiButton from './UiButton.vue';
import { AlertCircle, AlertTriangle } from 'lucide-vue-next';

interface Props {
  open?: boolean;
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'primary' | 'destructive';
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  open: false,
  title: 'Confirm Action',
  description: 'Are you sure you want to proceed?',
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  variant: 'primary',
  loading: false,
});

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void;
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

const handleCancel = () => {
  emit('cancel');
  emit('update:open', false);
};

const handleConfirm = () => {
  emit('confirm');
};
</script>

<template>
  <UiDialog
    :open="open"
    :title="title"
    :description="description"
    max-width="max-w-sm"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex items-start gap-3 my-2">
      <div
        class="p-2.5 rounded-2xl shrink-0"
        :class="variant === 'destructive' ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'"
      >
        <AlertTriangle v-if="variant === 'destructive'" :size="20" />
        <AlertCircle v-else :size="20" />
      </div>
      <p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed pt-1">
        <slot>
          {{ description }}
        </slot>
      </p>
    </div>

    <div class="flex justify-end gap-2.5 mt-6 pt-3 border-t border-slate-100 dark:border-white/5">
      <UiButton
        variant="secondary"
        size="sm"
        :disabled="loading"
        @click="handleCancel"
      >
        {{ cancelText }}
      </UiButton>
      <UiButton
        :variant="variant"
        size="sm"
        :loading="loading"
        @click="handleConfirm"
      >
        {{ confirmText }}
      </UiButton>
    </div>
  </UiDialog>
</template>
