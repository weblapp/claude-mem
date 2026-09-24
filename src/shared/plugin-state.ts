
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import { parseJsonWithBom } from './atomic-json.js';
import { MARKETPLACE_DIRS } from '../build/hook-shell-template.js';

// weblapp delta (DELTA.md, "The cost of the rename"): Claude Code keys a plugin
// as <plugin>@<marketplace>, and this fork's marketplace is MARKETPLACE_DIRS[0].
const PLUGIN_SETTINGS_KEY = `claude-mem@${MARKETPLACE_DIRS[0]}`;

export function isPluginDisabledInClaudeSettings(): boolean {
  try {
    const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    const settingsPath = join(claudeConfigDir, 'settings.json');
    if (!existsSync(settingsPath)) return false;
    const raw = readFileSync(settingsPath, 'utf-8');
    const settings = parseJsonWithBom<Record<string, any>>(raw);
    return settings?.enabledPlugins?.[PLUGIN_SETTINGS_KEY] === false;
  } catch (error: unknown) {
    logger.error('CONFIG', 'Failed to read Claude settings', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}
