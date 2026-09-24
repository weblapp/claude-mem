import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveWorkerScript } from '../src/shared/worker-utils.js';
import { isPluginDisabledInClaudeSettings } from '../src/shared/plugin-state.js';
import { shouldTrackProject } from '../src/shared/should-track-project.js';
import { CLAUDE_CONFIG_DIR } from '../src/shared/paths.js';

// weblapp delta (DELTA.md, "The cost of the rename"). This fork installs as
// claude-mem@weblapp-claude-mem, so every runtime path derived from upstream's
// marketplace name, thedotmack, points at a directory that does not exist here.
// Measured 2026-09-24: the hooks' lazy-spawn could not find worker-service.cjs,
// the worker stayed down from 15:00 to 16:02, and nothing was captured.

const tmpRoots: string[] = [];

afterAll(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
});

function makePluginsDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'claude-mem-plugins-'));
  tmpRoots.push(root);
  return root;
}

function installCacheVersion(pluginsDir: string, marketplace: string, version: string): string {
  const scripts = join(pluginsDir, 'cache', marketplace, 'claude-mem', version, 'scripts');
  mkdirSync(scripts, { recursive: true });
  const scriptPath = join(scripts, 'worker-service.cjs');
  writeFileSync(scriptPath, '// fake worker\n');
  return scriptPath;
}

describe('resolveWorkerScript under the fork marketplace', () => {
  let savedOverride: string | undefined;

  beforeEach(() => {
    savedOverride = process.env.CLAUDE_MEM_WORKER_SCRIPT_PATH;
    delete process.env.CLAUDE_MEM_WORKER_SCRIPT_PATH;
  });

  afterEach(() => {
    if (savedOverride === undefined) delete process.env.CLAUDE_MEM_WORKER_SCRIPT_PATH;
    else process.env.CLAUDE_MEM_WORKER_SCRIPT_PATH = savedOverride;
  });

  test('finds the worker in the weblapp-claude-mem cache', () => {
    const plugins = makePluginsDir();
    const ours = installCacheVersion(plugins, 'weblapp-claude-mem', '13.25.3-weblapp.3');
    expect(resolveWorkerScript(plugins)).toEqual({ scriptPath: ours, version: '13.25.3-weblapp.3' });
  });

  test('prefers our marketplace over a higher upstream release', () => {
    const plugins = makePluginsDir();
    const ours = installCacheVersion(plugins, 'weblapp-claude-mem', '13.25.3-weblapp.3');
    installCacheVersion(plugins, 'thedotmack', '99.0.0');
    expect(resolveWorkerScript(plugins)?.scriptPath).toBe(ours);
  });

  test('still falls back to upstream when ours is absent', () => {
    const plugins = makePluginsDir();
    const upstream = installCacheVersion(plugins, 'thedotmack', '13.25.3');
    expect(resolveWorkerScript(plugins)?.scriptPath).toBe(upstream);
  });
});

describe('isPluginDisabledInClaudeSettings reads our plugin key', () => {
  let savedConfigDir: string | undefined;

  beforeEach(() => {
    savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
  });

  afterEach(() => {
    if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
  });

  function withSettings(enabledPlugins: Record<string, boolean>): void {
    const dir = makePluginsDir();
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ enabledPlugins }));
    process.env.CLAUDE_CONFIG_DIR = dir;
  }

  test('claude-mem@weblapp-claude-mem set to false disables the plugin', () => {
    withSettings({ 'claude-mem@weblapp-claude-mem': false });
    expect(isPluginDisabledInClaudeSettings()).toBe(true);
  });

  test("upstream's key does not disable this fork", () => {
    withSettings({ 'claude-mem@thedotmack': false, 'claude-mem@weblapp-claude-mem': true });
    expect(isPluginDisabledInClaudeSettings()).toBe(false);
  });
});

describe("shouldTrackProject ignores the plugin's own directories", () => {
  test('a cwd inside the weblapp-claude-mem cache is not tracked', () => {
    const cwd = join(CLAUDE_CONFIG_DIR, 'plugins', 'cache', 'weblapp-claude-mem', 'claude-mem', '13.25.3-weblapp.3', 'scripts');
    expect(shouldTrackProject(cwd)).toBe(false);
  });

  test('a cwd inside the weblapp-claude-mem marketplace clone is not tracked', () => {
    const cwd = join(CLAUDE_CONFIG_DIR, 'plugins', 'marketplaces', 'weblapp-claude-mem', 'plugin', 'scripts');
    expect(shouldTrackProject(cwd)).toBe(false);
  });

  test("upstream's directories stay ignored too", () => {
    const cwd = join(CLAUDE_CONFIG_DIR, 'plugins', 'cache', 'thedotmack', 'claude-mem', '13.25.3', 'scripts');
    expect(shouldTrackProject(cwd)).toBe(false);
  });
});
