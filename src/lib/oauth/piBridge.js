// Written into each private session directory, so Next bundling cannot relocate the worker.
export const PI_BRIDGE_SOURCE = String.raw`
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
// SDK diagnostics must never leak credential objects into the protocol.
console.log = console.warn = console.error = () => {};
const controller = new AbortController();
let answer;
let queuedCallback;
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  try {
    const message = JSON.parse(line);
    if (message.type === 'cancel') controller.abort();
    if (message.type === 'callback') {
      if (answer) answer(message.callbackUrl);
      else queuedCallback = message.callbackUrl;
    }
  } catch { controller.abort(); }
});
input.on('close', () => controller.abort());
process.on('SIGTERM', () => controller.abort());
process.on('SIGINT', () => controller.abort());
let runtime;
try {
  const { ModelRuntime } = await import(pathToFileURL(process.argv[2]).href);
  const dir = process.env.PI_CODING_AGENT_DIR;
  runtime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null, modelsStorePath: join(dir, 'models-cache.json'), refreshOnCreate: false });
  const deviceId = randomUUID();
  await runtime.login('openai', 'oauth', {
    signal: controller.signal,
    notify(event) {
      if (event.type === 'auth_url') send({ type: 'auth_url', url: event.url });
      if (event.type === 'progress') send({ type: 'completing' });
    },
    prompt(prompt) {
      return new Promise((resolve, reject) => {
        const signal = prompt.signal || controller.signal;
        const cleanup = () => { answer = undefined; signal.removeEventListener('abort', abort); };
        const abort = () => { cleanup(); reject(new Error('Cancelled')); };
        if (signal.aborted) return abort();
        answer = value => { cleanup(); resolve(value); };
        signal.addEventListener('abort', abort, { once: true });
        send({ type: 'prompt' });
        if (queuedCallback) { const value = queuedCallback; queuedCallback = undefined; answer(value); }
      });
    },
  }, { getDeviceId: () => deviceId });
  await runtime.settleCredentialWrites();
  send({ type: 'done' });
} catch (error) {
  const message = String(error?.message || '');
  const reason = controller.signal.aborted ? 'Pi login cancelled' : message.includes('Port 1455 is in use') ? 'Port 1455 is in use; cancel other Pi or Codex logins and retry' : 'Pi login failed; check the callback URL and ensure port 1455 is available';
  send({ type: 'error', error: reason });
  process.exitCode = 1;
} finally {
  input.close();
  process.stdin.destroy();
}
`;
