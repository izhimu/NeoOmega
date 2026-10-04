<script setup lang="ts">
import { Coffee, Rocket, Gem, ArrowUpRight } from '@lucide/vue';
import UiDialog from './ui/UiDialog.vue';
import { useI18n } from '../core/i18n';
import { AFDIAN_URL, SPONSOR_PLANS, afdianOrderUrl } from '../core/sponsors';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>();

const { t } = useI18n();

const tierIcons = [Coffee, Rocket, Gem];
const tierColors = [
  'text-amber-600 dark:text-amber-400',
  'text-blue-600 dark:text-blue-400',
  'text-violet-600 dark:text-violet-400',
];

const sponsor = (planId: string) => {
  window.open(afdianOrderUrl(planId), '_blank', 'noopener');
};
const openCustom = () => {
  window.open(AFDIAN_URL, '_blank', 'noopener');
};
</script>

<template>
  <UiDialog
    :open="open"
    :title="t('options.sponsorTitle')"
    :description="t('options.sponsorThanks')"
    max-width="max-w-md"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-3">
      <div class="grid grid-cols-3 gap-2.5">
        <button
          v-for="(plan, i) in SPONSOR_PLANS"
          :key="plan.planId"
          type="button"
          class="flex flex-col items-center gap-1.5 px-2 py-4 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-blue-400 dark:hover:border-blue-400/60 hover:shadow-md transition-all cursor-pointer group"
          @click="sponsor(plan.planId)"
        >
          <component :is="tierIcons[i]" :size="20" :class="tierColors[i]" />
          <span class="text-lg font-bold text-slate-900 dark:text-white leading-none">¥{{ plan.price }}</span>
          <span class="text-[10px] text-slate-400 dark:text-slate-500">{{ t('options.sponsorPerMonth') }}</span>
          <span class="text-[10px] font-medium text-blue-600 dark:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
            {{ t('options.sponsorAction') }}
            <ArrowUpRight :size="10" />
          </span>
        </button>
      </div>

      <button
        type="button"
        class="w-full text-center text-[11px] text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
        @click="openCustom"
      >
        {{ t('options.sponsorCustom') }}
      </button>

    </div>
  </UiDialog>
</template>
