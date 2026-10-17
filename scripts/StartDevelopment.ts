import { spawn } from 'node:child_process';
const children = [
  ['exec', 'tsx', 'watch', 'src/server/StartApi.ts'],
  ['exec', 'tsx', 'watch', 'src/server/StartWorker.ts'],
  ['exec', 'vite', '--host', '127.0.0.1'],
].map((args) => spawn('pnpm', args, { stdio: 'inherit', env: process.env }));
let closing = false;
function stop(): void {
  if (closing) {
    return;
  }
  closing = true;
  for (const child of children) {
    child.kill('SIGTERM');
  }
}
for (const child of children) {
  child.on('exit', (code) => {
    if (!closing) {
      process.exitCode = code ?? 1;
      stop();
    }
  });
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
