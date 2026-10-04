<script setup lang="ts">
import { type Component } from 'vue';
import { cn } from '../lib/utils';

interface Props {
  title: string;
  description?: string;
  icon?: Component | any;
  iconClass?: string;
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  description: undefined,
  icon: undefined,
  iconClass: '',
  class: '',
});
</script>

<template>
  <div :class="cn('p-5 sm:p-6 bg-slate-50/60 dark:bg-slate-950/60 border border-slate-200/80 dark:border-white/10 rounded-2xl sm:rounded-3xl flex flex-col gap-3 shadow-xs', props.class)">
    <h3 class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
      <slot name="icon">
        <component :is="icon" v-if="icon" :size="16" :class="iconClass" />
      </slot>
      <slot name="title">{{ title }}</slot>
    </h3>
    <slot name="description">
      <p v-if="description" class="text-xs text-slate-500 dark:text-slate-400">{{ description }}</p>
    </slot>
    <slot />
  </div>
</template>
