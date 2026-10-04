<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../lib/utils';

export interface LatencyData {
  success?: boolean;
  latency?: number;
  speedMBps?: number;
  speedMbps?: number;
  error?: string;
}

interface Props {
  result?: LatencyData | null;
  ms?: number;
  size?: 'sm' | 'md';
  failedText?: string;
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  result: null,
  ms: undefined,
  size: 'sm',
  failedText: 'ERR',
  class: '',
});

const data = computed<LatencyData | null>(() => {
  if (props.result) return props.result;
  if (props.ms !== undefined) {
    return { success: true, latency: props.ms };
  }
  return null;
});

const isSuccess = computed(() => data.value?.success !== false);
const hasSpeed = computed(() => data.value?.speedMbps !== undefined);
const isFast = computed(() => hasSpeed.value || (data.value?.latency !== undefined && data.value.latency < 300));

const badgeTitle = computed(() => {
  if (!data.value) return '';
  if (isSuccess.value) {
    if (hasSpeed.value) {
      return `${data.value.speedMbps} Mbps (${data.value.speedMBps} MB/s) · ${data.value.latency}ms`;
    }
    return `${data.value.latency}ms`;
  }
  return data.value.error || 'Error';
});

const smClasses = computed(() => {
  if (!isSuccess.value) {
    return 'text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-500/10';
  }
  if (hasSpeed.value) {
    return 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200/50 dark:border-indigo-500/20';
  }
  if (isFast.value) {
    return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10';
  }
  return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10';
});

const mdClasses = computed(() => {
  if (!isSuccess.value) {
    return 'px-2 py-0.5 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/20';
  }
  if (isFast.value) {
    return 'px-2.5 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20';
  }
  return 'px-2.5 py-0.5 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/20';
});

const dotClass = computed(() => {
  if (!isSuccess.value) return 'bg-red-500';
  if (isFast.value) return 'bg-emerald-500';
  return 'bg-amber-500';
});
</script>

<template>
  <template v-if="data">
    <span
      v-if="size === 'sm'"
      :class="cn(
        'text-[10px] font-mono px-1.5 py-0.5 rounded-md shrink-0 font-medium',
        smClasses,
        props.class
      )"
      :title="badgeTitle"
    >
      {{ isSuccess ? (hasSpeed ? `${data.speedMbps} Mbps` : `${data.latency}ms`) : 'ERR' }}
    </span>
    <span
      v-else
      :class="cn(
        'inline-flex items-center gap-1.5 rounded-full text-[11px] font-semibold font-mono border',
        mdClasses,
        props.class
      )"
      :title="badgeTitle"
    >
      <span :class="cn('w-1.5 h-1.5 rounded-full', dotClass)" />
      <template v-if="isSuccess">
        <span v-if="data.speedMBps !== undefined">
          {{ data.speedMbps }} Mbps ({{ data.speedMBps }} MB/s)
        </span>
        <span :class="{ 'opacity-60': data.speedMBps !== undefined }">
          {{ data.latency }} ms
        </span>
      </template>
      <template v-else>
        {{ failedText }}
      </template>
    </span>
  </template>
</template>
