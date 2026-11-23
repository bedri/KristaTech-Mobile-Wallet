# KRISTA Mobile Wallet — App Store, Google Play & PWA Release Checklist

> Last Updated: 2026-11-22  
> Package ID: `org.kristatech.wallet` · Version: `0.1.0`

---

## 1. Web / Mobile PWA Hosting Release

1. Build static output:
   ```bash
   npm run assets && npm run typecheck && npm run generate
   ```
2. Serve `.output/public/` over **HTTPS** with these required headers:
   - `/manifest.webmanifest` -> `Content-Type: application/manifest+json; charset=utf-8`
   - `/sw.js` -> `Cache-Control: no-cache`
3. Verify icons (`192x192`, `512x512`, `maskable 512x512`, `180x180` Apple Touch Icon) and `/manifest.webmanifest` `"id": "/"`.

---

## 2. Google Play (Android / Capacitor 6)

### Prerequisites on Build Workstation
- Android SDK + JDK 17 (`JAVA_HOME` configured) + Android Studio / Gradle.
- Run asset generation and Capacitor Android sync:
  ```bash
  npm run assets
  npm run typecheck
  npm run generate
  npm run cap:configure
  npm run cap:sync:android
  ```
- Verified in [`android/app/src/main/AndroidManifest.xml`](android/app/src/main/AndroidManifest.xml):
  - `android.permission.CAMERA` (for live QR scanning)
  - `<intent-filter>` handling `krista://` and `kristatech://` payment links (`ACTION_VIEW` + `BROWSABLE`)
  - Adaptive & legacy mipmaps in `android/app/src/main/res/mipmap-*`

### Release Bundle (.aab)
1. Open `android/` in Android Studio (`npx cap open android`) or configure `keystore.properties` in `android/` for release signing.
2. Build signed App Bundle:
   ```bash
   cd android && ./gradlew bundleRelease
   ```
3. Google Play Data Safety & Review Declarations:
   - **Wallet Model:** Strictly non-custodial. Seed phrases, WIF private keys, and AES-GCM encrypted vaults never leave the user's device.
   - **Camera Rationale:** Used exclusively for scanning payment request QR codes and paper backup QR codes; zero photos stored or transmitted.
   - **Data Collection:** No telemetry, analytics SDKs, or cloud key escrow.

---

## 3. Apple App Store (iOS / Capacitor 6)

### Prerequisites on macOS Build Machine
- Xcode 15+ and CocoaPods (`pod install`).
- Sync static assets & plist permissions from this repository:
  ```bash
  npm run generate
  npm run cap:configure
  npm run cap:copy:ios
  npx cap sync ios
  ```
- Verified in [`ios/App/App/Info.plist`](ios/App/App/Info.plist):
  - `NSCameraUsageDescription`: Clear explanation for KRISTA QR code scanning.
  - `CFBundleURLTypes`: Registers `krista` and `kristatech` URL schemes under `org.kristatech.wallet`.
  - AppIcon `1024x1024` in `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`.

### App Store Connect Notes
- Set Apple Developer Signing Team in `ios/App/App.xcodeproj`.
- **Export Compliance:** Uses standard OS TLS and local WebCrypto AES-GCM/PBKDF2 only (`ITSAppUsesNonExemptEncryption` declaration per App Store rules).
- **Optional Future Enhancement:** Biometric FaceID/TouchID wrapper (`@aparajita/capacitor-biometric-auth`) can unlock the encrypted Quick PIN envelope without changing core vault cryptography.

---

## 4. Public Privacy Policy Requirement

Before submitting to Google Play or Apple App Store, publish the public privacy policy page at:
- `https://kristatech.org/privacy/mobile-wallet`
