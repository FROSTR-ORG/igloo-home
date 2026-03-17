import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const repoRoot = path.resolve(process.cwd());
const localArtifactRoot = path.join(repoRoot, '.tmp-visual-artifacts');
await fs.mkdir(localArtifactRoot, { recursive: true });
const artifactDir = process.env.IGLOO_HOME_VISUAL_ARTIFACT_DIR
  ? path.resolve(process.env.IGLOO_HOME_VISUAL_ARTIFACT_DIR)
  : await fs.mkdtemp(path.join(localArtifactRoot, 'run-'));

await fs.mkdir(artifactDir, { recursive: true });

const chromeBinary = ['/snap/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find((candidate) => {
  const probe = spawnSync('bash', ['-lc', `test -x "${candidate}"`], { stdio: 'ignore' });
  return probe.status === 0;
});

if (!chromeBinary) {
  console.error('igloo-home visual smoke requires chromium or chromium-browser');
  process.exit(1);
}

const devServer = spawn('npm', ['run', 'dev'], {
  cwd: repoRoot,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const devLogPath = path.join(artifactDir, 'vite-dev.log');
devServer.stdout.on('data', (chunk) => {
  void fs.appendFile(devLogPath, chunk);
});
devServer.stderr.on('data', (chunk) => {
  void fs.appendFile(devLogPath, chunk);
});

let devExit = null;
devServer.on('exit', (code, signal) => {
  devExit = { code, signal };
});

async function waitForDevServer() {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    if (devExit) {
      throw new Error(`vite dev exited early (${devExit.code ?? 'signal'} ${devExit.signal ?? ''})`);
    }
    try {
      const response = await fetch('http://127.0.0.1:1420/');
      if (response.ok) {
        return;
      }
    } catch {}
    await sleep(500);
  }
  throw new Error('timed out waiting for Vite dev server');
}

async function cleanup() {
  try {
    process.kill(-devServer.pid, 'SIGTERM');
  } catch {}
  await sleep(300);
  try {
    process.kill(-devServer.pid, 'SIGKILL');
  } catch {}
}

process.on('exit', () => {
  try {
    process.kill(-devServer.pid, 'SIGTERM');
  } catch {}
});

const scenarios = ['landing', 'create', 'load', 'inventory', 'dashboard-signer', 'dashboard-settings'];

async function captureScenario(name) {
  const outputPath = path.join(artifactDir, `${name}.png`);
  const url = `http://127.0.0.1:1420/?__igloo_visual=${name}`;
  const capture = spawnSync(
    chromeBinary,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--window-size=1440,940',
      '--virtual-time-budget=4000',
      `--screenshot=${outputPath}`,
      url,
    ],
    { encoding: 'utf8' },
  );
  if (capture.status !== 0) {
    throw new Error(`failed to capture ${name}: ${capture.stderr || capture.stdout}`);
  }
  const identify = spawnSync('identify', ['-format', '%w %h %k', outputPath], { encoding: 'utf8' });
  if (identify.status !== 0) {
    throw new Error(`failed to inspect ${name}: ${identify.stderr || identify.stdout}`);
  }
  const [width, height, colors] = identify.stdout.trim().split(/\s+/).map(Number);
  if (width < 1000 || height < 700) {
    throw new Error(`unexpected screenshot dimensions for ${name}: ${identify.stdout.trim()}`);
  }
  if (colors < 64) {
    throw new Error(`screenshot for ${name} looks under-styled (color count ${colors})`);
  }
  return outputPath;
}

try {
  await waitForDevServer();
  const outputs = [];
  for (const scenario of scenarios) {
    outputs.push(await captureScenario(scenario));
  }
  console.log('igloo-home visual smoke passed');
  console.log(`artifacts: ${artifactDir}`);
  console.log(`screenshots: ${outputs.join(', ')}`);
} catch (error) {
  console.error(`igloo-home visual smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`artifacts: ${artifactDir}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
