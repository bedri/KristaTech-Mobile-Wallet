<script setup lang="ts">
import { Camera, ScanLine, Upload, X } from 'lucide-vue-next';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import jsQR from 'jsqr';
import { closeDialogWithMotion } from '~/utils/dialogMotion';
import { attachDialogLightDismiss } from '~/utils/formAriaSync';
import { hapticNotify } from '~/utils/nativeBridge';
import { useWalletI18n } from '~/composables/useWalletI18n';

const emit = defineEmits<{
  decoded: [payload: string];
}>();

const { t } = useWalletI18n();

const dialogRef = ref<HTMLDialogElement | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);
const scanError = ref('');
const cameraActive = ref(false);

let stream: MediaStream | null = null;
let rafId: number | null = null;
let teardownDismiss: (() => void) | null = null;

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>;
}

function stopCamera() {
  if (rafId !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
    stream = null;
  }
  if (videoRef.value) {
    videoRef.value.srcObject = null;
  }
  cameraActive.value = false;
}

function finishScan(raw: string) {
  const clean = raw.trim();
  if (!clean) return;
  void hapticNotify('success');
  stopCamera();
  void closeDialogWithMotion(dialogRef.value, 'decoded');
  emit('decoded', clean);
}

async function startCameraLoop() {
  scanError.value = '';
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    scanError.value = t('cameraDeniedMsg');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    const video = videoRef.value;
    if (!video) {
      stopCamera();
      return;
    }
    video.srcObject = stream;
    await video.play();
    cameraActive.value = true;

    const DetectorCtor = (
      globalThis as unknown as {
        BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
      }
    ).BarcodeDetector;
    const detector = DetectorCtor ? new DetectorCtor({ formats: ['qr_code'] }) : null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = async () => {
      if (!cameraActive.value || !videoRef.value) return;
      const v = videoRef.value;
      if (v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
        if (detector) {
          try {
            const hits = await detector.detect(v);
            if (hits[0]?.rawValue) {
              finishScan(hits[0].rawValue);
              return;
            }
          } catch {
            // Fall through to jsQR
          }
        }
        if (ctx) {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = jsQR(imgData.data, imgData.width, imgData.height);
          if (qr?.data) {
            finishScan(qr.data);
            return;
          }
        }
      }
      rafId = requestAnimationFrame(() => {
        void tick();
      });
    };

    rafId = requestAnimationFrame(() => {
      void tick();
    });
  } catch {
    cameraActive.value = false;
    scanError.value = t('cameraDeniedMsg');
  }
}

const MAX_QR_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_QR_IMAGE_DIMENSION = 1600;

async function onQrImageFile(evt: Event) {
  scanError.value = '';
  const input = evt.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  if (file.size > MAX_QR_IMAGE_BYTES) {
    scanError.value = `${t('scanFailedMsg')} (max 10 MB)`;
    void hapticNotify('error');
    return;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_QR_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height, 1));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      scanError.value = t('scanFailedMsg');
      return;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    const imgData = ctx.getImageData(0, 0, width, height);
    const qr = jsQR(imgData.data, imgData.width, imgData.height);
    if (qr?.data) {
      finishScan(qr.data);
    } else {
      scanError.value = t('scanFailedMsg');
      void hapticNotify('error');
    }
  } catch {
    scanError.value = t('scanFailedMsg');
    void hapticNotify('error');
  } finally {
    bitmap?.close();
  }
}

function open() {
  scanError.value = '';
  dialogRef.value?.showModal();
  void startCameraLoop();
}

function close() {
  stopCamera();
  void closeDialogWithMotion(dialogRef.value, 'cancel');
}

const onDialogCancel = (event: Event) => {
  event.preventDefault();
  close();
};

const onDialogClose = () => {
  stopCamera();
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
  stopCamera();
  teardownDismiss?.();
  dialogRef.value?.removeEventListener('cancel', onDialogCancel);
  dialogRef.value?.removeEventListener('close', onDialogClose);
});

defineExpose({ open, close });
</script>

<template>
  <dialog ref="dialogRef" closedby="any" aria-labelledby="qr-scanner-title">
    <div class="space-y-3.5">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2.5">
          <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-cobalt-400/15 text-(--accent)">
            <ScanLine class="h-4 w-4" aria-hidden="true" />
          </div>
          <h3 id="qr-scanner-title" class="text-base font-bold tracking-tight">
            {{ t('scanQr') }}
          </h3>
        </div>
        <button
          type="button"
          autofocus
          class="icon-circle-btn"
          :aria-label="t('closeBtn')"
          @click="close"
        >
          <X class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <p class="text-xs leading-relaxed text-(--text-muted)">{{ t('cameraScanHint') }}</p>

      <div class="relative overflow-hidden rounded-2xl border border-(--border-strong) bg-[#050811] aspect-square max-h-72 w-full">
        <video
          ref="videoRef"
          playsinline
          muted
          class="h-full w-full object-cover"
        />

        <!-- Viewfinder corner brackets -->
        <div class="pointer-events-none absolute inset-6" aria-hidden="true">
          <span class="absolute left-0 top-0 h-5 w-5 rounded-tl-lg border-l-2 border-t-2 border-cobalt-400" />
          <span class="absolute right-0 top-0 h-5 w-5 rounded-tr-lg border-r-2 border-t-2 border-cobalt-400" />
          <span class="absolute bottom-0 left-0 h-5 w-5 rounded-bl-lg border-b-2 border-l-2 border-coral-400" />
          <span class="absolute bottom-0 right-0 h-5 w-5 rounded-br-lg border-b-2 border-r-2 border-coral-400" />
        </div>

        <div
          v-if="!cameraActive"
          class="absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-5 text-center text-xs text-slate-300"
        >
          <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-cobalt-400">
            <Camera class="h-5 w-5" aria-hidden="true" />
          </div>
          <span>{{ scanError || t('cameraScanHint') }}</span>
        </div>
      </div>

      <p
        v-if="scanError && cameraActive"
        class="rounded-xl bg-(--status-danger-bg) px-3 py-2 text-xs font-medium text-(--status-danger)"
      >
        {{ scanError }}
      </p>

      <div class="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <label class="btn-secondary cursor-pointer !py-2 text-xs">
          <Upload class="h-3.5 w-3.5 text-(--accent)" aria-hidden="true" />
          <span>{{ t('uploadQrImage') }}</span>
          <input
            type="file"
            accept="image/*"
            class="sr-only"
            @change="onQrImageFile"
          />
        </label>
        <button
          type="button"
          class="btn-secondary !py-2 text-xs"
          @click="close"
        >
          {{ t('cancelBtn') }}
        </button>
      </div>
    </div>
  </dialog>
</template>
