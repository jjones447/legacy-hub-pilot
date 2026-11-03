// Source qualification fence. Tests may substitute recording fakes for fetch,
// but must never fall through to a real transport. No service is started.
// pc1-codex-5
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
const refuse = () => { throw new Error('SOURCE_QUALIFICATION_NETWORK_FORBIDDEN'); };
globalThis.fetch = refuse;
http.request = http.get = https.request = https.get = refuse;
net.connect = net.createConnection = tls.connect = refuse;
net.Socket.prototype.connect = refuse;
syncBuiltinESMExports();
