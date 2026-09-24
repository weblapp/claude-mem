# weblapp delta

This is a **delta fork** of [`thedotmack/claude-mem`](https://github.com/thedotmack/claude-mem).
Upstream is excellent and we track it closely; this fork exists for one reason and carries as
little difference as possible so that updating stays a rebase.

**Current base: upstream `v13.25.3`** (npm `latest`, published 2026-09-21), shipped as
`13.25.3-weblapp.3`. On top of that tag sit repository configuration, the delta this file
describes, the Grok Bot cut (found after `.1` had been pushed; it went on top rather than into the
delta so the machine's marketplace clone would not have to be rebuilt from scratch a second time),
a documentation fix, the removal of upstream's slide PDFs, and the runtime half of the rename's
cost (`.3`). At the next rebase they collapse into two: repository configuration, and the delta
including the PDF removal.

## Why this fork exists

We run claude-mem as a **capturer**, not as a memory source. Our memory lives in git
(`weblapp/brain` and each repo's `.brain/`). claude-mem observes what happens on this machine and
a bridge turns its output into markdown commits.

That role only works if **nothing leaves the machine**. Measured on 2026-08-29, our own trees
carry tracked signing secrets (`key.properties`, `upload-keystore.jks` in one repo). A capturer
whose stated goal is "captures everything" must therefore have no outbound path at all — not one
that is off by default, one that does not exist.

The same role has a second condition, added 2026-09-24: **nothing speaks into a session.** The
only voice at session start is the kit's briefing; a capturer that hands its own recollections to
the model competes with the source of truth, and its recollections go stale (the first one we
caught said the CLI was 2.1.251 on the morning it became 2.1.281).

And a third, from the same day: **the capturer keeps what it concluded, not what it saw.** 13.25.3
began retaining every tool's raw input and output for good. Nothing of it leaves the machine, but
every `.env` a session reads and every command output would stay on disk with no end date, at
~33 MB a day (measured 2026-09-24: 15,873 tool results across 108 transcripts in 24 hours).

Upstream's outbound paths are opt-in and honestly documented. We are not fixing a flaw; we are
removing a possibility. Config can be flipped by accident. Code cannot.

## The delta

Every cut but one is a `WEBLAPP_*` constant at the one place its path is activated, so it replays
on a rebase and reads the same in the source and the bundle; the exception is the Read-time hook,
which is simply not declared.

| Cut | File | What upstream does | What we do |
| --- | --- | --- | --- |
| Cloud sync | `src/services/worker/DatabaseManager.ts` | Constructs `CloudSync`, and lets `SessionStore` queue outbox rows, when token + user id + hub URL are all non-empty | `WEBLAPP_CLOUD_SYNC_DISABLED` gates the predicate itself: no `CloudSync`, and no outbox rows that nothing will ever send |
| Installer funnel | `src/npx-cli/commands/install.ts` | On this base, a cmem.ai OAuth login is the first step of every install that does not name `claude` or `host`; CMEM Pro is pre-selected, and its enrollment rewrites the AI provider to the cmem gateway | `WEBLAPP_TRIAL_FUNNEL_DISABLED`: no login ever; an install that names no provider runs as `--provider claude` would |
| Telemetry | `src/services/telemetry/consent.ts` | Two independent gates, **both default ON**: `explainTelemetryConsent` returns `{enabled: true, source: 'default'}` when no `telemetry.json` decision is recorded, and `isErrorTelemetryEnabled` returns `true` when its env var is unset | `WEBLAPP_TELEMETRY_DISABLED` answers before either default is reached |
| Telegram *(new in 13.25.3)* | `src/services/integrations/telegram-transport.ts` | `CLAUDE_MEM_TELEGRAM_ENABLED` defaults to `'true'`; the notifiers stay silent only while the bot token and chat id are empty | `WEBLAPP_TELEGRAM_DISABLED` returns before the request is built; the bundle no longer contains the API host at all |
| cmem.ai gateway *(new in 13.25.3)* | `src/services/worker/OpenRouterProvider.ts` | Observations are summarised through cmem.ai whenever `CLAUDE_MEM_OPENROUTER_BASE_URL` points there, which CMEM Pro enrollment writes | `WEBLAPP_CMEM_GATEWAY_DISABLED` refuses at the single request site, by origin or by host |
| Read-time context *(new, 2026-09-24)* | `plugin/hooks/hooks.json`, `scripts/build-hooks.js` | A `PreToolUse(Read)` hook hands prior observations about the file to the model on every Read; no setting turns it off (the handler skips only subagents and excluded projects) | The hook is not declared, and the generator has no entry to fill |
| Trial pitch *(new in 13.25.3)* | `src/shared/pro-promo.ts` | `proTrialLine()` rides on the session-start banner, the per-message banner and the welcome hint an async hook can hand to the model | `WEBLAPP_PROMO_DISABLED`: the line is empty. The viewer header and the installer keep their own copy; neither speaks into a session |
| Grok Bot writers *(new since 13.17.2)* | `src/services/integrations/GrokBotAwarenessPusher.ts`, `GrokBotIndexWriter.ts` | Both ship enabled — awareness for two pilot agent ids, the INDEX for every agent (`'*'`) — and both resolve their data root by falling back to the worker's cwd when no Grok agent-data tree exists. On this machine that cwd is a product repository (measured 2026-09-24: the live worker ran from `~/Workspace/itravely`), so decision, bugfix and security lines would be written into a repo's working tree, one careless commit from leaving | `WEBLAPP_GROK_BOT_DISABLED` at the awareness entry point and at both INDEX entry points. Nothing wrote here yet: no pilot id matches our agents and no repository holds `agents/*/profile.json` |
| Raw tool payloads *(new in 13.25.3)* | `src/services/worker/http/shared.ts` | Every observed tool use is also written to a `tool_uses` table with its raw input and response, up to 64 KB each; no setting turns it off and nothing ever deletes a row | `WEBLAPP_TOOL_USES_DISABLED`: the side index stays empty. Observations still come from the `pending_messages` queue, as before |

The funnel cut matters more than it first looks: without it, a successful trial would route
**summarisation itself** through their proxy, which means conversation content, not just sync.
The gateway cut is the second lock on the same door, for a settings file that arrives already
pointing at cmem.ai.

**A correction worth recording.** A GitHub code search for `telemetry`, `analytics`, `posthog`
and `sentry` returned **zero** matches, and on that basis this file first claimed there was no
reporting to remove. That was wrong: the local clone carries a full telemetry subsystem
(`src/services/telemetry/`, ten files, ~115 KB — consent, buffering, backfill, PII scrubbing) that
posts to a public ingestion endpoint, and **its default is on**. GitHub's code index is not a
substitute for reading the tree you are about to run.

We deliberately did **not** delete `CloudSync.ts`, `CloudSyncRoutes.ts`, the Telegram notifiers
or the settings keys. `CloudSync` alone is referenced from 15 files; deleting it would break the
build and turn a one-line delta into a permanent merge conflict. A flag at the single activation
site is smaller, safer and easier to re-apply.

### The summary hook can no longer be outrun

**Added 2026-08-31 (13.17.2-weblapp.2).** Upstream declares the `Stop` hook asynchronous, so Claude
Code fires it and does not wait. That is harmless for a session that stays alive and fatal for one
that ends at Stop, which is what the nightly bridge is: a one-shot run whose process tears down
3–6 ms after the event while the hook needs ~450 ms just to start node. Across three log files,
twenty-two session-process exits carried not one summary request. The fork drops `async` and
lowers the timeout from 120 to 15 seconds, so a hung worker cannot turn every session exit into
a two-minute wait; the owner priced the blocking exit at half a second and accepted it.

### The cost of the rename: a fallback chain that pointed at nothing

**Added 2026-08-31. This is the fork's first change to the hooks, and it exists because of the
rename below, not in spite of it.**

Every hook, the Codex Windows launcher and the MCP launcher resolve the plugin root from
`$CLAUDE_PLUGIN_ROOT` (or `$PLUGIN_ROOT`), then fall back to scanning
`$_C/plugins/cache/thedotmack/claude-mem/<version>/` and `$_C/plugins/marketplaces/thedotmack/plugin`.
Upstream added that chain deliberately, in `d8eb2fa9` (#1533, 2026-04-01): *"The fallback path for
CLAUDE_PLUGIN_ROOT was pointing to the old marketplaces install location which no longer exists."*
It is load-bearing by design — `src/build/hook-shell-template.ts` says so in its header.

`thedotmack` there is the **marketplace name**, and we renamed ours. Measured 2026-08-31:

```
$ ls -d ~/.claude/plugins/cache/thedotmack ~/.claude/plugins/marketplaces/thedotmack
ls: /Users/weblapp/.claude/plugins/cache/thedotmack: No such file or directory
ls: /Users/weblapp/.claude/plugins/marketplaces/thedotmack: No such file or directory
```

Running the discovery prelude of the `UserPromptSubmit` hook standalone, with both variables
unset, on 13.17.2-weblapp.1:

```
$ env -u CLAUDE_PLUGIN_ROOT -u PLUGIN_ROOT bash discovery.sh
claude-mem: plugin scripts not found      # stderr, exit 1
```

So the whole capture chain rested on one environment variable with a backup that could not fire.
`CLAUDE_PLUGIN_ROOT` **is** set for hooks declared in a plugin's `hooks/hooks.json`, so this was
latent, not live — but it is set *only* there. Copy one of these commands into
`~/.claude/settings.json` or a project `.claude/settings.json`, or run the Codex hooks under a
host that never sets it, and the fallback is all there is.

Two changes, both in the generator (`src/build/hook-shell-template.ts`) so `npm run build` cannot
revert them:

- **`MARKETPLACE_DIRS = ['weblapp-claude-mem', 'thedotmack']`.** Both names are scanned, ours
  first, each as its own version-sorted stage. Not one merged sort: `13.17.2` sorts ahead of
  `13.17.2-weblapp.1` (release beats prerelease), so a machine carrying both would fall back to
  the build whose outbound paths this file exists to remove.
- **A discovery failure now leaves a trace on disk.** Every claude-mem log line is written by the
  worker, which lives *behind* the resolution that just failed — so the old `echo >&2; exit 1`
  left no log line and no `sdk_sessions` row, and a capturer that captured nothing looked exactly
  like a quiet day. The prelude now appends one worker-format line to
  `${CLAUDE_MEM_DATA_DIR:-$HOME/.claude-mem}/logs/claude-mem-<date>.log` before exiting. Exit
  stays **1, not 2**: on `UserPromptSubmit` exit 2 erases the user's prompt, and losing the prompt
  because the capturer is missing is the worse trade.

`scripts/verify-plugin-root-discovery.sh` checks both on the committed `HEAD`, without building or
installing anything.

**The runtime half — added 2026-09-24 (13.25.3-weblapp.3).** The generator was not the only code
that knew upstream's marketplace name. The worker-script resolver in `src/shared/worker-utils.ts`,
which every hook's lazy-spawn, the MCP server and the version check consult, read
`plugins/cache/thedotmack/claude-mem`, then `plugins/marketplaces/thedotmack/plugin`, then the
session's cwd. On this machine all three are empty, so `resolveWorkerScript()` returned `null`, and
this one was live, not latent. Measured 2026-09-24: the worker stopped at 14:28 and at 15:00
(SIGTERM; it goes when the process that spawned it goes), every hook after that logged *"Cannot
lazy-spawn worker: worker-service.cjs not found in plugin/scripts"* (447 lines between 14:29 and
16:02, none while the worker was up), and nothing was captured from 14:27 until a restart's
`SessionStart` hook, which resolves through `CLAUDE_PLUGIN_ROOT` and the generator's list, brought
it back at 16:02. `pending_messages` was empty: those hours were lost, not queued.

Three runtime sites now read the generator's `MARKETPLACE_DIRS` instead of the literal, so there is
still one list:

- `resolveWorkerScript()` stages the cache and marketplace candidates per entry, ours first. Within
  a stage upstream's highest-version rule holds; across stages it must not, for the same
  release-beats-prerelease reason as above. It takes the plugins directory as a parameter so the
  staging can be tested.
- `isPluginDisabledInClaudeSettings()` reads `claude-mem@weblapp-claude-mem`, the key Claude Code
  writes for this fork; upstream's key names a plugin this machine does not have.
- `shouldTrackProject()` leaves the plugin's own cache and marketplace directories untracked under
  both names; upstream's list named only `thedotmack`, so this fork's own directories were tracked.

`tests/weblapp-marketplace-dirs.test.ts` (ours, eight tests) fails on `.2` and passes on `.3`.

46 non-test lines still say `thedotmack`, read on 2026-09-24. `MARKETPLACE_ROOT` in `paths.ts`
keeps upstream's name: the resolver only derives the plugins directory from it, and its other
readers are installers this machine does not run. Two are latent and left alone: the MCP server's
missing-marketplace diagnostic logs only when upstream's cache exists without its marketplace,
which cannot happen here (0 lines in the day's log), and the context builder's native-rebuild
recovery deletes an install marker under upstream's marketplace, so on a native-module load
failure here the "restart to auto-fix" advice would not fix. The rest are URLs, comments, the
uninstaller and the other installers.

### Version suffix

The fork carries `-weblapp.N` on upstream's version (`13.25.3-weblapp.3`). `package.json` is the
source; `npm run build` syncs the Claude, Codex and Cursor manifests from it, and
`.claude-plugin/marketplace.json`, `.grok-plugin/plugin.json` and `openclaw/openclaw.plugin.json`
are set by hand — eleven files in all, and `git grep '"13\.25\.3"'` finds any that was missed.

This is not cosmetic. Measured 2026-08-29: after rebuilding the bundles, `claude plugin update`
answered *"already at the latest version (13.17.2)"* and kept serving the **old cached copy** —
the installed plugin still ran upstream behaviour while the repo was correct. A build that
behaves differently must not claim the same version. Bump `N` whenever the delta changes; reset it
to `.1` on a new upstream base.

### Marketplace manifest

Two more changes live in `.claude-plugin/marketplace.json`:

- **Renamed** `thedotmack` → `weblapp-claude-mem`. Installed under upstream's name, our fork is
  indistinguishable from upstream in `claude plugin marketplace list` — exactly the kind of
  ambiguity that later becomes "where did this come from?".
- **Dropped `claude-mem-cowork`.** Its own description says its hooks *"stream tool use to
  cmem.ai"*. We are not installing it, but leaving it listed means one careless
  `/plugin install` reopens everything the delta closed.

### The distribution carries no slide decks

**Added 2026-09-24, owner's call on the agent's recommendation.** `claude plugin marketplace update`
does not fetch: it re-clones the whole repository at depth 1 and swaps the clone in, every time.
On 13.25.3 that clone was 129 MB, and 117.3 MB of the 143 MB tree was eight rendered slide decks
under `plans/` (`plans/hackathon/*.pdf` and two `plans/2026-07-1*-slides.pdf`). On this machine's
link (~160 KB/s) the first update failed at the 600-second clone limit and the second took 14
minutes. Nothing references the PDFs — their Markdown sources stay — and upstream touched none of
them in the 259 commits between 13.17.2 and 13.25.3, so deleting them costs a rebase nothing.

After every rebase, drop any PDF that came back and look at the clone size before pushing:

```bash
git ls-tree -r --name-only HEAD | grep '\.pdf$'      # expect nothing
git rm -q -- $(git ls-tree -r --name-only HEAD | grep '\.pdf$')
```

## Cherry-picks ahead of upstream

None on this base. The last one, `ed2b39b4` (#3709: the Observer may no longer call `SendMessage`
or `ListAgents`, taken on 2026-09-16 after ours messaged a working session in another repository),
is part of 13.25.3 and was dropped at this rebase.

## Keeping up to date

**Rebase onto the release npm calls `latest`, never onto `upstream/main`.** Owner, 2026-09-24:
judging the fork against the last commit on `main` would mislead us. `main` carries unreleased
work (five commits past 13.25.3 on the day of this rebase); the tag is what upstream stands behind.

```bash
npm view claude-mem dist-tags                    # the release to take
git fetch upstream --tags
git worktree add -b weblapp/<ver> <dir> v<ver>   # isolated; main is untouched until the push
```

1. **Reproduce upstream's bundle before changing anything.** The repository has no root lockfile,
   so a plain `npm install` resolves whatever is newest and the rebuilt bundle drifts from the one
   upstream shipped: on 13.25.3, `worker-service.cjs` came out 465 KB smaller, because the Agent SDK
   resolved to 0.3.281 while upstream had bundled 0.3.278. Pin each bundled package to the version
   that was current when the release was published, then build the untouched tag; `git status`
   must show no tracked change. The bundles name the SDK they carry (`SDK_VERSION="…"`), and
   `npm view <pkg> time --json` gives each package's publish dates. For 13.25.3:

   ```bash
   npm install --no-save @anthropic-ai/claude-agent-sdk@0.3.278 posthog-node@5.52.5 \
     @posthog/core@1.55.1 @modelcontextprotocol/sdk@1.30.0 hono@4.13.8 dompurify@3.4.15
   npm run build && git status --short     # no tracked change = byte-identical to upstream
   ```

   Pass the pins as literal arguments. In zsh an unquoted `$PINS` does not split into words: npm
   received one argument, and it removed the Agent SDK.

2. **Record the test baseline on the untouched tag** (`bun test tests`). On 13.25.3: 3852 pass,
   28 skip, 2 fail, 1 error, all upstream's own.

3. **Replay the delta.** Repository configuration first, so the gitleaks pre-commit guards the
   delta commit. Source cuts replay with `git apply -3` where upstream left the file alone; where
   it rewrote the file (`install.ts` on this base), re-cut by hand at the new activation site. After
   any change to `src/build/hook-shell-template.ts`, regenerate the shell strings:
   `node scripts/build-hooks.js --write-shell-templates`. The build refuses a `hooks.json` whose
   strings no longer match the generator.

4. **Build and attribute every change.** With the pins still in place, any bundle that differs
   from upstream differs because of us. On 13.25.3-weblapp.2: `server-service.cjs` and
   `mcp-server.cjs` differ only in the version string (put `13.25.3` back and they are
   byte-identical); `viewer-bundle.js` and `context-generator.cjs` are unchanged;
   `worker-service.cjs` and `transcript-watcher.cjs` carry the cuts. For `.3`, built once before
   the version bump to see the change alone: `worker-service.cjs`, `mcp-server.cjs` and
   `transcript-watcher.cjs` carry the runtime half of the rename, `server-service.cjs` differs from
   `.2` only in the version string, and `hooks.json` is unchanged.

5. **Verify the cuts in the bundle, not the source.** Names are minified, so grep for behaviour:

   ```bash
   W=plugin/scripts/worker-service.cjs
   # cloud sync: our flag precedes the predicate
   grep -o '.\{40\}CLAUDE_MEM_CLOUD_SYNC_TOKEN!==""' $W      # ours: ...=!T6e&&e.CLAUDE_MEM_CLOUD_SYNC_TOKEN!==""
   # telemetry: one more early return with source:"config" than upstream has
   grep -o 'source:"config"' $W | wc -l                          # upstream 2 -> ours 3 (transcript-watcher too)
   # telegram: the host is gone from the bundle
   grep -c 'api.telegram.org' $W                                 # upstream 1 -> ours 0
   # cmem gateway: the refusal is compiled in
   grep -c 'gateway is disabled in this fork' $W                 # ours 1
   # trial pitch: the line builder is dead code
   grep -o 'fromCodePoint(10024)' $W | wc -l                     # upstream 1 -> ours 0
   # read-time context: no PreToolUse hook is declared
   jq '.hooks | has("PreToolUse")' plugin/hooks/hooks.json       # false
   # raw tool payloads: the side-index write sits behind a constant-true flag (transcript-watcher too)
   grep -oE 'if\(![A-Za-z0-9_$]+&&[a-z]\.toolUseId\)try\{[a-z]\.upsertToolUse' $W   # upstream: no guard
   # Grok Bot: all three entry points return first, each on a flag defined as !0
   grep -oE '.{60}Grok Bot INDEX notify skipped' $W             # ours: function qT(){if(!uie)try{...
   grep -oE 'async function [A-Za-z0-9_$]+\([a-z]=[A-Za-z0-9_$]+\(\),[a-z]=[A-Za-z0-9_$]+\(\),[a-z]=new Date\)\{if\([A-Za-z0-9_$]+\)return\[\]' $W
   grep -oE '\{try\{if\([A-Za-z0-9_$]+\|\|![a-z]\.enabled\)return;let [a-z]=[A-Za-z0-9_$]+\([a-z]\.agentId' $W
   # rename, runtime half: one list, read by the resolver, the settings key and the own-roots filter
   grep -o '"cache","thedotmack","claude-mem"' $W | wc -l       # .2: 1 -> ours 0
   grep -o '\["weblapp-claude-mem","thedotmack"\]' $W | wc -l    # .2: 0 -> ours 1
   grep -o 'claude-mem@\${[A-Za-z0-9_$]*\[0\]}' $W | wc -l      # .2: 0 -> ours 1 ("claude-mem@thedotmack": 1 -> 0)
   ```

   **`npm run build` is not optional, and this is the trap that nearly shipped a fake fork.** The
   marketplace installs from `./plugin`, which is *compiled output tracked in git* — our source
   patch in `src/` reaches nothing until the bundles are rebuilt. Measured 2026-08-29: after the
   first push, the installed plugin contained **zero** occurrences of our flags.

6. **Run the suite and account for every new failure.** On 13.25.3-weblapp.2: 3756 pass, 28 skip,
   98 fail, 0 error. One is upstream's own (`field deadline cancels real OpenRouter fetch`); the
   baseline's other failure is a 5-second timeout that passed on this run, and the baseline's
   error went with it. The 97 new ones are upstream tests asserting exactly what the delta
   removes, and none is unexplained:

   | Cause | Failures |
   | --- | ---: |
   | telemetry hard off (captures, rollups, consent defaults, backfill) | 61 |
   | Telegram hard off | 11 |
   | cmem gateway refused (Telegram wrap-up reuses a cmem.ai provider) | 5 |
   | version suffix (`version-consistency` expects bare `x.y.z`) | 7 |
   | hooks: the Read hook is gone and `Stop` blocks (three spawn-contract tests use the Read hook as their sample command) | 5 |
   | raw tool payloads not retained (`ingestObservation dual-write to tool_uses`) | 4 |
   | Grok Bot awareness off | 2 |
   | installer never logs in | 2 |
   | rename, runtime half (`.3`): `isPluginDisabledInClaudeSettings (#781)` disables `claude-mem@thedotmack` | 1 |

   On 13.25.3-weblapp.3: 3763 pass, 28 skip, 99 fail, 0 error across 3890 tests — the 98 failures
   of `.2` unchanged, the one row added above, and the eight tests of
   `tests/weblapp-marketplace-dirs.test.ts` passing.

   We do not edit upstream's tests to make them pass: every edited test is a conflict at the next
   rebase. The count is the check — a new failure outside this table is a regression.

7. **Commit, verify discovery, push.** `bash scripts/verify-plugin-root-discovery.sh` reads the
   committed `HEAD`, so it runs after the delta commit. Remove any PDF upstream added (see "The
   distribution carries no slide decks"). Keep the old `main` reachable before replacing it
   (`git push origin main:refs/heads/archive/<old-version>`), then
   `git push --force-with-lease=main:<old-sha> origin weblapp/<ver>:main`.

8. **Install, then restart every session.** Run `claude plugin marketplace update
   weblapp-claude-mem` with `CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS` raised (it re-clones every time),
   then `claude plugin update claude-mem@weblapp-claude-mem --scope user`. The worker does not
   switch by itself: the old version's hooks replace a version-mismatched worker on every call,
   with no guard against repeating, so every session still running the old hooks keeps pulling
   the old worker back. Restart them all, then check `curl -s 127.0.0.1:37701/api/version`. On
   2026-09-24 the switch happened at the first hook after the restart, and the migrations ran then.

**If the delta grows, that is a warning.** This fork exists to remove outbound paths and to keep a
capturer quiet, not to develop features. The six cuts added on this base are the right kind:
each is something upstream added since 13.17.2 that leaves the machine, writes where it could
leave through git, speaks into a session, or keeps raw payloads the capturer has no use for once
the observation exists. Anything else we want belongs upstream as a PR, or on our side in the bridge that writes
summaries into git.

## What we did not change

Everything else: the SQLite schema (upstream's own migrations run on the first start after an
upgrade — back up `~/.claude-mem/claude-mem.db` first; on this base they take it from 49 to 52 and
add `tool_uses` and `telegram_wrapups`, which the delta leaves empty), Chroma search, the MCP search tools
(`search` / `timeline` / `get_observations`), the worker, the viewer. Those are why we chose this
project instead of writing our own.

The hooks are upstream's except for three things recorded above: the plugin-root fallback list
and its trace on failure, the blocking `Stop` hook, and the absent `PreToolUse(Read)` hook. The
Codex hooks keep upstream's file-context entry; this machine has no Codex configuration at all
(`~/.codex` absent, 2026-09-24).

**CCS Align was read and left alone.** It ships enabled (`CLAUDE_MEM_CCS_ALIGN_ENABLED='true'`),
but it writes only under `~/.claude-mem/ccs-align/`, its patching of rule files is off by default
(`CLAUDE_MEM_CCS_ALIGN_PATCH_SHADOWS='false'`), and no code path in the worker or the hooks calls
it on 13.25.3. It reaches a session as a skill instead (`plugin/skills/ccs-align`, listed as
`claude-mem:ccs-align` once 13.25.3-weblapp.2 loaded, 2026-09-24): an hourly cycle an agent runs
only when asked, talking to the local worker over curl. Nothing schedules it. If a later release
wires it into the worker or schedules it, read it again before taking that release.
