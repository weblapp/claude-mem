import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test';
import type { ActiveSession } from '../../src/services/worker-types.js';

// The quota guard must decide on the readings of the SDK session it is guarding.
//
// Every observer session spawns a fresh Claude Code child that reads its OAuth credential from
// the keychain at spawn, so two sessions of one worker can speak for two different accounts. The
// break these tests catch: the abort decision consulting readings another session produced --
// for example the process-wide globalRateLimitStore, which keeps each window's last reading for
// as long as the worker lives.
//
// Measured on 2026-09-26: account A reported seven_day 0.93 at 13:12 and the guard stopped the
// observer. At 13:27 the CLI login moved to account B. At 13:42 a new session spawned with B's
// token, its first event said five_hour 0.11 (B's weekly usage was 3%), and the guard stopped it
// again with A's "quota:seven_day utilization 93.0% >= 93%".

// bun's mock.module is process-global and sticky: snapshot each real module before mocking and
// re-register the snapshot in afterAll so the stubs cannot break later suites.
const actualAgentSdk = { ...(await import('@anthropic-ai/claude-agent-sdk')) };
const actualFindClaude = { ...(await import('../../src/shared/find-claude-executable.js')) };
const actualEnvManager = { ...(await import('../../src/shared/EnvManager.js')) };
const actualProcessRegistry = { ...(await import('../../src/supervisor/process-registry.js')) };
const actualModeManager = { ...(await import('../../src/services/domain/ModeManager.js')) };

let scriptedMessages: unknown[] = [];

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  ...actualAgentSdk,
  query: () => (async function* () {
    for (const message of scriptedMessages) {
      yield message;
    }
  })(),
}));

mock.module('../../src/shared/find-claude-executable.js', () => ({
  ...actualFindClaude,
  findClaudeExecutable: () => '/mock/claude',
}));

// A subscription label, not an API key: the guard only applies to subscription quota.
mock.module('../../src/shared/EnvManager.js', () => ({
  ...actualEnvManager,
  buildIsolatedEnvWithFreshOAuth: async () => ({ PATH: process.env.PATH ?? '' }),
  getAuthMethodDescription: () => 'Claude Code OAuth token (read from system keychain at spawn) profile=default',
}));

mock.module('../../src/supervisor/process-registry.js', () => ({
  ...actualProcessRegistry,
  waitForSlot: async () => ({ release: () => {} }),
  createSdkSpawnFactory: () => () => {
    throw new Error('spawn factory must not run in this test');
  },
  getSdkProcessForSession: () => undefined,
  ensureSdkProcessExit: async () => {},
}));

mock.module('../../src/services/domain/ModeManager.js', () => ({
  ...actualModeManager,
  ModeManager: {
    getInstance: () => ({
      getActiveMode: () => ({
        name: 'code',
        prompts: { init: 'init prompt', observation: 'obs prompt', summary: 'summary prompt' },
        observation_types: [{ id: 'discovery' }, { id: 'bugfix' }, { id: 'refactor' }],
        observation_concepts: [],
      }),
    }),
  },
}));

afterAll(() => {
  mock.module('../../src/services/domain/ModeManager.js', () => actualModeManager);
  mock.module('@anthropic-ai/claude-agent-sdk', () => actualAgentSdk);
  mock.module('../../src/shared/find-claude-executable.js', () => actualFindClaude);
  mock.module('../../src/shared/EnvManager.js', () => actualEnvManager);
  mock.module('../../src/supervisor/process-registry.js', () => actualProcessRegistry);
});

const { ClaudeProvider } = await import('../../src/services/worker/ClaudeProvider.js');

const MEMORY_SESSION_ID = 'memory-session-quota-scope';
const QUEUED_TIMESTAMP = 1700000000000;
const HOUR_MS = 60 * 60 * 1000;

const OBSERVATION_XML = `
<observation>
  <type>discovery</type>
  <title>Observed the queued tool call</title>
  <narrative>The queued batch reached the parser.</narrative>
  <facts><fact>The session did its work</fact></facts>
  <concepts><concept>observer</concept></concepts>
  <files_read></files_read>
  <files_modified></files_modified>
</observation>
`;

function rateLimitEvent(info: Record<string, unknown>) {
  return {
    type: 'rate_limit_event',
    rate_limit_info: info,
    uuid: '00000000-0000-4000-8000-000000000000',
    session_id: MEMORY_SESSION_ID,
  };
}

