<script setup lang="ts">
import { AlertTriangle, ShieldCheck } from 'lucide-vue-next';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { closeDialogWithMotion, supportsTopLayerExit } from '~/utils/dialogMotion';
import { useWalletI18n } from '~/composables/useWalletI18n';

export interface ConfirmDialogPayload {
  title: string;
  description?: string;
  rows?: Array<{ label: string; value: string }>;
  confirmLabel: string;
  destructive?: boolean;
}

const { t } = useWalletI18n();

const dialogRef = ref<HTMLDialogElement | null>(null);
const currentPayload = ref<ConfirmDialogPayload | null>(null);
let pendingResolve: ((confirmed: boolean) => void) | null = null;

function ask(payload: ConfirmDialogPayload): Promise<boolean> {
  currentPayload.value = payload;
  return new Promise((resolve) => {
    pendingResolve = resolve;
    dialogRef.value?.showModal();
  });
}

const onDialogCancel = (event: Event) => {
  event.preventDefault();
  void closeDialogWithMotion(dialogRef.value, 'cancel');
};

const onFormSubmit = (event: Event) => {
  if (supportsTopLayerExit()) return;
  event.preventDefault();
  const submitEvt = event as SubmitEvent;
  const submitter = submitEvt.submitter as HTMLButtonElement | null;
  const val = submitter?.value ?? '';
  void closeDialogWithMotion(dialogRef.value, val);
};

const onDialogClose = () => {
  const dlg = dialogRef.value;
  if (!dlg) return;
  const accepted = dlg.returnValue === 'confirm';
  dlg.returnValue = '';
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(accepted);
};

onMounted(() => {
  dialogRef.value?.addEventListener('cancel', onDialogCancel);
  dialogRef.value?.addEventListener('close', onDialogClose);
});

onBeforeUnmount(() => {
  dialogRef.value?.removeEventListener('cancel', onDialogCancel);
  dialogRef.value?.removeEventListener('close', onDialogClose);
  if (pendingResolve) {
    pendingResolve(false);
    pendingResolve = null;
  }
});

defineExpose({ ask });
</script>

<template>
  <dialog ref="dialogRef" aria-labelledby="confirm-action-title">
    <form v-if="currentPayload" method="dialog" class="space-y-4" @submit="onFormSubmit">
      <div class="flex items-start gap-3">
        <div
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
          :class="
            currentPayload.destructive
              ? 'bg-(--status-danger-bg) text-(--status-danger)'
              : 'bg-cobalt-400/15 text-(--accent)'
          "
        >
          <AlertTriangle v-if="currentPayload.destructive" class="h-5 w-5" aria-hidden="true" />
          <ShieldCheck v-else class="h-5 w-5" aria-hidden="true" />
        </div>
        <div class="space-y-1 min-w-0">
          <h3 id="confirm-action-title" class="text-base font-bold tracking-tight">
            {{ currentPayload.title }}
          </h3>
          <p
            v-if="currentPayload.description"
            class="text-xs leading-relaxed text-(--text-secondary)"
          >
            {{ currentPayload.description }}
          </p>
        </div>
      </div>

      <dl
        v-if="currentPayload.rows?.length"
        class="card-subtle divide-y divide-(--border-card) px-3.5 py-2.5 text-xs"
      >
        <div
          v-for="row in currentPayload.rows"
          :key="row.label"
          class="flex items-start justify-between gap-3 py-2 first:pt-0.5 last:pb-0.5"
        >
          <dt class="text-(--text-muted) shrink-0">{{ row.label }}</dt>
          <dd class="text-right font-mono font-semibold text-(--text-main) break-all">
            {{ row.value }}
          </dd>
        </div>
      </dl>

      <div class="flex flex-wrap justify-end gap-2 pt-1">
        <button value="cancel" autofocus class="btn-secondary">
          {{ t('cancelBtn') }}
        </button>
        <button
          value="confirm"
          class="inline-flex items-center justify-center rounded-[0.9rem] px-4 py-2.5 text-xs font-bold text-white transition active:scale-[0.98]"
          :class="
            currentPayload.destructive
              ? 'bg-[#B91C1C] hover:bg-[#991B1B]'
              : 'btn-primary !py-2.5 text-xs'
          "
        >
          {{ currentPayload.confirmLabel }}
        </button>
      </div>
    </form>
  </dialog>
</template>
