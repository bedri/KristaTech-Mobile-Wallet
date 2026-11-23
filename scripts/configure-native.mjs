import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function configureAndroidManifest() {
  const manifestPath = path.join(rootDir, 'android/app/src/main/AndroidManifest.xml');
  if (!fs.existsSync(manifestPath)) {
    console.warn('[cap:configure] Skipping AndroidManifest.xml (android platform not found)');
    return;
  }

  let xml = fs.readFileSync(manifestPath, 'utf8');
  let changed = false;

  if (xml.includes('android:allowBackup="true"')) {
    xml = xml.replace('android:allowBackup="true"', 'android:allowBackup="false"');
    changed = true;
  } else if (!xml.includes('android:allowBackup="false"')) {
    xml = xml.replace('<application', '<application\n        android:allowBackup="false"');
    changed = true;
  }

  const requiredAppAttrs = [
    ['android:fullBackupContent', 'android:fullBackupContent="false"'],
    ['android:dataExtractionRules', 'android:dataExtractionRules="@xml/data_extraction_rules"'],
    ['android:networkSecurityConfig', 'android:networkSecurityConfig="@xml/network_security_config"']
  ];
  for (const [attrName, attrLine] of requiredAppAttrs) {
    if (!xml.includes(attrName)) {
      xml = xml.replace(
        'android:allowBackup="false"',
        `android:allowBackup="false"\n        ${attrLine}`
      );
      changed = true;
    }
  }

  if (!xml.includes('android.permission.CAMERA')) {
    xml = xml.replace(
      '<uses-permission android:name="android.permission.INTERNET" />',
      `<uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />`
    );
    changed = true;
  }

  if (!xml.includes('android:scheme="krista"')) {
    const schemeFilter = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="krista" />
                <data android:scheme="kristatech" />
            </intent-filter>`;
    xml = xml.replace('</activity>', `${schemeFilter}\n        </activity>`);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(manifestPath, xml, 'utf8');
    console.log('[cap:configure] Updated android/app/src/main/AndroidManifest.xml');
  } else {
    console.log('[cap:configure] AndroidManifest.xml already configured');
  }
}

function configureIosPlist() {
  const plistPath = path.join(rootDir, 'ios/App/App/Info.plist');
  if (!fs.existsSync(plistPath)) {
    console.warn('[cap:configure] Skipping Info.plist (ios platform not found)');
    return;
  }

  let plist = fs.readFileSync(plistPath, 'utf8');
  let changed = false;

  if (!plist.includes('NSCameraUsageDescription')) {
    const camEntry = `\t<key>NSCameraUsageDescription</key>
\t<string>Scan KRISTA QR codes for payment requests, addresses, and offline keys.</string>
`;
    plist = plist.replace('</dict>\n</plist>', `${camEntry}</dict>\n</plist>`);
    changed = true;
  }

  if (!plist.includes('<string>krista</string>')) {
    const urlTypesEntry = `\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>org.kristatech.wallet</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>krista</string>
\t\t\t\t<string>kristatech</string>
\t\t\t</array>
\t\t</dict>
\t</array>
`;
    plist = plist.replace('</dict>\n</plist>', `${urlTypesEntry}</dict>\n</plist>`);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(plistPath, plist, 'utf8');
    console.log('[cap:configure] Updated ios/App/App/Info.plist');
  } else {
    console.log('[cap:configure] Info.plist already configured');
  }
}

configureAndroidManifest();
configureIosPlist();
