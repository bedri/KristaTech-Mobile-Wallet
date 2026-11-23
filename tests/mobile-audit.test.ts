import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  assert.ok(buf.length >= 24, `PNG too small: ${filePath}`);
  assert.deepEqual(
    buf.subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    `Invalid PNG signature in ${filePath}`
  );
  assert.equal(buf.subarray(12, 16).toString('ascii'), 'IHDR');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20)
  };
}

describe('KRISTA Mobile PWA, Capacitor 6 Native Platforms & Store Release Audit', () => {
  it('verifies generated PWA manifest, icons (IHDR dimensions), service worker, and HTML output', () => {
    const outPublic = path.join(rootDir, '.output/public');
    assert.ok(fs.existsSync(path.join(outPublic, 'index.html')), 'Missing .output/public/index.html');
    assert.ok(fs.existsSync(path.join(outPublic, 'sw.js')), 'Missing .output/public/sw.js');

    const manifestPath = path.join(outPublic, 'manifest.webmanifest');
    assert.ok(fs.existsSync(manifestPath), 'Missing .output/public/manifest.webmanifest');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      id: string;
      display: string;
      start_url: string;
      icons: Array<{ src: string; sizes: string; purpose?: string }>;
    };
    assert.equal(manifest.id, '/');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');

    const iconChecks: Array<[string, number, number]> = [
      ['icons/icon-192.png', 192, 192],
      ['icons/icon-512.png', 512, 512],
      ['icons/icon-maskable-512.png', 512, 512],
      ['icons/apple-touch-icon-180.png', 180, 180]
    ];
    for (const [rel, expW, expH] of iconChecks) {
      const dims = readPngDimensions(path.join(outPublic, rel));
      assert.equal(dims.width, expW, `${rel} width`);
      assert.equal(dims.height, expH, `${rel} height`);
    }

    const indexHtml = fs.readFileSync(path.join(outPublic, 'index.html'), 'utf8');
    assert.match(indexHtml, /viewport-fit=cover/);
    assert.match(indexHtml, /name="color-scheme"/);
    assert.match(indexHtml, /manifest\.webmanifest/);
    const cspMatch = indexHtml.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
    assert.ok(cspMatch, 'Missing strict Content-Security-Policy meta in index.html');
    const cspContent = cspMatch[1];
    assert.match(cspContent, /script-src [^;]*'sha256-[A-Za-z0-9+/=]+'/);
    assert.doesNotMatch(cspContent, /script-src [^;]*'unsafe-inline'/);
    assert.match(cspContent, /media-src 'self' blob:/);
  });

  it('verifies Capacitor 6 AndroidManifest.xml, iOS Info.plist, synced assets, and native icons', () => {
    const capCfg = fs.readFileSync(path.join(rootDir, 'capacitor.config.ts'), 'utf8');
    assert.match(capCfg, /org\.kristatech\.wallet/);
    assert.match(capCfg, /\.output\/public/);

    const androidManifest = fs.readFileSync(
      path.join(rootDir, 'android/app/src/main/AndroidManifest.xml'),
      'utf8'
    );
    assert.match(androidManifest, /android\.permission\.CAMERA/);
    assert.match(androidManifest, /android:scheme="krista"/);
    assert.match(androidManifest, /android:scheme="kristatech"/);
    assert.match(androidManifest, /android:allowBackup="false"/);
    assert.match(androidManifest, /android:fullBackupContent="false"/);
    assert.match(androidManifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
    assert.match(androidManifest, /android:networkSecurityConfig="@xml\/network_security_config"/);

    const netSec = fs.readFileSync(
      path.join(rootDir, 'android/app/src/main/res/xml/network_security_config.xml'),
      'utf8'
    );
    assert.match(netSec, /cleartextTrafficPermitted="false"/);
    assert.ok(
      fs.existsSync(path.join(rootDir, 'android/app/src/main/res/xml/data_extraction_rules.xml')),
      'Missing Android data_extraction_rules.xml'
    );

    const mainActivity = fs.readFileSync(
      path.join(rootDir, 'android/app/src/main/java/org/kristatech/wallet/MainActivity.java'),
      'utf8'
    );
    assert.match(mainActivity, /FLAG_SECURE/);

    const buildGradle = fs.readFileSync(
      path.join(rootDir, 'android/app/build.gradle'),
      'utf8'
    );
    assert.match(buildGradle, /minifyEnabled true/);
    assert.match(buildGradle, /shrinkResources true/);

    const appDelegate = fs.readFileSync(
      path.join(rootDir, 'ios/App/App/AppDelegate.swift'),
      'utf8'
    );
    assert.match(appDelegate, /privacyOverlayView/);
    assert.match(appDelegate, /UIVisualEffectView/);

    assert.ok(
      fs.existsSync(path.join(rootDir, 'android/app/src/main/assets/public/index.html')),
      'Missing synced Android web assets'
    );
    const androidLauncherDims = readPngDimensions(
      path.join(rootDir, 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png')
    );
    assert.equal(androidLauncherDims.width, 192);
    assert.equal(androidLauncherDims.height, 192);

    const iosPlist = fs.readFileSync(path.join(rootDir, 'ios/App/App/Info.plist'), 'utf8');
    assert.match(iosPlist, /NSCameraUsageDescription/);
    assert.match(iosPlist, /<string>krista<\/string>/);
    assert.match(iosPlist, /<string>kristatech<\/string>/);

    assert.ok(
      fs.existsSync(path.join(rootDir, 'ios/App/App/public/index.html')),
      'Missing copied iOS web assets'
    );
    const iosIconDims = readPngDimensions(
      path.join(rootDir, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')
    );
    assert.equal(iosIconDims.width, 1024);
    assert.equal(iosIconDims.height, 1024);

    assert.ok(fs.existsSync(path.join(rootDir, 'MOBILE_STORE_RELEASE.md')));
  });
});
