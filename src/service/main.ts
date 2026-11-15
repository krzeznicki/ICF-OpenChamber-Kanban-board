// Entry of the built `service/main.js`: the HTTP shell around `handle`.
// OpenChamber starts it with OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN; every request,
// /health included, carries `Authorization: Bearer <token>`. It listens on 127.0.0.1 only and never
// writes inside its own package folder (a write there makes OpenChamber reload the extension).
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServiceHost } from '@openchamber/sdk';
import { realExec } from '../core/exec.ts';
import { publishInstructions } from './instructions.ts';
import { defaultCliPath, handle, type Deps } from './routes.ts';

const MAX_BODY = 1024 * 1024;

const token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? '';
const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
if (token === '' || !Number.isInteger(port) || port <= 0) {
  console.error('icf-kanban service: OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required');
  process.exit(1);
}
const expected = Buffer.from(`Bearer ${token}`);
// The way back into OpenChamber (contributes.sessionControl): path B session starts and the live
// status of linked sessions (the queue's running count).
const host = createServiceHost({ env: process.env });
const deps: Deps = {
  exec: realExec,
  sessions: { start: (input) => host.sessions.start(input), status: async (id) => (await host.sessions.status(id)).status },
};

const authorized = (req: IncomingMessage): boolean => {
  const got = Buffer.from(req.headers.authorization ?? '');
  return got.length === expected.length && timingSafeEqual(got, expected);
};

const send = (res: ServerResponse, status: number, json: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(json));
};

class TooLarge extends Error {}

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new TooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const server = createServer((req, res) => {
  void (async () => {
    if (!authorized(req)) {
      res.writeHead(401).end();
      return;
    }
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    let body: unknown;
    try {
      const text = await readBody(req);
      body = text.trim() === '' ? undefined : JSON.parse(text);
    } catch (e) {
      if (e instanceof TooLarge) send(res, 413, { error: { code: 'INVALID', message: 'Request body is too large' } });
      else send(res, 400, { error: { code: 'INVALID', message: 'Request body is not valid JSON' } });
      return;
    }
    const reply = await handle(req.method ?? 'GET', path, body, deps);
    send(res, reply.status, reply.json);
    // Session events are answered first (OpenChamber waits at most 10 s), then drained.
    await reply.after?.().catch((e: unknown) => console.error(`icf-kanban: ${e instanceof Error ? e.message : String(e)}`));
  })().catch((e: unknown) => {
    if (!res.headersSent) send(res, 500, { error: { code: 'FAILED', message: e instanceof Error ? e.message : String(e) } });
    else res.destroy();
  });
});

server.listen(port, '127.0.0.1');

// Once per start: every agent session learns where the task-board CLI is (contributes.instructions).
void publishInstructions(host, defaultCliPath());

const stop = (): void => {
  server.close(() => process.exit(0));
  server.closeAllConnections();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
