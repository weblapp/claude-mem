
import { relative, isAbsolute, join, normalize } from 'path';
import { isProjectExcluded } from '../utils/project-filter.js';
import { loadFromFileOnce } from './hook-settings.js';
import {
  CLAUDE_CONFIG_DIR,
  OBSERVER_SESSIONS_DIR,
  OBSERVER_SESSIONS_PROJECT,
} from './paths.js';
import { MARKETPLACE_DIRS } from '../build/hook-shell-template.js';

const PLUGINS_DIR_NAME = 'plugins';
const PLUGIN_CACHE_DIR_NAME = 'cache';
const CLAUDE_MEM_PLUGIN_NAME = 'claude-mem';
const PLUGIN_RUNTIME_DIR_NAME = 'plugin';
// weblapp delta (DELTA.md, "The cost of the rename"): the plugin's own cache and
// marketplace directories under every name it may be installed as; upstream
// names only `thedotmack`, so this fork's own directories were being tracked.
const PLUGIN_OWN_ROOTS = MARKETPLACE_DIRS.flatMap((marketplace) => [
  join(CLAUDE_CONFIG_DIR, PLUGINS_DIR_NAME, PLUGIN_CACHE_DIR_NAME, marketplace, CLAUDE_MEM_PLUGIN_NAME),
  join(CLAUDE_CONFIG_DIR, PLUGINS_DIR_NAME, 'marketplaces', marketplace, PLUGIN_RUNTIME_DIR_NAME),
]);

function isWithin(child: string, parent: string): boolean {
  const normChild = normalize(child);
  const normParent = normalize(parent);
  if (normChild === normParent) return true;
  const rel = relative(normParent, normChild);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

export function shouldTrackProject(cwd: string): boolean {
  if (process.env.CLAUDE_MEM_INTERNAL === '1') return false;
  if (!cwd) return true;
  if (isWithin(cwd, OBSERVER_SESSIONS_DIR)) {
    return false;
  }
  if (PLUGIN_OWN_ROOTS.some((root) => isWithin(cwd, root))) {
    return false;
  }
  const settings = loadFromFileOnce();
  return !isProjectExcluded(cwd, settings.CLAUDE_MEM_EXCLUDED_PROJECTS);
}

export function shouldEmitProjectRow(project: string | null | undefined): boolean {
  if (!project) return true;
  return project !== OBSERVER_SESSIONS_PROJECT;
}
