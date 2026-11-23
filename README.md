# KRISTA Mobile Wallet (`@kristatech/mobile-wallet`)

Non-custodial mobile and Progressive Web App (PWA) light wallet for **KristaTech (KRISTA)** built with **Capacitor 6 + Nuxt 4 + Vue 3.5 + TypeScript + Tailwind CSS v4** and powered by `@kristatech/sdk`.

## Features

- **Zero-Sync SPV & Electrum Client:** Fast Electrum WebSocket + Explorer REST failover with Merkle branch SPV verification.
- **Native Capacitor 6 Bridge (`org.kristatech.wallet`):**
  - Persistent Preferences storage (`@capacitor/preferences`) with `localStorage` PWA fallback
  - StatusBar dark/light tinting, SplashScreen control, Keyboard resize awareness, Network connectivity listener, Native Haptics, Clipboard, and Native Share sheet (`@capacitor/share`)
  - OS Deep-Link handling (`krista:` and `kristatech:` payment URIs via `App.appUrlOpen`)
- **6-Digit Quick PIN + Instant Background Auto-Lock:** Encrypts only the master vault password using AES-256-GCM + PBKDF2 keyed by a 6-digit PIN; auto-wipes the PIN envelope after 5 wrong attempts and falls back to Vault Password.
- **Built-In QR Camera Scanner:** Live camera QR decoding (`BarcodeDetector` + `jsQR`) plus offline QR image upload decoding.
- **PoL Coin-Lock Protection & Taproot:** Clear spendable vs PoL-locked vs immature balance separation, `KT...` P2PKH and `kt1p...` Taproot/MESCAL addresses, BIP174 PSBT tools, and BIP38 cold paper-key encryption/decryption.
- **17-Language UI & Plain-Language Glossary:** Localized across all 17 KRISTA glossary languages (`tr, en, de, es, fr, it, nl, pt, pl, ru, zh, ja, ko, sv, no, da, hr`).

## Development & Build Commands

```bash
# Local PWA dev server on 127.0.0.1:27811
npm run dev

# Regenerate PWA, Android mipmap, and iOS icon PNGs
npm run assets

# Typecheck & generate static PWA bundle into .output/public
npm run typecheck
npm run generate

# Patch native manifests/plists and sync web assets to Android/iOS projects
npm run cap:prepare

# Unit/security tests + Real kristatechd regtest & Electrum E2E test
npm test
npm run test:e2e
```
