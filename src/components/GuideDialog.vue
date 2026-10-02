<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch, type Component } from 'vue';
import { ChevronLeft, ChevronRight, EllipsisVertical, Lock, MousePointerClick, Puzzle, Rocket, Server, SlidersHorizontal, Split, X } from '@lucide/vue';
import UiButton from './ui/UiButton.vue';
import AppLogo from './ui/AppLogo.vue';
import { useI18n } from '../core/i18n';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>();

const { t } = useI18n();

const step = ref(0);
const steps: { icon: Component; key: string; target: string | null; mock?: 'toolbar'; color: string }[] = [
  { icon: Server, key: 'guideStep1', target: 'new-profile', color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10' },
  { icon: SlidersHorizontal, key: 'guideStepServer', target: 'server-config', color: 'text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-500/10' },
  { icon: Split, key: 'guideStep2', target: 'profile-autoSwitch', color: 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10' },
  { icon: MousePointerClick, key: 'guideStep3', target: null, mock: 'toolbar', color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10' },
  { icon: Rocket, key: 'guideStep4', target: null, color: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10' },
];
const current = computed(() => steps[step.value]!);
const isLast = computed(() => step.value === steps.length - 1);

// Spotlight: track the target element's viewport rect; null → centered card
const rect = ref<DOMRect | null>(null);
const updateRect = () => {
  rect.value = null;
  const target = current.value.target;
  if (!props.open || !target) return;
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return;
  const r = el.getBoundingClientRect();
  // treat offscreen (e.g. hidden mobile drawer) as no target
  if (r.width === 0 || r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight) return;
  rect.value = r;
};

const ringStyle = computed(() => {
  if (!rect.value) return null;
  const r = rect.value;
  return {
    left: `${r.left - 4}px`,
    top: `${r.top - 4}px`,
    width: `${r.width + 8}px`,
    height: `${r.height + 8}px`,
  };
});

const CARD_W = 340;
const CARD_H = 220;
const cardStyle = computed(() => {
  const r = rect.value;
  if (!r) {
    return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  }
  const gap = 12;
  let left = r.right + gap;
  if (left + CARD_W > window.innerWidth - 16) {
    left = r.left - CARD_W - gap;
  }
  if (left < 16) {
    // no room on either side: drop below (or above)
    left = Math.min(Math.max(16, r.left), window.innerWidth - CARD_W - 16);
    const top = r.bottom + gap + CARD_H <= window.innerHeight - 16 ? r.bottom + gap : Math.max(16, r.top - CARD_H - gap);
    return { left: `${left}px`, top: `${top}px` };
  }
  const top = Math.min(Math.max(16, r.top - 4), window.innerHeight - CARD_H - 16);
  return { left: `${left}px`, top: `${top}px` };
});

const close = () => emit('update:open', false);
const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') close();
};

watch(() => props.open, async (v) => {
  if (v) {
    step.value = 0;
    await nextTick();
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('keydown', onKeydown);
  } else {
    window.removeEventListener('resize', updateRect);
    window.removeEventListener('scroll', updateRect, true);
    window.removeEventListener('keydown', onKeydown);
  }
});
watch(step, async () => {
  await nextTick();
  updateRect();
});

onUnmounted(() => {
  window.removeEventListener('resize', updateRect);
  window.removeEventListener('scroll', updateRect, true);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 font-sans text-slate-800 dark:text-slate-100">
      <!-- Backdrop (dimmed when no spotlight target) -->
      <div class="absolute inset-0" :class="ringStyle ? 'bg-black/20' : 'bg-black/50 backdrop-blur-sm'" @click="close" />

      <!-- Spotlight ring: box-shadow cuts the hole in the dim layer -->
      <div
        v-if="ringStyle"
        class="absolute rounded-xl pointer-events-none transition-all duration-200 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
        :style="ringStyle"
      />


      <!-- Guide card -->
      <div
        class="absolute w-[340px] max-w-[calc(100vw-2rem)] p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl transition-all duration-200"
        :style="cardStyle"
        role="dialog"
        :aria-label="t('options.guideTitle')"
      >
        <div class="flex justify-between items-start mb-3">
          <div class="flex flex-col gap-0.5 pr-4">
            <span class="text-sm font-bold text-slate-900 dark:text-white leading-tight">{{ t('options.guideTitle') }}</span>
            <span class="text-[11px] text-slate-400 dark:text-slate-500">{{ t('options.guideDesc') }}</span>
          </div>
          <button
            type="button"
            class="p-1 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
            :aria-label="t('common.close')"
            @click="close"
          >
            <X :size="16" />
          </button>
        </div>

        <div class="flex items-start gap-3.5 min-h-[72px]">
          <div :class="['w-10 h-10 rounded-2xl flex items-center justify-center shrink-0', current.color]">
            <component :is="current.icon" :size="20" />
          </div>
          <div class="flex flex-col gap-1 min-w-0">
            <span class="text-sm font-bold text-slate-900 dark:text-white">{{ t(`options.${current.key}Title`) }}</span>
            <p class="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{{ t(`options.${current.key}Desc`) }}</p>
          </div>
        </div>

        <!-- Mock browser toolbar with highlighted extension icon -->
        <div
          v-if="current.mock === 'toolbar'"
          class="flex items-center gap-1.5 px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200/80 dark:border-white/10"
        >
          <Lock :size="11" class="text-slate-400 dark:text-slate-500 shrink-0" />
          <div class="flex-1 h-5 rounded-md bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 flex items-center px-2 overflow-hidden">
            <span class="text-[9px] text-slate-400 dark:text-slate-500">example.com</span>
          </div>
          <div class="shrink-0 rounded-md ring-2 ring-blue-500 dark:ring-blue-400 animate-pulse">
            <AppLogo size="sm" class="!w-5 !h-5 !rounded-md" />
          </div>
          <Puzzle :size="13" class="text-slate-400 dark:text-slate-500 shrink-0" />
          <EllipsisVertical :size="13" class="text-slate-400 dark:text-slate-500 shrink-0" />
        </div>

        <div class="flex items-center justify-between pt-3 mt-1 border-t border-slate-100 dark:border-white/5">
          <div class="flex items-center gap-1.5">
            <span
              v-for="(s, i) in steps"
              :key="i"
              class="h-1.5 rounded-full transition-all"
              :class="i === step ? 'w-4 bg-blue-600 dark:bg-blue-400' : 'w-1.5 bg-slate-200 dark:bg-white/10'"
            />
          </div>
          <div class="flex items-center gap-2">
            <UiButton v-if="step > 0" variant="ghost" size="sm" @click="step--">
              <ChevronLeft :size="14" />
              {{ t('options.guidePrev') }}
            </UiButton>
            <UiButton v-if="!isLast" size="sm" @click="step++">
              {{ t('options.guideNext') }}
              <ChevronRight :size="14" />
            </UiButton>
            <UiButton v-else size="sm" @click="close">{{ t('options.guideDone') }}</UiButton>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
