import {
  decryptSecretScrypt,
  decryptVault,
  encryptSecretScrypt,
  type EncryptedVault,
  type ScryptEncryptedSecret
} from '@kristatech/sdk';
import {
  DEFAULT_NETWORK_ENDPOINTS,
  UnlockedWalletSession,
  unlockWalletProfile,
  type StoredWalletProfile
} from './walletCore.ts';

export const MAX_PIN_ATTEMPTS = 5;
export const DEFAULT_MOBILE_AUTOLOCK_MINS = 5;

const PROFILES_KEY = 'krista_mobile_profiles_v1';
const ACTIVE_PROFILE_KEY = 'krista_mobile_active_id_v1';
const AUTOLOCK_KEY = 'krista_mobile_autolock_mins_v1';
const LOCK_ON_BG_KEY = 'krista_mobile_lock_on_bg_v1';
const BG_TIMESTAMP_KEY = 'krista_mobile_bg_ts_v1';
const LOCALE_KEY = 'krista_mobile_locale_v1';

function pinKey(profileId: string): string {
  return `krista_mobile_pin_${profileId}`;
}

export interface MobileKeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export function createMemoryKeyValueStore(): MobileKeyValueStore {
  const map = new Map<string, string>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async remove(key) {
      map.delete(key);
    }
  };
}

export type QuickPinRecord =
  | {
      readonly version: 2;
      readonly encryptedPassword: ScryptEncryptedSecret;
      readonly failedAttempts: number;
      readonly updatedAt: number;
    }
  | {
      readonly version: 1;
      readonly encryptedPassword: EncryptedVault;
      readonly failedAttempts: number;
      readonly updatedAt: number;
    };

export function isValidMobilePin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

const WEAK_PIN_SET = new Set([
  '012345',
  '123456',
  '234567',
  '345678',
  '456789',
  '987654',
  '876543',
  '765432',
  '654321',
  '543210',
  '123123',
  '112233',
  '121212',
  '000001',
  '111222',
  '001122',
  '654654'
]);

export function isWeakMobilePin(pin: string): boolean {
  if (!isValidMobilePin(pin)) return true;
  if (/^(.)\1{5}$/.test(pin)) return true;
  return WEAK_PIN_SET.has(pin);
}

/**
 * Encrypts the master vault password inside an AES-256-GCM + scrypt (N=32768, r=8, p=1)
 * envelope with AAD binding keyed by the user's 6-digit Quick PIN. Never stores plaintext passwords.
 */
export async function createPinEnvelope(password: string, pin: string): Promise<QuickPinRecord> {
  if (!isValidMobilePin(pin)) {
    throw new Error('Quick PIN must be exactly 6 numeric digits');
  }
  if (isWeakMobilePin(pin)) {
    throw new Error('Choose a stronger 6-digit PIN (avoid repeated or sequential digits)');
  }
  const encryptedPassword = await encryptSecretScrypt(password, pin);
  return {
    version: 2,
    encryptedPassword,
    failedAttempts: 0,
    updatedAt: Date.now()
  };
}

export type QuickPinUnlockResult =
  | { readonly ok: true; readonly session: UnlockedWalletSession }
  | {
      readonly ok: false;
      readonly reason: 'not_configured' | 'wrong_pin' | 'wiped' | 'corrupted';
      readonly remainingAttempts: number;
      readonly wiped: boolean;
    };

/**
 * Determines whether a wallet session should be locked when returning from background.
 */
export function shouldAutoLockOnResume(
  backgroundedAtMs: number | null,
  nowMs: number,
  lockOnBackground: boolean,
  graceMinutes: number
): boolean {
  if (lockOnBackground) {
    return true;
  }
  if (backgroundedAtMs === null || !Number.isFinite(backgroundedAtMs)) {
    return false;
  }
  const elapsedMs = Math.max(0, nowMs - backgroundedAtMs);
  const clampedMins = Math.min(120, Math.max(1, graceMinutes));
  return elapsedMs >= clampedMins * 60_000;
}

export class MobileWalletStorageManager {
  private readonly store: MobileKeyValueStore;

  constructor(store: MobileKeyValueStore) {
    this.store = store;
  }

  async loadProfiles(): Promise<StoredWalletProfile[]> {
    const raw = await this.store.get(PROFILES_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((p: StoredWalletProfile) => ({
        ...p,
        endpoints: p.endpoints ?? DEFAULT_NETWORK_ENDPOINTS[p.network ?? 'mainnet']
      }));
    } catch {
      return [];
    }
  }

  async saveProfiles(profiles: StoredWalletProfile[], activeId: string | null): Promise<void> {
    await this.store.set(PROFILES_KEY, JSON.stringify(profiles));
    if (activeId) {
      await this.store.set(ACTIVE_PROFILE_KEY, activeId);
    } else {
      await this.store.remove(ACTIVE_PROFILE_KEY);
    }
  }

  async loadActiveProfileId(profiles: ReadonlyArray<StoredWalletProfile>): Promise<string | null> {
    const saved = await this.store.get(ACTIVE_PROFILE_KEY);
    if (saved && profiles.some((p) => p.id === saved)) {
      return saved;
    }
    return profiles[0]?.id ?? null;
  }

  async loadAutoLockMins(): Promise<number> {
    const raw = await this.store.get(AUTOLOCK_KEY);
    if (!raw) return DEFAULT_MOBILE_AUTOLOCK_MINS;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 1 && parsed <= 120
      ? parsed
      : DEFAULT_MOBILE_AUTOLOCK_MINS;
  }

