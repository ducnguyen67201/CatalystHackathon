import { spawn, type ChildProcess } from 'node:child_process';
import { readEnvironment, readTunnelEnvironment } from '../src/server/Env.js';
import { loadEnvironmentValues, usesDoppler } from '../src/server/LoadEnvironment.js';
import { createFrontendEnvironment } from './DevelopmentEnvironment.js';

const children = new Set<ChildProcess>();
const lifecycle = { closing: false };

function isClosing(): boolean {
  return lifecycle.closing;
}

function signalChild(child: ChildProcess): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      child.kill('SIGTERM');
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    // The child may already have exited between notification and shutdown.
  }
}

function stop(): void {
  if (lifecycle.closing) {
    return;
  }
  lifecycle.closing = true;
  for (const child of children) {
    signalChild(child);
  }
}

function launch(command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env,
    detached: process.platform !== 'win32',
  });
  children.add(child);
  child.once('error', () => {
    console.error(
      'Development service failed to launch. Check Node, Docker and pnpm installation.',
    );
    process.exitCode = 1;
    stop();
  });
  child.once('exit', () => {
    children.delete(child);
  });
  return child;
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  const values = loadEnvironmentValues(process.env);
  const env = readEnvironment(values);
  const frontend = createFrontendEnvironment(values);
  const tunnel = readTunnelEnvironment(values);
  console.log(`Starting June with ${usesDoppler(values) ? 'Doppler' : 'local'} settings.`);
  const preparation = [
    {
      label: 'Starting PostgreSQL',
      command: 'docker',
      args: ['compose', 'up', '-d', '--wait', 'postgres'],
      env: frontend,
    },
    {
      label: 'Generating Prisma client',
      command: 'pnpm',
      args: ['db:generate'],
      env: { ...values },
    },
    {
      label: 'Applying pending database migrations',
      command: 'pnpm',
      args: ['db:deploy'],
      env: { ...values },
    },
  ];
  for (const step of preparation) {
    if (isClosing()) break;
    console.log(`${step.label}...`);
    const child = launch(step.command, step.args, step.env);
    const succeeded = await new Promise<boolean>((resolve) => {
      child.once('error', () => resolve(false));
      child.once('exit', (code) => resolve(code === 0));
    });
    if (!succeeded && !lifecycle.closing) {
      console.error(`${step.label} failed. Development services were not started.`);
      throw new Error('Development preparation failed.');
    }
  }
  if (!lifecycle.closing) {
    const services = [
      launch(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'watch', 'src/server/StartApi.ts'],
        { ...values },
      ),
      launch(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'watch', 'src/server/StartWorker.ts'],
        { ...values },
      ),
      launch(process.execPath, ['node_modules/vite/bin/vite.js'], frontend),
    ];
    if (tunnel.DEV_WEBHOOK_TUNNEL === 'true') {
      const relayEnvironment = {
        ...frontend,
        DEV_WEBHOOK_PORT: String(tunnel.DEV_WEBHOOK_PORT),
      };
      services.push(
        launch(
          process.execPath,
          ['node_modules/tsx/dist/cli.mjs', 'src/server/StartWebhookRelay.ts'],
          relayEnvironment,
        ),
      );
      const tunnelArgs = [
        'http',
        `http://127.0.0.1:${tunnel.DEV_WEBHOOK_PORT}`,
        '--inspect=false',
        '--log=stdout',
        '--log-format=logfmt',
      ];
      if (tunnel.DEV_WEBHOOK_URL) {
        tunnelArgs.push('--url', tunnel.DEV_WEBHOOK_URL);
      }
      services.push(
        launch('ngrok', tunnelArgs, {
          ...frontend,
          ...(tunnel.NGROK_AUTHTOKEN ? { NGROK_AUTHTOKEN: tunnel.NGROK_AUTHTOKEN } : {}),
        }),
      );
      console.log(
        'Development webhook tunnel enabled. Callback: the ngrok HTTPS URL + /api/webhooks/elevenlabs',
      );
    }
    for (const child of services) {
      child.once('exit', (code) => {
        if (!lifecycle.closing) {
          process.exitCode = code === 0 ? 1 : (code ?? 1);
          stop();
        }
      });
    }
    console.log(
      `Frontend ${env.WEB_ORIGIN}; API http://127.0.0.1:${env.API_PORT}; durable worker enabled.`,
    );
  }
} catch {
  console.error(
    'Could not start June. Check injected settings and Docker; run pnpm setup for first-time initialization.',
  );
  process.exitCode = 1;
  stop();
}
