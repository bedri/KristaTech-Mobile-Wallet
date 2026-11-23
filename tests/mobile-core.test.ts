import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HDWallet, encodeWif } from '@kristatech/sdk';
import {
  GLOSSARY_LANGUAGES,
  MOBILE_UI_TRANSLATIONS,
  sanitizeGlossaryLanguage,
  translateMobileUi,
  type MobileUiKey
} from '../app/utils/mobileI18n.ts';
import { parseIncomingMobileLink } from '../app/utils/deepLink.ts';
import {
  MAX_PIN_ATTEMPTS,
  MobileWalletStorageManager,
  createMemoryKeyValueStore,
  isValidMobilePin,
  isWeakMobilePin,
  shouldAutoLockOnResume
} from '../app/utils/mobileVault.ts';
import {
  createHdWalletProfile,
  createWatchOnlyProfile,
  restoreFromWifOrBip38Profile,
  revealWalletMnemonic,
  sanitizeEndpointsConfig,
  unlockWalletProfile
} from '../app/utils/walletCore.ts';

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('KRISTA Mobile Vault, Quick PIN, Deep-Links & 17-Language Parity', () => {
  it('encrypts vault password under 6-digit Quick PIN, resets fails on success, and wipes PIN after 5 wrong attempts', async () => {
    const kv = createMemoryKeyValueStore();
    const mgr = new MobileWalletStorageManager(kv);
    const created = await createHdWalletProfile({
      label: 'Phone Vault',
      password: 'StrongMobilePassword!9',
      network: 'mainnet',
      wordCount: 12
    });
    created.session.wipe();

    await mgr.saveProfiles([created.profile], created.profile.id);
    await mgr.enableQuickPin(created.profile, 'StrongMobilePassword!9', '482913');

    const storedRecord = await mgr.getQuickPinRecord(created.profile.id);
    assert.ok(storedRecord);
    assert.equal(storedRecord.version, 2);
    assert.equal(storedRecord.encryptedPassword.kdf, 'scrypt');
    assert.equal('mnemonic' in created.session, false);
    assert.equal(
      await revealWalletMnemonic(created.profile, 'StrongMobilePassword!9'),
      created.mnemonic
    );
    assert.equal(
      JSON.stringify(storedRecord).includes('StrongMobilePassword!9'),
      false,
      'Master vault password must never be stored in plaintext'
    );
    assert.equal(isValidMobilePin('12345'), false);
    assert.equal(isValidMobilePin('123456'), true);
    assert.equal(isWeakMobilePin('123456'), true);
    assert.equal(isWeakMobilePin('111111'), true);
    assert.equal(isWeakMobilePin('482913'), false);
    await assert.rejects(() => mgr.enableQuickPin(created.profile, 'StrongMobilePassword!9', '123456'));
    await assert.rejects(() => mgr.enableQuickPin(created.profile, 'StrongMobilePassword!9', '000000'));

    // Wrong attempt -> remaining count decrements
    const bad1 = await mgr.unlockWithQuickPin(created.profile, '000000');
    assert.equal(bad1.ok, false);
    assert.equal(bad1.remainingAttempts, MAX_PIN_ATTEMPTS - 1);
    assert.equal(bad1.wiped, false);

    // Valid PIN -> unlocks wallet and resets fail counter back to 0
    const good = await mgr.unlockWithQuickPin(created.profile, '482913');
    assert.equal(good.ok, true);
    if (good.ok) {
      assert.equal(good.session.deriveP2pkh(0).address, created.profile.publicAddresses.p2pkh[0]);
      good.session.wipe();
    }
    assert.equal((await mgr.getQuickPinRecord(created.profile.id))?.failedAttempts, 0);

    // 5 consecutive wrong PINs -> wipes PIN envelope automatically, while Vault Password still works!
    for (let attempt = 1; attempt <= MAX_PIN_ATTEMPTS; attempt++) {
      const fail = await mgr.unlockWithQuickPin(created.profile, '999999');
      assert.equal(fail.ok, false);
      if (attempt < MAX_PIN_ATTEMPTS) {
        assert.equal(fail.wiped, false);
        assert.equal(fail.remainingAttempts, MAX_PIN_ATTEMPTS - attempt);
      } else {
        assert.equal(fail.wiped, true);
        assert.equal(fail.remainingAttempts, 0);
      }
    }

    assert.equal(await mgr.hasQuickPin(created.profile.id), false);
    const fullUnlock = await unlockWalletProfile(created.profile, 'StrongMobilePassword!9');
    assert.equal(fullUnlock.deriveP2pkh(0).address, created.profile.publicAddresses.p2pkh[0]);
    fullUnlock.wipe();
  });

  it('parses krista:, krista://pay, kristatech:, and bare P2PKH / Taproot payment URIs accurately', () => {
    const hd = HDWallet.fromMnemonic(TEST_MNEMONIC, 'mainnet');
    const p2pkh = hd.deriveP2pkh(0).address;
    const taproot = hd.deriveTaproot(0).address;
    hd.wipe();

    const p1 = parseIncomingMobileLink(`krista:${p2pkh}?amount=12.5&label=Coffee`);
    assert.equal(p1.kind, 'payment');
    if (p1.kind === 'payment') {
      assert.equal(p1.address, p2pkh);
      assert.equal(p1.amountKrista, '12.5');
      assert.equal(p1.label, 'Coffee');
      assert.equal(p1.network, 'mainnet');
    }

    const p2 = parseIncomingMobileLink(`krista://pay?address=${taproot}&amount=3.25`);
    assert.equal(p2.kind, 'payment');
    if (p2.kind === 'payment') {
      assert.equal(p2.address, taproot);
      assert.equal(p2.amountKrista, '3.25');
    }

    const p3 = parseIncomingMobileLink(`kristatech://${p2pkh}?amount=1`);
    assert.equal(p3.kind, 'payment');
    if (p3.kind === 'payment') {
      assert.equal(p3.address, p2pkh);
      assert.equal(p3.amountKrista, '1');
    }

    const p4 = parseIncomingMobileLink(taproot);
    assert.equal(p4.kind, 'payment');
    if (p4.kind === 'payment') {
      assert.equal(p4.address, taproot);
      assert.equal(p4.amountKrista, undefined);
    }

    assert.equal(parseIncomingMobileLink('krista://invalid-address-123').kind, 'invalid');
    assert.equal(parseIncomingMobileLink('').kind, 'invalid');

    const testnetHd = HDWallet.fromMnemonic(TEST_MNEMONIC, 'testnet');
    const testnetAddr = testnetHd.deriveP2pkh(0).address;
    testnetHd.wipe();
    assert.equal(parseIncomingMobileLink(`krista:${testnetAddr}`, 'mainnet').kind, 'invalid');

    assert.throws(() =>
      sanitizeEndpointsConfig('mainnet', {
        electrumUrls: ['ws://evil.com:50003'],
        explorerBrowserUrl: 'https://explorer.kristalteknoloji.com'
      })
    );
    const sanitizedElectrumOnly = sanitizeEndpointsConfig('mainnet', {
      electrumUrls: ['wss://electrum.kristalteknoloji.com'],
      explorerBrowserUrl: 'https://explorer.kristalteknoloji.com'
    });
    assert.equal(sanitizedElectrumOnly.explorerUrl, undefined);
  });

  it('enforces background lock policy, watch-only xpub import, WIF import, and 17-language key parity', async () => {
    assert.equal(shouldAutoLockOnResume(1000, 1500, true, 15), true);
    assert.equal(shouldAutoLockOnResume(1000, 120_000, false, 5), false);
    assert.equal(shouldAutoLockOnResume(1000, 301_000, false, 5), true);

    const hd = HDWallet.fromMnemonic(TEST_MNEMONIC, 'mainnet');
    const xpub = hd.getAccountXpub(0, 44);
    const priv0 = hd.deriveP2pkh(0).privateKey;
    const addr0 = hd.deriveP2pkh(0).address;
    const wif = encodeWif(priv0, 'mainnet', true);
    hd.wipe();

    const watchProf = createWatchOnlyProfile({ input: xpub, network: 'mainnet' });
    assert.equal(watchProf.mode, 'watch_only');
    assert.equal(watchProf.publicAddresses.p2pkh[0], addr0);

    const wifProf = await restoreFromWifOrBip38Profile({
      keyInput: wif,
      password: 'WifMobilePass1!',
      network: 'mainnet'
    });
    assert.equal(wifProf.session.deriveP2pkh(0).address, addr0);
    wifProf.session.wipe();

    assert.equal(GLOSSARY_LANGUAGES.length, 17);
    const baseKeys = Object.keys(MOBILE_UI_TRANSLATIONS.en) as MobileUiKey[];
    for (const lang of GLOSSARY_LANGUAGES) {
      const dict = MOBILE_UI_TRANSLATIONS[lang.code];
      assert.ok(dict, `Missing locale dictionary for ${lang.code}`);
      assert.deepEqual(Object.keys(dict), baseKeys);
      for (const k of baseKeys) {
        assert.ok(dict[k].length > 0, `Empty translation for ${lang.code}.${k}`);
      }
      assert.equal(sanitizeGlossaryLanguage(lang.code), lang.code);
    }
    assert.equal(translateMobileUi('tr', 'quickPinTitle'), '6 Haneli Hızlı PIN');
  });
});
