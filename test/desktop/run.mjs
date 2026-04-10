import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const repoRoot = path.resolve(process.cwd());
const fixtureRoot = process.env.FROSTR_TEST_HARNESS_DIR
  ? path.resolve(process.env.FROSTR_TEST_HARNESS_DIR)
  : path.resolve(repoRoot, '../../.tmp/test-harness');
const fixtureDir = path.join(fixtureRoot, 'demo-2of3');

if (!process.env.IGLOO_HOME_RUN_DESKTOP_TESTS) {
  console.log(
    'igloo-home desktop tests skipped (set IGLOO_HOME_RUN_DESKTOP_TESTS=1 for live desktop smoke, or use npm run test:desktop:xvfb)',
  );
  process.exit(0);
}

if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.error('desktop smoke requires DISPLAY or WAYLAND_DISPLAY (or run npm run test:desktop:xvfb)');
  process.exit(1);
}

for (const command of ['import', 'identify', 'xwininfo']) {
  const probe = spawnSync('bash', ['-lc', `command -v ${command}`], { stdio: 'ignore' });
  if (probe.status !== 0) {
    console.error(`desktop smoke requires '${command}' to be installed`);
    process.exit(1);
  }
}

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'igloo-home-desktop-'));
const artifactDir = process.env.IGLOO_HOME_DESKTOP_ARTIFACT_DIR
  ? path.resolve(process.env.IGLOO_HOME_DESKTOP_ARTIFACT_DIR)
  : path.join(rootDir, 'artifacts');
await fs.mkdir(artifactDir, { recursive: true });

const testPort = Number(process.env.IGLOO_HOME_TEST_PORT ?? `${19000 + Math.floor(Math.random() * 1000)}`);
const devLogPath = path.join(artifactDir, 'vite-dev.log');
const appLogPath = path.join(artifactDir, 'app.log');
const devServer = spawn('npm', ['run', 'dev'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    IGLOO_HOME_TEST_MODE: '1',
    IGLOO_HOME_TEST_SHOW_WINDOW: '1',
    IGLOO_HOME_TEST_PORT: String(testPort),
    IGLOO_HOME_TEST_ROOT: rootDir,
    IGLOO_HOME_TEST_APP_DATA_DIR: path.join(rootDir, 'app-data'),
  },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
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

let appProcess = null;
let appExit = null;
function startAppProcess() {
  appProcess = spawn(
    'cargo',
    ['run', '--manifest-path', 'src-tauri/Cargo.toml', '--no-default-features', '--color', 'always', '--'],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        IGLOO_HOME_TEST_MODE: '1',
        IGLOO_HOME_TEST_SHOW_WINDOW: '1',
        IGLOO_HOME_TEST_PORT: String(testPort),
        IGLOO_HOME_TEST_ROOT: rootDir,
        IGLOO_HOME_TEST_APP_DATA_DIR: path.join(rootDir, 'app-data'),
      },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  appProcess.stdout.on('data', (chunk) => {
    void fs.appendFile(appLogPath, chunk);
  });
  appProcess.stderr.on('data', (chunk) => {
    void fs.appendFile(appLogPath, chunk);
  });
  appProcess.on('exit', (code, signal) => {
    appExit = { code, signal };
  });
}

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
    if (appProcess) {
      process.kill(-appProcess.pid, 'SIGTERM');
    }
  } catch {}
  try {
    process.kill(-devServer.pid, 'SIGTERM');
  } catch {}
  await sleep(500);
  try {
    if (appProcess) {
      process.kill(-appProcess.pid, 'SIGKILL');
    }
  } catch {}
  try {
    process.kill(-devServer.pid, 'SIGKILL');
  } catch {}
}

process.on('exit', () => {
  try {
    if (appProcess) {
      process.kill(-appProcess.pid, 'SIGTERM');
    }
  } catch {}
  try {
    process.kill(-devServer.pid, 'SIGTERM');
  } catch {}
});

