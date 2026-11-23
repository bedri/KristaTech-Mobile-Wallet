<script lang="ts">
// Shared VoiceOver duplicate-message tracker across CopyButton instances (modern-web-guidance: copy-button)
let lastSpokenCopyTip = '';
</script>

<script setup lang="ts">
import { Check, Copy } from 'lucide-vue-next';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { copySensitiveTextNative, copyTextNative } from '~/utils/nativeBridge';

const props = withDefaults(
  defineProps<{
    targetId?: string;
    value?: string;
    label: string;
    copiedLabel: string;
    failedLabel?: string;
    ariaLabel?: string;
    compact?: boolean;
    sensitive?: boolean;
  }>(),
  {
    failedLabel: 'Copy failed',
    compact: false,
    sensitive: false
  }
);

const btnRef = ref<HTMLButtonElement | null>(null);
const copied = ref(false);
const failed = ref(false);
const tipText = ref('');

const supportsInvokerCommands =
  typeof window !== 'undefined' && 'CommandEvent' in window;

let clearTimer: ReturnType<typeof setTimeout> | undefined;

function showFeedback(ok: boolean) {
  const el = btnRef.value;
  clearTimeout(clearTimer);
  copied.value = false;
  failed.value = false;
  tipText.value = '';

  if (el) {
    el.removeAttribute('data-copied');
    el.removeAttribute('data-failed');
    void el.offsetWidth;
    el.setAttribute(ok ? 'data-copied' : 'data-failed', '');
  }

  copied.value = ok;
  failed.value = !ok;

  let msg = ok ? props.copiedLabel : props.failedLabel;
  if (msg === lastSpokenCopyTip) {
    msg += '\u00A0';
  }
  lastSpokenCopyTip = msg;

  requestAnimationFrame(() => {
    tipText.value = msg;
  });

  clearTimer = setTimeout(() => {
    copied.value = false;
    failed.value = false;
    tipText.value = '';
    if (el) {
      el.removeAttribute('data-copied');
      el.removeAttribute('data-failed');
    }
  }, 2000);
}

async function performCopy() {
  let text = props.value?.trim() ?? '';
  if (!text && props.targetId && typeof document !== 'undefined') {
    const target = document.getElementById(props.targetId);
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      text = target.value.trim();
    } else if (target) {
      text = target.innerText.trim();
    }
  }
  if (!text) return;

  const ok = props.sensitive ? await copySensitiveTextNative(text) : await copyTextNative(text);
  showFeedback(ok);
}

const onDocumentCommand = (event: Event) => {
  const cmdEvt = event as Event & { source?: EventTarget | null; command?: string };
  if (cmdEvt.source === btnRef.value && cmdEvt.command === '--copy') {
    void performCopy();
  }
};

const onFallbackClick = () => {
  if (!supportsInvokerCommands || !props.targetId) {
    void performCopy();
  }
};

onMounted(() => {
  if (supportsInvokerCommands && props.targetId && typeof document !== 'undefined') {
    document.addEventListener('command', onDocumentCommand, true);
  }
});

onBeforeUnmount(() => {
  clearTimeout(clearTimer);
  if (supportsInvokerCommands && typeof document !== 'undefined') {
    document.removeEventListener('command', onDocumentCommand, true);
  }
});
</script>

<template>
  <span class="copy-wrap">
    <button
      ref="btnRef"
      type="button"
      class="copy-button btn-secondary !rounded-xl !px-3 !py-1.5 text-xs"
      :class="{ '!border-(--status-ok) !text-(--status-ok)': copied }"
      :command="targetId ? '--copy' : undefined"
      :commandfor="targetId"
      :aria-label="ariaLabel || label"
      @click="onFallbackClick"
    >
      <Check v-if="copied" class="h-3.5 w-3.5 shrink-0 text-(--status-ok)" aria-hidden="true" />
      <Copy v-else class="h-3.5 w-3.5 shrink-0 text-(--accent)" aria-hidden="true" />
      <span v-if="!compact">{{ copied ? copiedLabel : label }}</span>
    </button>
    <span class="copy-tip" role="status">{{ tipText }}</span>
  </span>
</template>
