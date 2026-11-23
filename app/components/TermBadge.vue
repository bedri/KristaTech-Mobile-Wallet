<script setup lang="ts">
import { BookOpen, X } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  getCategoryLabel,
  getLocalizedGlossaryTerm,
  type GlossaryTermId
} from '~/utils/mobileI18n';
import { closeDialogWithMotion } from '~/utils/dialogMotion';
import { attachDialogLightDismiss } from '~/utils/formAriaSync';
import { useWalletI18n } from '~/composables/useWalletI18n';

const props = defineProps<{
  termId: GlossaryTermId;
  label?: string;
}>();

const { locale, t } = useWalletI18n();
const dialogRef = ref<HTMLDialogElement | null>(null);
const titleId = `term-title-${props.termId}`;
let teardownDismiss: (() => void) | null = null;

const term = computed(() => getLocalizedGlossaryTerm(props.termId, locale.value));
const categoryLabel = computed(() =>
  term.value ? getCategoryLabel(term.value.category, locale.value) : ''
);

const openModal = () => {
  dialogRef.value?.showModal();
};

const closeModal = () => {
  void closeDialogWithMotion(dialogRef.value, 'close');
};

const onDialogCancel = (event: Event) => {
  event.preventDefault();
  void closeDialogWithMotion(dialogRef.value, '');
};

const onDialogClose = () => {
  if (dialogRef.value) {
    dialogRef.value.returnValue = '';
  }
};

onMounted(() => {
  if (dialogRef.value) {
    teardownDismiss = attachDialogLightDismiss(dialogRef.value);
    dialogRef.value.addEventListener('cancel', onDialogCancel);
    dialogRef.value.addEventListener('close', onDialogClose);
  }
});

onBeforeUnmount(() => {
  teardownDismiss?.();
  dialogRef.value?.removeEventListener('cancel', onDialogCancel);
  dialogRef.value?.removeEventListener('close', onDialogClose);
});
</script>

<template>
  <span v-if="term" class="inline-flex items-center">
    <button
      type="button"
      class="icon-hit-expand inline-flex h-5 w-5 items-center justify-center rounded-full border border-(--border-strong) bg-(--surface-elevated) text-[10px] font-bold text-(--accent) transition hover:border-(--accent)"
      :aria-label="label || term.plainTitle || termId"
      @click="openModal"
    >
      ?
    </button>

    <dialog
      ref="dialogRef"
      closedby="any"
      :aria-labelledby="titleId"
    >
      <div class="space-y-3.5">
        <div class="flex items-start justify-between gap-3">
          <div class="space-y-1.5 min-w-0">
            <span
              class="inline-flex items-center gap-1.5 rounded-full bg-(--surface-elevated) px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-(--accent)"
            >
              <BookOpen class="h-3 w-3 shrink-0" aria-hidden="true" />
              <span class="truncate">{{ categoryLabel }} · {{ term.technicalTerm }}</span>
            </span>
            <h3 :id="titleId" class="text-lg font-bold tracking-tight">
              {{ term.plainTitle }}
            </h3>
          </div>
          <button
            type="button"
            autofocus
            class="icon-circle-btn shrink-0"
            :aria-label="t('closeBtn')"
            @click="closeModal"
          >
            <X class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p class="text-sm font-medium leading-relaxed text-(--text-main)">
          {{ term.oneLiner }}
        </p>

        <div class="card-subtle p-3.5 text-xs leading-relaxed text-(--text-secondary)">
          {{ term.detail }}
        </div>

        <p class="rounded-xl border border-(--border-card) bg-(--surface-elevated) p-3 text-xs leading-relaxed text-(--text-main)">
          {{ term.example }}
        </p>

        <div class="flex items-center justify-between gap-2 pt-0.5">
          <p v-if="term.qtFaqTopic" class="text-[11px] font-mono text-(--text-muted)">
            {{ t('faqTopicLabel', { n: term.qtFaqTopic }) }}
          </p>
          <span v-else />
          <button type="button" class="btn-secondary !px-3.5 !py-1.5 text-xs" @click="closeModal">
            {{ t('closeBtn') }}
          </button>
        </div>
      </div>
    </dialog>
  </span>
</template>
