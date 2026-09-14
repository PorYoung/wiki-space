// Pure Yjs + ws CRDT test — simulate full CollabYDoc behavior
import * as Y from 'yjs';
import WebSocket from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { SignJWT } from 'jose';
import * as fs from 'fs';

const DOC_ID = 'test-crdt-' + Date.now();
const env = fs.readFileSync('apps/realtime/.env', 'utf8');
const secret = env.match(/JWT_SECRET=(.+)/)[1].trim();
const encSecret = new TextEncoder().encode(secret);

async function makeToken(sub, name) {
  return await new SignJWT({ sub, name })
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(encSecret);
}

// client = { doc, ws, connect() }
async function makeClient(user, name) {
  const token = await makeToken(user, name);
  const url = `ws://localhost:3001/collab?accessToken=${encodeURIComponent(token)}&doc=${DOC_ID}`;
  const ws = new WebSocket(url);
  const doc = new Y.Doc();
  let synced = false;
  let flushTimer = null;
  let pending = [];

  function flush() {
    flushTimer = null;
    if (pending.length === 0 || ws.readyState !== WebSocket.OPEN) return;
    const merged = pending.length === 1 ? pending[0] : Y.mergeUpdates(pending);
    pending = [];
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    syncProtocol.writeUpdate(enc, merged);
    ws.send(encoding.toUint8Array(enc));
  }

  function sendUpdate(update) {
    if (ws.readyState !== WebSocket.OPEN) return;
    pending.push(update);
    if (!flushTimer) flushTimer = setTimeout(flush, 150);
  }

  // ✅ THE CRITICAL WIRE: local doc update → send to server
  doc.on('update', (update, origin) => {
    if (origin === doc) return; // server echo filtered by origin
    sendUpdate(update);
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('connect timeout')), 3000);
    ws.on('open', () => {
      console.log(`[${user}] opened`);
    });
    ws.on('message', (data, isBin) => {
      if (!isBin) { console.log(`[${user}] JSON: ${String(data)}`); return; }
      const dec = decoding.createDecoder(new Uint8Array(data));
      const mt = decoding.readVarUint(dec);
      if (mt === 0) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0);
        syncProtocol.readSyncMessage(dec, enc, doc, doc); // origin=doc, so server updates don't echo
        if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
        if (!synced) {
          synced = true;
          clearTimeout(timeout);
          console.log(`[${user}] ✅ SYNCED "${doc.getText('content').toString()}"`);
          resolve();
        }
      }
    });
    ws.on('error', (e) => { clearTimeout(timeout); reject(e); });
  });

  return { doc, ws };
}

async function main() {
  console.log(`=== E2E CRDT Test doc=${DOC_ID} ===\n`);
  
  const a = await makeClient('user-A', 'UserA');
  console.log(`\n[A] writing...`);
  a.doc.transact(() => a.doc.getText('content').insert(0, 'Hello from A\n'));
  await new Promise(r => setTimeout(r, 800));

  console.log(`\n--- B joins ---`);
  const b = await makeClient('user-B', 'UserB');

  // Wait for server to broadcast A's update to B
  await new Promise(r => setTimeout(r, 500));

  const fA = a.doc.getText('content').toString();
  const fB = b.doc.getText('content').toString();
  console.log(`\n=== FINAL ===`);
  console.log(`[A]: ${JSON.stringify(fA)}`);
  console.log(`[B]: ${JSON.stringify(fB)}`);
  const ok = fA === fB && fA.includes('Hello from A');
  console.log(ok ? '✅ CRDT SYNC WORKS' : '❌ FAIL: B did not receive A content');
  
  a.ws.close(); b.ws.close();
  process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
