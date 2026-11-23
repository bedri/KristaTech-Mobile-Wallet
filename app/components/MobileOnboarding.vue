<script setup lang="ts">
import {
  AlertTriangle,
  Eye,
  KeyRound,
  Plus,
  RotateCcw,
  ScanLine,
  ShieldCheck
} from 'lucide-vue-next';
import { onBeforeUnmount, ref } from 'vue';
import type { NetworkId } from '@kristatech/sdk';
import CopyButton from '~/components/CopyButton.vue';
import { useMobileWalletStore } from '~/composables/useMobileWalletStore';
import { useWalletI18n } from '~/composables/useWalletI18n';
import { hapticImpact, hapticNotify } from '~/utils/nativeBridge';

const emit = defineEmits<{
  requestScanQr: [onResult: (payload: string) => void];
}>();

const store = useMobileWalletStore();
const { t } = useWalletI18n();

const tab = ref<'create' | 'restore' | 'watch'>('create');
const network = ref<NetworkId>('mainnet');
const walletLabel = ref('');
const wordCount = ref<12 | 24>(12);
const password = ref('');
const confirmPassword = ref('');
const passphrase = ref('');
const createdMnemonic = ref('');
const backupConfirmed = ref(false);

const restoreType = ref<'mnemonic' | 'key'>('mnemonic');
const mnemonicInput = ref('');
const keyInput = ref('');
const bip38Pass = ref('');
const watchInput = ref('');

const busy = ref(false);
const errorMsg = ref('');

function openQrFor(setter: (val: string) => void) {
  void hapticImpact('light');
  emit('requestScanQr', (payload) => {
    setter(payload.trim());
  });
}

function clearAllSensitiveInputs(includeCreated = false) {
  password.value = '';
  confirmPassword.value = '';
  passphrase.value = '';
  mnemonicInput.value = '';
  keyInput.value = '';
  bip38Pass.value = '';
  if (includeCreated) {
    createdMnemonic.value = '';
    backupConfirmed.value = false;
  }
}

onBeforeUnmount(() => {
  clearAllSensitiveInputs(true);
});

async function handleCreate() {
  errorMsg.value = '';
  if (password.value.length < 8) {
    errorMsg.value = t('ruleMinLen');
    return;
  }
  if (password.value !== confirmPassword.value) {
    errorMsg.value = t('ruleMismatch');
    return;
  }
  busy.value = true;
  try {
    createdMnemonic.value = await store.createHd({
      label: walletLabel.value.trim() || undefined,
      password: password.value,
      network: network.value,
      wordCount: wordCount.value,
      passphrase: passphrase.value || undefined
    });
    clearAllSensitiveInputs(false);
    void hapticNotify('success');
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
    void hapticNotify('error');
  } finally {
    busy.value = false;
  }
}

async function handleRestore() {
  errorMsg.value = '';
  if (password.value.length < 8) {
    errorMsg.value = t('ruleMinLen');
    return;
  }
  if (password.value !== confirmPassword.value) {
    errorMsg.value = t('ruleMismatch');
    return;
  }
  busy.value = true;
  try {
    if (restoreType.value === 'mnemonic') {
      await store.restoreMnemonic({
        label: walletLabel.value.trim() || undefined,
        mnemonic: mnemonicInput.value,
        passphrase: passphrase.value || undefined,
        password: password.value,
        network: network.value
      });
    } else {
      await store.restoreWif({
        label: walletLabel.value.trim() || undefined,
        keyInput: keyInput.value,
        bip38Passphrase: bip38Pass.value || undefined,
        password: password.value,
        network: network.value
      });
    }
    clearAllSensitiveInputs(true);
    void hapticNotify('success');
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
    void hapticNotify('error');
  } finally {
    busy.value = false;
  }
}

