<script setup lang="ts">
import { AlertTriangle, Delete, KeyRound, Lock, Trash2 } from 'lucide-vue-next';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import ConfirmActionDialog from '~/components/ConfirmActionDialog.vue';
import { useMobileWalletStore } from '~/composables/useMobileWalletStore';
import { useWalletI18n } from '~/composables/useWalletI18n';
import { hapticImpact } from '~/utils/nativeBridge';

const store = useMobileWalletStore();
const { t } = useWalletI18n();

const confirmDialogRef = ref<InstanceType<typeof ConfirmActionDialog> | null>(null);
const passwordMode = ref(!store.hasQuickPin.value);
const pinDigits = ref('');
const vaultPassword = ref('');
const errorText = ref('');
const busy = ref(false);

watch(
  () => store.hasQuickPin.value,
  (enabled) => {
    passwordMode.value = !enabled;
    pinDigits.value = '';
    errorText.value = '';
  }
);

const pinDots = computed(() => [0, 1, 2, 3, 4, 5].map((i) => i < pinDigits.value.length));

async function submitPin() {
  if (pinDigits.value.length !== 6 || busy.value) return;
  busy.value = true;
  errorText.value = '';
  try {
    const res = await store.unlockWithPin(pinDigits.value);
    if (!res.ok) {
      pinDigits.value = '';
      if (res.wiped) {
        errorText.value = t('quickPinWiped');
        passwordMode.value = true;
      } else {
        errorText.value = t('quickPinAttemptsLeft', { count: res.remainingAttempts });
      }
    }
  } finally {
    busy.value = false;
  }
}

function pressDigit(digit: string) {
  if (busy.value || pinDigits.value.length >= 6) return;
  void hapticImpact('light');
  errorText.value = '';
  pinDigits.value += digit;
  if (pinDigits.value.length === 6) {
    void submitPin();
  }
}

function backspacePin() {
  if (busy.value || !pinDigits.value.length) return;
  void hapticImpact('light');
  pinDigits.value = pinDigits.value.slice(0, -1);
}

async function handlePasswordUnlock() {
  if (!vaultPassword.value || busy.value) return;
  busy.value = true;
  errorText.value = '';
  try {
    const ok = await store.unlockWithPassword(vaultPassword.value);
    if (!ok) {
      errorText.value = t('wrongPasswordErr');
    } else {
      vaultPassword.value = '';
    }
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : t('wrongPasswordErr');
  } finally {
    busy.value = false;
  }
}

onBeforeUnmount(() => {
  vaultPassword.value = '';
  pinDigits.value = '';
});

async function handleWipeRequest() {
  const confirmed = await confirmDialogRef.value?.ask({
    title: t('wipeDialogTitle'),
    description: t('wipeDialogDesc'),
    confirmLabel: t('wipeConfirmBtn'),
    destructive: true
  });
  if (confirmed) {
    await store.wipeActiveProfile();
  }
}
</script>

<template>
  <div class="mx-auto max-w-md space-y-4">
    <div class="vault-hero p-5 sm:p-6 space-y-5">
      <!-- Framed Vault Emblem Header -->
      <div class="flex flex-col items-center text-center space-y-2">
        <div
          class="flex h-14 w-14 items-center justify-center rounded-2xl border border-(--border-strong) bg-(--surface-elevated) p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
        >
          <img src="/logo.svg" alt="KRISTA" class="h-full w-full object-contain" />
        </div>
        <div class="space-y-1">
          <div class="inline-flex items-center gap-1.5 rounded-full bg-(--surface-elevated) px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider text-(--accent)">
            <Lock class="h-3 w-3" aria-hidden="true" />
            <span>{{ store.activeProfile.value?.label }}</span>
          </div>
          <h2 class="text-lg font-extrabold tracking-tight">{{ t('unlockTitle') }}</h2>
        </div>
      </div>

      <!-- 6-Digit Quick PIN Mode -->
      <div v-if="store.hasQuickPin.value && !passwordMode" class="space-y-4">
        <p class="text-center text-xs text-(--text-muted)">{{ t('quickPinEnter') }}</p>

        <div class="flex justify-center gap-3.5 py-1.5" aria-hidden="true">
          <span
            v-for="(filled, idx) in pinDots"
            :key="idx"
            class="h-3.5 w-3.5 rounded-full border-2 transition-all duration-150 motion-reduce:transition-none"
            :class="
              filled
                ? 'scale-115 border-(--brand-cobalt) bg-(--brand-cobalt) shadow-[0_0_12px_rgba(118,149,205,0.65)]'
                : 'border-(--border-strong) bg-transparent'
            "
          />
        </div>

        <p
          v-if="errorText"
          class="flex items-center justify-center gap-1.5 rounded-xl bg-(--status-danger-bg) p-2.5 text-center text-xs font-medium text-(--status-danger)"
        >
          <AlertTriangle class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{{ errorText }}</span>
        </p>

        <div class="mx-auto grid max-w-[18.5rem] grid-cols-3 gap-3">
          <button
            v-for="d in ['1', '2', '3', '4', '5', '6', '7', '8', '9']"
            :key="d"
            type="button"
            class="pin-key"
            @click="pressDigit(d)"
          >
            {{ d }}
          </button>
          <button
            type="button"
            class="pin-key !text-xs !font-bold uppercase tracking-wider text-(--text-muted)"
            @click="pinDigits = ''"
          >
            C
          </button>
          <button type="button" class="pin-key" @click="pressDigit('0')">0</button>
          <button
            type="button"
            class="pin-key text-(--text-secondary)"
            aria-label="Backspace"
            @click="backspacePin"
          >
            <Delete class="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          class="btn-secondary w-full"
          @click="passwordMode = true; errorText = ''"
        >
          <KeyRound class="h-4 w-4 text-(--accent)" aria-hidden="true" />
          <span>{{ t('backToPassword') }}</span>
        </button>
      </div>

      <!-- Vault Password Fallback -->
      <form v-else class="space-y-3.5" @submit.prevent="handlePasswordUnlock">
        <div>
          <label for="mob-unlock-password" class="block text-xs font-semibold mb-1.5">
            {{ t('passwordLabel') }}
          </label>
          <input
            id="mob-unlock-password"
            v-model="vaultPassword"
            type="password"
            required
            autocomplete="current-password"
            class="wallet-input"
          />
        </div>

        <p
          v-if="errorText"
          class="flex items-center gap-2 rounded-xl bg-(--status-danger-bg) p-2.5 text-xs font-medium text-(--status-danger)"
        >
          <AlertTriangle class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{{ errorText }}</span>
        </p>

        <button type="submit" :disabled="busy" class="btn-primary w-full">
          <KeyRound class="h-4 w-4" aria-hidden="true" />
          <span>{{ t('unlockBtn') }}</span>
        </button>

        <button
          v-if="store.hasQuickPin.value"
          type="button"
          class="btn-secondary w-full"
          @click="passwordMode = false; errorText = ''"
        >
          {{ t('quickPinEnter') }}
        </button>
      </form>

      <div class="border-t border-(--border-card) pt-3 flex justify-center">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 text-xs font-semibold text-(--status-danger) hover:underline"
          @click="handleWipeRequest"
        >
          <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
          <span>{{ t('wipeWalletBtn') }}</span>
        </button>
      </div>
    </div>

    <ConfirmActionDialog ref="confirmDialogRef" />
  </div>
</template>
