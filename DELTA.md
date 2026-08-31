# weblapp delta

This is a **delta fork** of [`thedotmack/claude-mem`](https://github.com/thedotmack/claude-mem).
Upstream is excellent and we track it closely; this fork exists for one reason and carries as
little difference as possible so that updating stays a rebase.

## Why this fork exists

We run claude-mem as a **capturer**, not as a memory source. Our memory lives in git
(`weblapp/brain` and each repo's `.brain/`). claude-mem observes what happens on this machine and
a bridge turns its output into markdown commits.

That role only works if **nothing leaves the machine**. Measured on 2026-08-29, our own trees
carry tracked signing secrets (`key.properties`, `upload-keystore.jks` in one repo). A capturer
whose stated goal is "captures everything" must therefore have no outbound path at all — not one
that is off by default, one that does not exist.

Upstream's outbound paths are opt-in and honestly documented. We are not fixing a flaw; we are
removing a possibility. Config can be flipped by accident. Code cannot.

## The delta (3 files, ~30 lines)

| Cut | File | What upstream does | What we do |
| --- | --- | --- | --- |
| Cloud sync | `src/services/worker/DatabaseManager.ts` | Constructs `CloudSync` when token + user id + hub URL are all non-empty | `WEBLAPP_CLOUD_SYNC_DISABLED = true` short-circuits the condition, so `CloudSync` is never constructed and every `getCloudSync()?.notify()` stays a no-op |
| Trial funnel | `src/npx-cli/commands/install.ts` | First interaction of the install: an email POSTs to `cmem.ai`, an account is created server-side, and on success the AI provider is rewritten to `CMEM_PRO_BASE_URL` | `WEBLAPP_TRIAL_FUNNEL_DISABLED = true` forces `trialPairing` to `null`, so nothing is asked, nothing is posted, and the provider stays local |
| Telemetry | `src/services/telemetry/consent.ts` | Two independent gates, **both default ON**: `explainTelemetryConsent` returns `{enabled: true, source: 'default'}` when no `telemetry.json` decision is recorded, and `isErrorTelemetryEnabled` returns `true` when its env var is unset | `WEBLAPP_TELEMETRY_DISABLED = true` answers before either default is reached |

The second cut matters more than it first looks: without it, a successful trial would route
**summarisation itself** through their proxy, which means conversation content, not just sync.

**A correction worth recording.** A GitHub code search for `telemetry`, `analytics`, `posthog`
and `sentry` returned **zero** matches, and on that basis this file first claimed there was no
reporting to remove. That was wrong: the local clone carries a full telemetry subsystem
(`src/services/telemetry/`, ten files, ~115 KB — consent, buffering, backfill, PII scrubbing) that
posts to a public ingestion endpoint, and **its default is on**. GitHub's code index is not a
substitute for reading the tree you are about to run.

We deliberately did **not** delete `CloudSync.ts`, `CloudSyncRoutes.ts` or the settings keys.
`CloudSync` is referenced from 15 files; deleting it would break the build and turn a one-line
delta into a permanent merge conflict. A flag at the single construction site is smaller, safer
and easier to re-apply.

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

This grows the delta, which the last section of this file calls a warning. It is the right kind:
the change is a consequence of a decision already recorded here, and the upstream-shaped half
(scan a list of marketplace names instead of one hardcoded one, log before dying) belongs upstream
as a PR.

### Version suffix

The fork carries `-weblapp.N` on upstream's version (`13.17.2-weblapp.1`), synced across
`package.json`, both `plugin.json` files and `marketplace.json`.

This is not cosmetic. Measured 2026-08-29: after rebuilding the bundles, `claude plugin update`
answered *"already at the latest version (13.17.2)"* and kept serving the **old cached copy** —
the installed plugin still ran upstream behaviour while the repo was correct. A build that
behaves differently must not claim the same version. Bump `N` whenever the delta changes.

### Marketplace manifest

Two more changes live in `.claude-plugin/marketplace.json`:

- **Renamed** `thedotmack` → `weblapp-claude-mem`. Installed under upstream's name, our fork is
  indistinguishable from upstream in `claude plugin marketplace list` — exactly the kind of
  ambiguity that later becomes "where did this come from?".
- **Dropped `claude-mem-cowork`.** Its own description says its hooks *"stream tool use to
  cmem.ai"*. We are not installing it, but leaving it listed means one careless
  `/plugin install` reopens everything the delta closed.

## Keeping up to date

```bash
git fetch upstream
git rebase upstream/main         # our single delta commit replays on top
npm install --no-save            # build deps, without touching lockfiles
npm run build                    # REQUIRED — see below
git add plugin/ && git commit --amend --no-edit -- <paths>
git push --force-with-lease origin main
```

**`npm run build` is not optional, and this is the trap that nearly shipped a fake fork.**
The marketplace installs from `./plugin`, which is *compiled output tracked in git* — our source
patch in `src/` reaches nothing until the bundles are rebuilt. Measured 2026-08-29: after the
first push, the installed plugin contained **zero** occurrences of our flags; the fork looked
safe while running upstream behaviour.

Verify the cuts landed in the **bundle**, not just the source. Names are minified, so grep for
behaviour, not identifiers:

```bash
# cloud sync: our flag must precede the activation condition
grep -o '.\{40\}CLAUDE_MEM_CLOUD_SYNC_TOKEN!==""' plugin/scripts/worker-service.cjs
#   upstream:  ...search"),e.CLAUDE_MEM_CLOUD_SYNC_TOKEN!==""
#   ours:      ...search"),!tUe&&e.CLAUDE_MEM_CLOUD_SYNC_TOKEN!==""   (tUe=!0)

# telemetry: one more early return with source:"config" than upstream had
grep -o 'source:"config"' plugin/scripts/worker-service.cjs | wc -l   # upstream 2 -> ours 3
```

**If the delta grows, that is a warning.** This fork exists to remove an outbound path, not to
develop features. Anything else we want belongs upstream as a PR, or on our side in the bridge
that writes summaries into git.

## What we did not change

Everything else: the SQLite schema, Chroma search, the MCP search tools
(`search` / `timeline` / `get_observations`), the worker, the viewer. Those are why we chose this
project instead of writing our own.

The hooks were on this list until 2026-08-31 — see "The cost of the rename" above. What changed
there is the plugin-root *fallback list* and what happens when it comes up empty; the hook events,
their payloads, their ordering and everything they call are still upstream's.