function assistantText(text: string) {
  return {
    type: 'assistant',
    session_id: MEMORY_SESSION_ID,
    message: {
      content: [{ type: 'text', text }],
      usage: { input_tokens: 120, output_tokens: 4 },
    },
  };
}

function resultFrame() {
  return {
    type: 'result',
    session_id: MEMORY_SESSION_ID,
    subtype: 'success',
    is_error: false,
    usage: { input_tokens: 120, output_tokens: 40 },
    total_cost_usd: 0.001,
  };
}

function createSession(sessionDbId: number): ActiveSession {
  return {
    sessionDbId,
    contentSessionId: `content-${sessionDbId}`,
    memorySessionId: null,
    project: 'observer-project',
    platformSource: 'claude',
    userPrompt: 'run the project',
    abortController: new AbortController(),
    generatorPromise: null,
    lastPromptNumber: 2,
    startTime: Date.now(),
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
    earliestPendingTimestamp: QUEUED_TIMESTAMP,
    claimedMessageIds: [1],
    conversationHistory: [],
    currentProvider: null,
    consecutiveRestarts: 0,
    consecutiveInvalidOutputs: 0,
    lastGeneratorActivity: Date.now(),
  } as ActiveSession;
}

function createProvider(session: ActiveSession) {
  let claimedMessages: Array<{ type: string; tool_name?: string; tool_input?: unknown }> = [
    { type: 'observation', tool_name: 'Read', tool_input: { file_path: 'src/queued.ts' } },
  ];
  const storeObservations = mock(() => ({
    observationIds: [7],
    summaryId: null,
    createdAtEpoch: QUEUED_TIMESTAMP,
  }));
  const sessionManager = {
    confirmClaimedMessages: mock(async () => {
      const confirmed = claimedMessages.length;
      claimedMessages = [];
      session.claimedMessageIds = [];
      session.earliestPendingTimestamp = null;
      return confirmed;
    }),
    resetProcessingToPending: mock(async () => 0),
    getClaimedMessages: () => claimedMessages,
    getMessageIterator: async function* () {},
  };
  const dbManager = {
    getSessionStore: () => ({
      updateMemorySessionId: () => {},
      ensureMemorySessionIdRegistered: () => {},
      getSessionById: () => ({ memory_session_id: MEMORY_SESSION_ID }),
      storeObservations,
    }),
    getChromaSync: () => null,
    getCloudSync: () => null,
  };
  return {
    storeObservations,
    provider: new ClaudeProvider(dbManager as never, sessionManager as never),
  };
}

describe('quota guard decides on the readings of its own session', () => {
  beforeEach(() => {
    scriptedMessages = [];
  });

  it('a later session is not stopped by a window only an earlier session reported', async () => {
    // Account A: the weekly window has crossed the 0.93 threshold.
    const first = createSession(254);
    scriptedMessages = [
      rateLimitEvent({
        status: 'allowed_warning',
        rateLimitType: 'seven_day',
        utilization: 0.93,
        surpassedThreshold: 0.75,
        resetsAt: Date.now() + 67 * HOUR_MS,
      }),
    ];
    await createProvider(first).provider.startSession(first);
    expect(first.abortReason).toBe('quota:seven_day');

    // Account B, same worker process: its only reading is a quiet five-hour window.
    const second = createSession(259);
    const harness = createProvider(second);
    scriptedMessages = [
      rateLimitEvent({
        status: 'allowed',
        rateLimitType: 'five_hour',
        utilization: 0.11,
        resetsAt: Date.now() + 4 * HOUR_MS,
      }),
      assistantText(OBSERVATION_XML),
      resultFrame(),
    ];
    await harness.provider.startSession(second);

    expect(second.abortReason).toBeUndefined();
    expect(harness.storeObservations).toHaveBeenCalledTimes(1);
  });

  it('a session is still stopped by a window it reported itself', async () => {
    // The break: a fix that scopes the decision to the session but never records the session's
    // own readings, so the guard would decide on an empty store and let the work run.
    const session = createSession(260);
    const harness = createProvider(session);
    scriptedMessages = [
      rateLimitEvent({
        status: 'allowed_warning',
        rateLimitType: 'seven_day',
        utilization: 0.94,
        surpassedThreshold: 0.75,
        resetsAt: Date.now() + 67 * HOUR_MS,
      }),
      assistantText(OBSERVATION_XML),
      resultFrame(),
    ];
    await harness.provider.startSession(session);

    expect(session.abortReason).toBe('quota:seven_day');
    expect(harness.storeObservations).not.toHaveBeenCalled();
  });
});
