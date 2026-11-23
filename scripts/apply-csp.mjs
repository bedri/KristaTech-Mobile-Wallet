import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, '.output', 'public');

const HTML_TARGETS = ['index.html', '200.html', '404.html'];

function collectScriptHashes(html) {
  const hashes = [];
  const seen = new Set();
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptRe)) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/\btype\s*=\s*["']application\/json["']/i.test(attrs)) continue;
    if (!body) continue;
    const digest = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
    const token = `'sha256-${digest}'`;
    if (!seen.has(token)) {
      seen.add(token);
      hashes.push(token);
    }
  }
  return hashes;
}

function buildCspValue(scriptHashes) {
  const scriptSrc = ["'self'", ...scriptHashes].join(' ');
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self' wss: https: ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:*",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'"
  ].join('; ');
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function applyCspToHtml(filePath) {
  if (!fs.existsSync(filePath)) return;
  let html = fs.readFileSync(filePath, 'utf8');
  html = html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>\s*/gi, '');
  const hashes = collectScriptHashes(html);
  const csp = buildCspValue(hashes);
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}">`;
  if (html.includes('</head>')) {
    html = html.replace('</head>', `${metaTag}</head>`);
  } else {
    html = `${metaTag}${html}`;
  }
  fs.writeFileSync(filePath, html, 'utf8');
}

for (const name of HTML_TARGETS) {
  applyCspToHtml(path.join(outDir, name));
}
console.log('[CSP] Injected strict SHA-256 Content-Security-Policy meta into .output/public HTML');