async function handleWatchOnly() {
  errorMsg.value = '';
  busy.value = true;
  try {
    await store.addWatchOnly({
      label: walletLabel.value.trim() || undefined,
      input: watchInput.value,
      network: network.value
    });
    void hapticNotify('success');
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
    void hapticNotify('error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-xl space-y-4">
    <!-- Recovery Phrase Confirmation Step -->
    <div v-if="createdMnemonic" class="card-surface p-5 space-y-4">
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-2.5">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cobalt-400/15 text-(--accent)">
            <ShieldCheck class="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 class="text-base font-bold tracking-tight text-(--accent)">
            {{ t('recoveryPhraseTitle') }}
          </h2>
        </div>
        <CopyButton
          :value="createdMnemonic"
          :label="t('copyBtn')"
          :copied-label="t('copiedMsg')"
          :failed-label="t('copyFailedMsg')"
          compact
          sensitive
        />
      </div>

      <p
        class="flex items-start gap-2 rounded-xl border border-(--status-warn)/30 bg-(--status-warn-bg) p-3 text-xs leading-relaxed text-(--status-warn)"
      >
        <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{{ t('recoveryPhraseWarn') }}</span>
      </p>

      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div
          v-for="(word, idx) in createdMnemonic.split(' ')"
          :key="idx"
          class="card-subtle flex items-center gap-2 px-3 py-2.5 font-mono text-xs"
        >
          <span class="w-5 text-[11px] font-semibold text-(--text-muted) tabular-nums">
            {{ idx + 1 }}.
          </span>
          <span class="font-bold text-(--text-main)">{{ word }}</span>
        </div>
      </div>

      <label
        for="mob-backup-confirm"
        class="card-subtle flex items-start gap-3 p-3 text-xs leading-snug cursor-pointer"
      >
        <input id="mob-backup-confirm" v-model="backupConfirmed" name="backupConfirmed" type="checkbox" class="mt-0.5 h-5 w-5 shrink-0 rounded" />
        <span class="font-medium text-(--text-main)">{{ t('backupConfirmCheck') }}</span>
      </label>

      <button
        type="button"
        :disabled="!backupConfirmed"
        class="btn-primary w-full"
        @click="createdMnemonic = ''"
      >
        {{ t('navWallet') }}
      </button>
    </div>

    <!-- Onboarding Mode Card -->
    <div v-else class="card-surface p-4 sm:p-5 space-y-4">
      <div class="flex items-start justify-between gap-2.5">
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-(--border-card) bg-(--surface-elevated) p-2"
          >
            <img src="/logo.svg" alt="KRISTA" class="h-full w-full object-contain" />
          </div>
          <div class="min-w-0">
            <h2 class="truncate text-base font-extrabold tracking-tight">{{ t('appName') }}</h2>
            <p class="truncate text-xs text-(--text-muted)">{{ t('appTagline') }}</p>
          </div>
        </div>

        <select
          id="mob-onboard-network"
          v-model="network"
          name="network"
          aria-label="Network"
          class="shrink-0 rounded-xl border border-(--border-strong) bg-(--surface-elevated) px-2.5 py-1.5 font-mono text-xs font-bold text-(--text-main)"
        >
          <option value="mainnet">Mainnet</option>
          <option value="testnet">Testnet</option>
          <option value="regtest">Regtest</option>
        </select>
      </div>

      <!-- Single-Row Tab Strip -->
      <div class="tab-strip" role="tablist" aria-label="Onboarding modes">
        <button
          id="onboard-tab-create"
          type="button"
          role="tab"
          class="tab-strip-btn"
          :aria-selected="tab === 'create'"
          @click="tab = 'create'; errorMsg = ''"
        >
          <Plus class="h-3.5 w-3.5" aria-hidden="true" />
          <span>{{ t('createTab') }}</span>
        </button>
        <button
          id="onboard-tab-restore"
          type="button"
          role="tab"
          class="tab-strip-btn"
          :aria-selected="tab === 'restore'"
          @click="tab = 'restore'; errorMsg = ''"
        >
          <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
          <span>{{ t('restoreTab') }}</span>
        </button>
        <button
          id="onboard-tab-watch"
          type="button"
          role="tab"
          class="tab-strip-btn"
          :aria-selected="tab === 'watch'"
          @click="tab = 'watch'; errorMsg = ''"
        >
          <Eye class="h-3.5 w-3.5" aria-hidden="true" />
          <span>{{ t('watchOnlyTab') }}</span>
        </button>
      </div>

      <!-- Create Wallet Form -->
      <form
        v-if="tab === 'create'"
        role="tabpanel"
        aria-labelledby="onboard-tab-create"
        class="space-y-3.5"
        @submit.prevent="handleCreate"
      >
        <div>
          <label for="mob-wallet-name" class="block text-xs font-semibold mb-1.5">
            {{ t('walletNameLabel') }}
          </label>
          <input
            id="mob-wallet-name"
            v-model="walletLabel"
            type="text"
            class="wallet-input"
            placeholder="KRISTA Mobile"
          />
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            class="flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition"
            :class="
              wordCount === 12
                ? 'border-(--accent) bg-cobalt-400/15 text-(--accent)'
                : 'border-(--border-card) bg-(--surface-subtle) text-(--text-secondary)'
            "
            @click="wordCount = 12"
          >
            <KeyRound class="h-3.5 w-3.5" aria-hidden="true" />
            <span>{{ t('wordCount12') }}</span>
          </button>
          <button
            type="button"
            class="flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition"
            :class="
              wordCount === 24
                ? 'border-(--accent) bg-cobalt-400/15 text-(--accent)'
                : 'border-(--border-card) bg-(--surface-subtle) text-(--text-secondary)'
            "
            @click="wordCount = 24"
          >
            <KeyRound class="h-3.5 w-3.5" aria-hidden="true" />
            <span>{{ t('wordCount24') }}</span>
          </button>
        </div>

        <div class="field-group">
          <label for="mob-create-pass" class="block text-xs font-semibold">
            {{ t('passwordLabel') }}
          </label>
          <span id="mob-pass-rules" class="field-hint password-rules">
            {{ t('passwordRulesTitle') }} {{ t('ruleMinLen') }}
          </span>
          <input
            id="mob-create-pass"
            v-model="password"
            type="password"
            required
            minlength="8"
            autocomplete="new-password"
            class="wallet-input"
            aria-describedby="mob-pass-rules"
            data-error="mob-pass-err"
          />
          <div id="mob-pass-err" class="error-msg">
            <span role="img" aria-label="Error">⚠</span> {{ t('ruleMinLen') }}
          </div>
        </div>

        <div>
          <label for="mob-create-confirm" class="block text-xs font-semibold mb-1.5">
            {{ t('passwordConfirmLabel') }}
          </label>
          <input
            id="mob-create-confirm"
            v-model="confirmPassword"
            type="password"
            required
            minlength="8"
            autocomplete="new-password"
            class="wallet-input"
          />
        </div>

        <p
          v-if="errorMsg"
          class="flex items-start gap-2 rounded-xl bg-(--status-danger-bg) p-2.5 text-xs font-medium text-(--status-danger)"
        >
          <AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{{ errorMsg }}</span>
        </p>

        <button type="submit" :disabled="busy" class="btn-primary w-full">
          {{ t('createWalletBtn') }}
        </button>
      </form>

      <!-- Restore Wallet Form -->
      <form
        v-else-if="tab === 'restore'"
        role="tabpanel"
        aria-labelledby="onboard-tab-restore"
        class="space-y-3.5"
        @submit.prevent="handleRestore"
      >
        <div class="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            class="rounded-xl border px-3 py-2.5 text-xs font-bold transition"
            :class="
              restoreType === 'mnemonic'
                ? 'border-(--accent) bg-cobalt-400/15 text-(--accent)'
                : 'border-(--border-card) bg-(--surface-subtle) text-(--text-secondary)'
            "
            @click="restoreType = 'mnemonic'"
          >
            {{ t('restoreModeMnemonic') }}
          </button>
          <button
            type="button"
            class="rounded-xl border px-3 py-2.5 text-xs font-bold transition"
            :class="
              restoreType === 'key'
                ? 'border-(--accent) bg-cobalt-400/15 text-(--accent)'
                : 'border-(--border-card) bg-(--surface-subtle) text-(--text-secondary)'
            "
            @click="restoreType = 'key'"
          >
            {{ t('restoreModeKey') }}
          </button>
        </div>

        <div v-if="restoreType === 'mnemonic'">
          <div class="flex items-center justify-between gap-2 mb-1">
            <label for="mob-restore-words" class="block text-xs font-semibold">
              {{ t('mnemonicInputLabel') }}
            </label>
            <button
              type="button"
              class="btn-secondary !rounded-lg !px-2.5 !py-1 text-[11px]"
              @click="openQrFor((v) => (mnemonicInput = v))"
            >
              <ScanLine class="h-3.5 w-3.5 text-(--accent)" aria-hidden="true" />
              <span>{{ t('scanQr') }}</span>
            </button>
          </div>
          <span id="mob-mnemonic-hint" class="field-hint">{{ t('mnemonicHint') }}</span>
          <textarea
            id="mob-restore-words"
            v-model="mnemonicInput"
            rows="3"
            required
            autocomplete="off"
            autocorrect="off"
            autocapitalize="none"
            spellcheck="false"
            class="wallet-input font-mono text-xs"
            aria-describedby="mob-mnemonic-hint"
          />
        </div>

        <div v-else class="space-y-2.5">
          <div>
            <div class="flex items-center justify-between gap-2 mb-1">
              <label for="mob-restore-key" class="block text-xs font-semibold">
                {{ t('keyInputLabel') }}
              </label>
              <button
                type="button"
                class="btn-secondary !rounded-lg !px-2.5 !py-1 text-[11px]"
                @click="openQrFor((v) => (keyInput = v))"
              >
                <ScanLine class="h-3.5 w-3.5 text-(--accent)" aria-hidden="true" />
                <span>{{ t('scanQr') }}</span>
              </button>
            </div>
            <span id="mob-key-hint" class="field-hint">{{ t('keyInputHint') }}</span>
            <input
              id="mob-restore-key"
              v-model="keyInput"
              type="password"
              required
              autocomplete="off"
              autocorrect="off"
              autocapitalize="none"
              spellcheck="false"
              class="wallet-input font-mono text-xs"
              aria-describedby="mob-key-hint"
            />
          </div>
          <div>
            <label for="mob-bip38-pass" class="block text-xs font-semibold mb-1.5">
              {{ t('bip38PassLabel') }}
            </label>
            <input
              id="mob-bip38-pass"
              v-model="bip38Pass"
              type="password"
              autocomplete="off"
              class="wallet-input"
            />
          </div>
        </div>

        <div class="field-group">
          <label for="mob-restore-pass" class="block text-xs font-semibold">
            {{ t('passwordLabel') }}
          </label>
          <span id="mob-rpass-rules" class="field-hint password-rules">
            {{ t('ruleMinLen') }}
          </span>
          <input
            id="mob-restore-pass"
            v-model="password"
            type="password"
            required
            minlength="8"
            autocomplete="new-password"
            class="wallet-input"
            aria-describedby="mob-rpass-rules"
            data-error="mob-rpass-err"
          />
          <div id="mob-rpass-err" class="error-msg">
            <span role="img" aria-label="Error">⚠</span> {{ t('ruleMinLen') }}
          </div>
        </div>

        <div>
          <label for="mob-restore-confirm" class="block text-xs font-semibold mb-1.5">
            {{ t('passwordConfirmLabel') }}
          </label>
          <input
            id="mob-restore-confirm"
            v-model="confirmPassword"
            type="password"
            required
            minlength="8"
            autocomplete="new-password"
            class="wallet-input"
          />
        </div>

        <p
          v-if="errorMsg"
          class="flex items-start gap-2 rounded-xl bg-(--status-danger-bg) p-2.5 text-xs font-medium text-(--status-danger)"
        >
          <AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{{ errorMsg }}</span>
        </p>

        <button type="submit" :disabled="busy" class="btn-primary w-full">
          {{ t('restoreWalletBtn') }}
        </button>
      </form>

      <!-- Watch-Only Wallet Form -->
      <form
        v-else
        role="tabpanel"
        aria-labelledby="onboard-tab-watch"
        class="space-y-3.5"
        @submit.prevent="handleWatchOnly"
      >
        <div>
          <div class="flex items-center justify-between gap-2 mb-1">
            <label for="mob-watch-input" class="block text-xs font-semibold">
              {{ t('watchInputLabel') }}
            </label>
            <button
              type="button"
              class="btn-secondary !rounded-lg !px-2.5 !py-1 text-[11px]"
              @click="openQrFor((v) => (watchInput = v))"
            >
              <ScanLine class="h-3.5 w-3.5 text-(--accent)" aria-hidden="true" />
              <span>{{ t('scanQr') }}</span>
            </button>
          </div>
          <span id="mob-watch-hint" class="field-hint">{{ t('watchInputHint') }}</span>
          <textarea
            id="mob-watch-input"
            v-model="watchInput"
            rows="3"
            required
            class="wallet-input font-mono text-xs"
            aria-describedby="mob-watch-hint"
          />
        </div>

        <p
          v-if="errorMsg"
          class="flex items-start gap-2 rounded-xl bg-(--status-danger-bg) p-2.5 text-xs font-medium text-(--status-danger)"
        >
          <AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{{ errorMsg }}</span>
        </p>

        <button type="submit" :disabled="busy" class="btn-primary w-full">
          {{ t('watchAddBtn') }}
        </button>
      </form>
    </div>
  </div>
</template>