  async saveAutoLockMins(mins: number): Promise<void> {
    const clamped = Math.min(120, Math.max(1, Math.round(mins)));
    await this.store.set(AUTOLOCK_KEY, String(clamped));
  }

  async loadLockOnBackground(): Promise<boolean> {
    const raw = await this.store.get(LOCK_ON_BG_KEY);
    if (raw === null) return true;
    return raw !== '0' && raw !== 'false';
  }

  async saveLockOnBackground(enabled: boolean): Promise<void> {
    await this.store.set(LOCK_ON_BG_KEY, enabled ? '1' : '0');
  }

  async saveBackgroundTimestamp(tsMs: number | null): Promise<void> {
    if (tsMs === null) {
      await this.store.remove(BG_TIMESTAMP_KEY);
    } else {
      await this.store.set(BG_TIMESTAMP_KEY, String(tsMs));
    }
  }

  async loadBackgroundTimestamp(): Promise<number | null> {
    const raw = await this.store.get(BG_TIMESTAMP_KEY);
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }

  async loadLocale(): Promise<string | null> {
    return this.store.get(LOCALE_KEY);
  }

  async saveLocale(lang: string): Promise<void> {
    await this.store.set(LOCALE_KEY, lang);
  }

  async getQuickPinRecord(profileId: string): Promise<QuickPinRecord | null> {
    const raw = await this.store.get(pinKey(profileId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as QuickPinRecord;
      if (parsed && (parsed.version === 2 || parsed.version === 1) && parsed.encryptedPassword) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  async hasQuickPin(profileId: string): Promise<boolean> {
    return (await this.getQuickPinRecord(profileId)) !== null;
  }

  async enableQuickPin(
    profile: StoredWalletProfile,
    vaultPassword: string,
    pin: string
  ): Promise<void> {
    if (profile.mode === 'watch_only' || !profile.vault) {
      throw new Error('Watch-only profiles cannot enable Quick PIN');
    }
    if (!isValidMobilePin(pin)) {
      throw new Error('Quick PIN must be exactly 6 numeric digits');
    }
    if (isWeakMobilePin(pin)) {
      throw new Error('Choose a stronger 6-digit PIN (avoid repeated or sequential digits)');
    }
    // Verify vaultPassword can actually unlock the vault before wrapping it with PIN
    const checkSession = await unlockWalletProfile(profile, vaultPassword);
    checkSession.wipe();

    const record = await createPinEnvelope(vaultPassword, pin);
    await this.store.set(pinKey(profile.id), JSON.stringify(record));
  }

  async disableQuickPin(profileId: string): Promise<void> {
    await this.store.remove(pinKey(profileId));
  }

  async unlockWithQuickPin(
    profile: StoredWalletProfile,
    pin: string
  ): Promise<QuickPinUnlockResult> {
    const record = await this.getQuickPinRecord(profile.id);
    if (!record) {
      return {
        ok: false,
        reason: 'not_configured',
        remainingAttempts: 0,
        wiped: false
      };
    }

    if (!isValidMobilePin(pin)) {
      const nextFails = record.failedAttempts + 1;
      if (nextFails >= MAX_PIN_ATTEMPTS) {
        await this.disableQuickPin(profile.id);
        return { ok: false, reason: 'wiped', remainingAttempts: 0, wiped: true };
      }
      await this.store.set(
        pinKey(profile.id),
        JSON.stringify({ ...record, failedAttempts: nextFails, updatedAt: Date.now() })
      );
      return {
        ok: false,
        reason: 'wrong_pin',
        remainingAttempts: MAX_PIN_ATTEMPTS - nextFails,
        wiped: false
      };
    }

    let vaultPassword: string;
    try {
      vaultPassword =
        record.version === 2
          ? await decryptSecretScrypt(record.encryptedPassword, pin)
          : await decryptVault(record.encryptedPassword, pin);
    } catch {
      const nextFails = record.failedAttempts + 1;
      if (nextFails >= MAX_PIN_ATTEMPTS) {
        await this.disableQuickPin(profile.id);
        return { ok: false, reason: 'wiped', remainingAttempts: 0, wiped: true };
      }
      await this.store.set(
        pinKey(profile.id),
        JSON.stringify({ ...record, failedAttempts: nextFails, updatedAt: Date.now() })
      );
      return {
        ok: false,
        reason: 'wrong_pin',
        remainingAttempts: MAX_PIN_ATTEMPTS - nextFails,
        wiped: false
      };
    }

    try {
      const session = await unlockWalletProfile(profile, vaultPassword);
      if (record.version === 1) {
        try {
          const upgraded = await createPinEnvelope(vaultPassword, pin);
          await this.store.set(pinKey(profile.id), JSON.stringify(upgraded));
        } catch {
          // If the legacy PIN was weak, reset fail attempts cleanly without failing unlock
          if (record.failedAttempts !== 0) {
            await this.store.set(
              pinKey(profile.id),
              JSON.stringify({ ...record, failedAttempts: 0, updatedAt: Date.now() })
            );
          }
        }
      } else if (record.failedAttempts !== 0) {
        await this.store.set(
          pinKey(profile.id),
          JSON.stringify({ ...record, failedAttempts: 0, updatedAt: Date.now() })
        );
      }
      return { ok: true, session };
    } catch {
      await this.disableQuickPin(profile.id);
      return {
        ok: false,
        reason: 'corrupted',
        remainingAttempts: 0,
        wiped: true
      };
    }
  }
}
