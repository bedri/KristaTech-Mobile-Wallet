import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { HDWallet, kristaToSatoshis, satoshisToKrista } from '@kristatech/sdk';
import { ElectrumServer, loadConfigFromEnv } from '@kristatech/electrum-server';
import { parseIncomingMobileLink } from '../app/utils/deepLink.ts';
import {
  MobileWalletStorageManager,
  createMemoryKeyValueStore,
  shouldAutoLockOnResume
} from '../app/utils/mobileVault.ts';
import {
  buildUnsignedPsbtForWallet,
  createHdWalletProfile,
  createWalletTransport,
  prepareAndSignSend,
  signAndFinalizePsbtWithSession,
  syncWalletState,
  verifyTransactionSpv
} from '../app/utils/walletCore.ts';

const KRISTATECHD_BIN = '/home/bedri/Coin-Projects/KristaTech-KRISTA/src/kristatechd';
const RPC_USER = 'mobe2e';
const RPC_PASS = 'mobe2epass';

function allocatePort(host = '127.0.0.1'): Promise<{ port: number; server: net.Server }> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, host, () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind ephemeral port'));
        return;
      }
      resolve({ port: addr.port, server: srv });
    });
  });
}

async function allocateTwoFreePorts(): Promise<[number, number]> {
  const a = await allocatePort();
  const b = await allocatePort();
  await Promise.all([
    new Promise<void>((res) => a.server.close(() => res())),
    new Promise<void>((res) => b.server.close(() => res()))
  ]);
  return [a.port, b.port];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpcCall<T = unknown>(
  rpcPort: number,
  method: string,
  params: unknown[] = []
): Promise<T> {
  const auth = Buffer.from(`${RPC_USER}:${RPC_PASS}`, 'utf8').toString('base64');
  const res = await fetch(`http://127.0.0.1:${rpcPort}/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ jsonrpc: '1.0', id: method, method, params })
  });
  const body = (await res.json()) as {
    result?: T;
    error?: { code: number; message: string } | null;
  };
  if (body.error) {
    throw new Error(`RPC ${method} (${body.error.code}): ${body.error.message}`);
  }
  return body.result as T;
}

describe('KRISTA Mobile Wallet End-to-End Regtest (MobileVault/Core <-> ElectrumServer <-> kristatechd)', () => {
  let tmpDir = '';
  let rpcPort = 0;
  let daemon: ChildProcess | null = null;
  let electrum: ElectrumServer | null = null;
  let wsPort = 0;

  const rpc = <T = unknown>(method: string, params: unknown[] = []): Promise<T> =>
    rpcCall<T>(rpcPort, method, params);

  const cleanupSync = () => {
    if (daemon && daemon.exitCode === null) {
      try {
        daemon.kill('SIGKILL');
      } catch {}
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };

  before(async () => {
    assert.ok(fs.existsSync(KRISTATECHD_BIN), `Missing daemon at ${KRISTATECHD_BIN}`);
    const [p2pPort, allocRpc] = await allocateTwoFreePorts();
    rpcPort = allocRpc;
    tmpDir = fs.mkdtempSync(path.join('/tmp', 'krista-mobile-e2e-'));
    const nodeDir = path.join(tmpDir, 'node');
    fs.mkdirSync(nodeDir, { recursive: true });
    fs.writeFileSync(path.join(nodeDir, 'kristatech.conf'), '', 'utf8');

    process.on('exit', cleanupSync);

    daemon = spawn(
      KRISTATECHD_BIN,
      [
        '-regtest',
        `-datadir=${nodeDir}`,
        '-server=1',
        '-listen=0',
        '-txindex=1',
        `-port=${p2pPort}`,
        `-rpcport=${rpcPort}`,
        '-rpcbind=127.0.0.1',
        '-rpcallowip=127.0.0.1',
        `-rpcuser=${RPC_USER}`,
        `-rpcpassword=${RPC_PASS}`,
        '-fallbackfee=0.0001',
        '-printtoconsole=0'
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );

    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const info = await rpc<{ chain: string }>('getblockchaininfo');
        if (info.chain === 'regtest') {
          ready = true;
          break;
        }
      } catch {}
      await sleep(200);
    }
    assert.ok(ready, 'Timed out waiting for regtest kristatechd');

    await rpc('generate', [110]);

    const config = loadConfigFromEnv({
      KRISTA_NETWORK: 'regtest',
      KRISTA_RPC_URL: `http://127.0.0.1:${rpcPort}/`,
      KRISTA_RPC_USER: RPC_USER,
      KRISTA_RPC_PASS: RPC_PASS,
      ELECTRUM_DB_PATH: path.join(tmpDir, 'electrum.sqlite'),
      ELECTRUM_TCP_PORT: '0',
      ELECTRUM_WS_PORT: '0',
      ELECTRUM_POLL_MS: '500'
    });
    electrum = new ElectrumServer(config);
    const addrs = await electrum.start({ initialSync: true, startPoll: false });
    wsPort = addrs.wsPort!;
  });

  after(async () => {
    process.removeListener('exit', cleanupSync);
    if (electrum) {
      await electrum.close();
      electrum = null;
    }
    if (daemon && daemon.exitCode === null) {
      try {
        await rpc('stop');
      } catch {}
      const deadline = Date.now() + 10_000;
      while (daemon.exitCode === null && Date.now() < deadline) {
        await sleep(100);
      }
      if (daemon.exitCode === null) daemon.kill('SIGKILL');
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runs complete mobile wallet flow: Quick PIN cold unlock -> PoL protection -> deep-link payment + SPV -> PSBT -> background lock', async () => {
    const kv = createMemoryKeyValueStore();
    const mgr = new MobileWalletStorageManager(kv);

    const created = await createHdWalletProfile({
      label: 'Mobile Regtest',
      password: 'MobRegtestPassword!7',
      network: 'regtest',
      wordCount: 12,
      endpoints: {
        electrumUrls: [`ws://127.0.0.1:${wsPort}`],
        explorerBrowserUrl: ''
      }
    });
    created.session.wipe();

    await mgr.saveProfiles([created.profile], created.profile.id);
    await mgr.enableQuickPin(created.profile, 'MobRegtestPassword!7', '654321');

    // Simulate cold mobile app launch & Quick PIN unlock
    const mgrCold = new MobileWalletStorageManager(kv);
    const loadedProfiles = await mgrCold.loadProfiles();
    assert.equal(loadedProfiles.length, 1);
    const prof = loadedProfiles[0]!;
    const pinUnlock = await mgrCold.unlockWithQuickPin(prof, '654321');
    assert.equal(pinUnlock.ok, true);
    assert.ok(pinUnlock.ok);
    const session = pinUnlock.session;

    const p2pkhAddr = prof.publicAddresses.p2pkh[0]!;
    const bundle = createWalletTransport('regtest', prof.endpoints);

    try {
      // 1) Fund mobile wallet + create PoL CLTV locked output
      await rpc('sendtoaddress', [p2pkhAddr, 40]);
      await rpc('generate', [1]);
      await electrum!.syncOnce();

      const snap1 = await syncWalletState(bundle.transport, [p2pkhAddr], 'regtest');
      assert.equal(snap1.spendableSatoshis, kristaToSatoshis('40'));

      const lockSend = prepareAndSignSend({
        network: 'regtest',
        session,
        utxos: snap1.utxos,
        recipientInput: p2pkhAddr,
        amountStr: '12',
        changeAddress: p2pkhAddr,
        currentHeight: snap1.tip.height,
        lockHeight: snap1.tip.height + 6,
        receiveCount: prof.receiveCount,
        taprootCount: prof.taprootCount
      });
      await bundle.transport.broadcastTransaction(lockSend.signed.hex);
      await rpc('generate', [1]);
      await electrum!.syncOnce();

      const snapLocked = await syncWalletState(bundle.transport, [p2pkhAddr], 'regtest');
      assert.equal(snapLocked.lockedSatoshis, kristaToSatoshis('12'));
      assert.ok(snapLocked.spendableSatoshis > kristaToSatoshis('27'));

      // 2) Parse incoming `krista:` deep-link payment request -> pay cleanly without touching locked UTXO + verify SPV
      const external = HDWallet.fromMnemonic(created.mnemonic, 'regtest');
      const receiver = external.deriveTaproot(4).address;
      external.wipe();

      const deepLink = parseIncomingMobileLink(`krista:${receiver}?amount=8.5&label=Espresso`, 'regtest');
      assert.equal(deepLink.kind, 'payment');
      assert.ok(deepLink.kind === 'payment');

      const sendFromLink = prepareAndSignSend({
        network: 'regtest',
        session,
        utxos: snapLocked.utxos,
        recipientInput: deepLink.address,
        amountStr: deepLink.amountKrista,
        changeAddress: p2pkhAddr,
        currentHeight: snapLocked.tip.height,
        receiveCount: prof.receiveCount,
        taprootCount: prof.taprootCount
      });
      const sentTxid = await bundle.transport.broadcastTransaction(sendFromLink.signed.hex);
      assert.equal(sentTxid.length, 64);

      await rpc('generate', [1]);
      await electrum!.syncOnce();

      const spv = await verifyTransactionSpv(bundle, sentTxid);
      assert.equal(spv.verified, true);
      assert.ok(spv.blockHeight >= 113);

      // 3) Build unsigned PSBT -> sign & finalize -> broadcast -> SPV check
      const snapPrePsbt = await syncWalletState(bundle.transport, [p2pkhAddr], 'regtest');
      const unsigned = buildUnsignedPsbtForWallet({
        network: 'regtest',
        utxos: snapPrePsbt.utxos,
        recipientInput: receiver,
        amountStr: satoshisToKrista(kristaToSatoshis('4')),
        changeAddress: p2pkhAddr,
        currentHeight: snapPrePsbt.tip.height
      });
      const signedPsbt = signAndFinalizePsbtWithSession(
        unsigned.psbtBase64,
        session,
        prof.receiveCount,
        prof.taprootCount
      );
      assert.equal(signedPsbt.finalized, true);
      assert.ok(signedPsbt.rawHex);

      const psbtTxid = await bundle.transport.broadcastTransaction(signedPsbt.rawHex);
      await rpc('generate', [1]);
      await electrum!.syncOnce();
      assert.equal((await verifyTransactionSpv(bundle, psbtTxid)).verified, true);

      // 4) Background auto-lock check & wipe session
      assert.equal(shouldAutoLockOnResume(Date.now(), Date.now() + 1000, true, 5), true);
      session.wipe();
      assert.throws(() => session.deriveP2pkh(0));
    } finally {
      await bundle.close();
    }
  });
});