async function sendRequest(command, input = {}) {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: testPort });
    let buffer = '';
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({
        request_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        command,
        input,
      })}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      try {
        const response = JSON.parse(line);
        socket.end();
        if (!response.ok) {
          reject(new Error(response.error ?? `request failed: ${command}`));
          return;
        }
        resolve(response.result);
      } catch (error) {
        reject(error);
      }
    });
    socket.on('error', reject);
  });
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    if (appExit) {
      throw new Error(`igloo-home app exited early (${appExit.code ?? 'signal'} ${appExit.signal ?? ''})`);
    }
    try {
      await sendRequest('health');
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error('timed out waiting for igloo-home test server health');
}

async function waitForWindowId() {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    if (appExit) {
      throw new Error(`igloo-home app exited before window became ready (${appExit.code ?? 'signal'} ${appExit.signal ?? ''})`);
    }
    const exact = spawnSync('xwininfo', ['-name', 'Igloo Home'], { encoding: 'utf8' });
    if (exact.status === 0) {
      const match = exact.stdout.match(/Window id:\s+(\S+)/);
      if (match) return match[1];
    }
    const tree = spawnSync('xwininfo', ['-root', '-tree'], { encoding: 'utf8' });
    if (tree.status === 0) {
      const line = tree.stdout
        .split('\n')
        .find((entry) => /Igloo Home|igloo-home/i.test(entry));
      if (line) {
        const match = line.match(/(0x[0-9a-fA-F]+)/);
        if (match) return match[1];
      }
    }
    await sleep(500);
  }
  console.warn('did not find a named Igloo Home X11 window; falling back to root capture');
  return 'root';
}

async function captureWindow(windowId, name) {
  const outputPath = path.join(artifactDir, `${name}.png`);
  const capture = spawnSync('import', ['-window', windowId, outputPath], { encoding: 'utf8' });
  if (capture.status !== 0) {
    throw new Error(`failed to capture screenshot '${name}': ${capture.stderr || capture.stdout}`);
  }
  const stats = await fs.stat(outputPath);
  const identify = spawnSync('identify', ['-format', '%w %h %k', outputPath], { encoding: 'utf8' });
  if (identify.status !== 0) {
    throw new Error(`failed to inspect screenshot '${name}': ${identify.stderr || identify.stdout}`);
  }
  const [width, height, colors] = identify.stdout.trim().split(/\s+/).map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1000 || height < 700) {
    throw new Error(`screenshot '${name}' has unexpected dimensions: ${identify.stdout.trim()}`);
  }
  if (!Number.isFinite(colors) || colors < 32) {
    throw new Error(`screenshot '${name}' looks under-styled (color count ${colors})`);
  }
  if (stats.size < 35_000) {
    throw new Error(`screenshot '${name}' is unexpectedly small (${stats.size} bytes)`);
  }
  return outputPath;
}

try {
  await waitForDevServer();
  startAppProcess();
  await waitForHealth();
  const windowId = await waitForWindowId();
  await sleep(1500);

  const landingShot = await captureWindow(windowId, 'landing');

  const groupPackageJson = await fs.readFile(path.join(fixtureDir, 'group.json'), 'utf8');
  const sharePackageJson = await fs.readFile(path.join(fixtureDir, 'share-bob.json'), 'utf8');
  const importResult = await sendRequest('import_profile_from_raw', {
    label: 'Desktop Smoke Bob',
    relay_profile: null,
    relay_urls: ['ws://127.0.0.1:8194'],
    passphrase: 'desktop-smoke-pass',
    group_package_json: groupPackageJson,
    share_package_json: sharePackageJson,
  });

  if (importResult?.status !== 'profile_created' || !importResult.profile?.id) {
    throw new Error(`unexpected import result: ${JSON.stringify(importResult)}`);
  }

  await sendRequest('navigate_view', {
    view: 'dashboard',
    profile_id: importResult.profile.id,
    signer_tab: 'signer',
  });
  await sleep(1200);
  const signerShot = await captureWindow(windowId, 'signer-view');

  console.log(`igloo-home desktop smoke passed`);
  console.log(`artifacts: ${artifactDir}`);
  console.log(`screenshots: ${landingShot}, ${signerShot}`);
} catch (error) {
  console.error(`igloo-home desktop smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`artifacts: ${artifactDir}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
