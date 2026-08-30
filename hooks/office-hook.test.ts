import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const SH = join(HERE, 'office-hook.sh');
const JS = join(HERE, 'office-hook.cjs');

/** One received request, as the hub would have seen it. */
interface Received {
  body: string;
  bytes: number;
  machine: string | undefined;
}

/**
 * Run a hook script against a given hub URL and report exactly what Claude Code
 * would observe: exit code, stdout, and wall time.
 */
function runHook(script: string, stdin: string, env: Record<string, string> = {}) {
  return new Promise<{ code: number; stdout: string; ms: number }>((resolve) => {
    const started = Date.now();
    const child = execFile(
      script,
      [],
      { env: { ...process.env, ...env }, timeout: 10_000 },
      (error, stdout) => {
        resolve({
          code: error && typeof error.code === 'number' ? error.code : 0,
          stdout: String(stdout),
          ms: Date.now() - started,
        });
      },
    );
    // A hook that bails early (OFFICE_HOOK_DISABLED, unknown event) exits
    // before draining stdin, so this write can land on a closed pipe. That
    // EPIPE is the script behaving correctly, not a failure - swallow it here
    // rather than letting it surface as an unhandled error that only appears
    // when the whole monorepo suite runs in parallel.
    child.stdin?.on('error', () => {});
    child.stdin?.end(stdin);
  });
}

/** A hub stand-in that records bodies and can be told to misbehave. */
function startHub(status = 204) {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    let body = '';
    let bytes = 0;
    req.on('data', (c) => {
      bytes += c.length;
      body += c;
    });
    req.on('end', () => {
      received.push({
        body,
        bytes,
        machine: req.headers['x-office-machine'] as string | undefined,
      });
      res.writeHead(status);
      res.end();
    });
  });
  return new Promise<{ server: Server; url: string; received: Received[] }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, received });
    });
  });
}


/** Asserts exactly one request landed and narrows it for strict index access. */
function only(received: Received[]): Received {
  expect(received.length, 'expected exactly one delivered request').toBe(1);
  const first = received[0];
  if (first === undefined) throw new Error('unreachable: length asserted above');
  return first;
}

const settle = () => new Promise((res) => setTimeout(res, 500));

const rawEvent = (event: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    hook_event_name: event,
    session_id: 's-1234',
    cwd: '/home/someone/projects/thing',
    ...extra,
  });

const ALL_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'SessionEnd',
] as const;

/** A port nothing is listening on. */
const DEAD = 'http://127.0.0.1:1';
/** A hostname that cannot resolve. */
const NXDOMAIN = 'http://office-hub.invalid.nowhere.test:8787';

const SCRIPTS: Array<[string, string]> = [
  ['office-hook.sh', SH],
  ['office-hook.cjs', JS],
];

describe.each(SCRIPTS)('%s - failure isolation', (_name, script) => {
  it('exits 0 and stays silent when no hub is listening', async () => {
    const r = await runHook(script, rawEvent('SessionStart'), { OFFICE_HUB_URL: DEAD });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('exits 0 when the hub answers HTTP 500', async () => {
    const hub = await startHub(500);
    try {
      const r = await runHook(script, rawEvent('Stop'), { OFFICE_HUB_URL: hub.url });
      expect(r.code).toBe(0);
      expect(r.stdout).toBe('');
    } finally {
      hub.server.close();
    }
  });

  it('exits 0 when the hub hostname does not resolve', async () => {
    const r = await runHook(script, rawEvent('SessionEnd'), { OFFICE_HUB_URL: NXDOMAIN });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  it.each([
    ['empty stdin', ''],
    ['not JSON at all', 'this is not json {{{'],
    ['JSON that is not an object', '[1,2,3]'],
    ['an unknown event name', rawEvent('SomeFutureEvent')],
    ['only whitespace', '   '],
  ])('exits 0 on %s', async (_label, stdin) => {
    const r = await runHook(script, stdin, { OFFICE_HUB_URL: DEAD });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('writes byte-for-byte nothing to stdout across all eight events', async () => {
    const hub = await startHub();
    try {
      for (const event of ALL_EVENTS) {
        const r = await runHook(script, rawEvent(event), { OFFICE_HUB_URL: hub.url });
        expect(r.stdout, `${event} wrote to stdout`).toBe('');
        expect(r.code, `${event} exited non-zero`).toBe(0);
      }
    } finally {
      hub.server.close();
    }
  });

  it('is a no-op when OFFICE_HOOK_DISABLED is 1', async () => {
    const hub = await startHub();
    try {
      const r = await runHook(script, rawEvent('SessionStart'), {
        OFFICE_HUB_URL: hub.url,
        OFFICE_HOOK_DISABLED: '1',
      });
      expect(r.code).toBe(0);
      await settle();
      expect(hub.received).toHaveLength(0);
    } finally {
      hub.server.close();
    }
  });
});

describe.each(SCRIPTS)('%s - delivery integrity', (_name, script) => {
  /**
   * The regression that matters most. An earlier shell implementation
   * backgrounded curl and let it read stdin itself. The parent shell exited
   * first, closing the pipe, so every request arrived with a ZERO-BYTE body
   * while the hub still answered 204 - no error, no non-zero exit, nothing in
   * any log, just a permanently empty office.
   */
  it('delivers a non-empty body the hub can actually read', async () => {
    const hub = await startHub();
    try {
      const payload = rawEvent('PreToolUse', {
        tool_name: 'Bash',
        tool_use_id: 'tu-1',
        tool_input: { command: `pnpm test ${'x'.repeat(1200)}` },
      });
      await runHook(script, payload, { OFFICE_HUB_URL: hub.url });
      await settle();

      const got = only(hub.received);
      expect(got.bytes).toBeGreaterThan(0);
      // Byte length, not character length: truncation appends a multibyte
      // ellipsis, so the two differ for any clipped payload.
      expect(Buffer.byteLength(got.body, 'utf8')).toBe(got.bytes);
      expect(() => JSON.parse(got.body)).not.toThrow();
    } finally {
      hub.server.close();
    }
  });

  it('sends the machine identity header', async () => {
    const hub = await startHub();
    try {
      await runHook(script, rawEvent('SessionStart'), {
        OFFICE_HUB_URL: hub.url,
        OFFICE_MACHINE_ID: 'eze-desktop',
      });
      await settle();
      expect(hub.received[0]?.machine).toBe('eze-desktop');
    } finally {
      hub.server.close();
    }
  });
});

describe('office-hook.cjs - payload shape', () => {
  it('emits a versioned payload matching the wire contract', async () => {
    const hub = await startHub();
    try {
      await runHook(
        JS,
        rawEvent('PostToolUse', {
          tool_name: 'Bash',
          tool_use_id: 'tu-9',
          tool_response: { exit_code: 0, stdout: 'ok' },
          duration_ms: 42,
        }),
        { OFFICE_HUB_URL: hub.url, OFFICE_MACHINE_ID: 'rpi' },
      );
      await settle();

      const sent = JSON.parse(only(hub.received).body);
      expect(sent.v).toBe(1);
      expect(sent.event).toBe('PostToolUse');
      expect(sent.sessionId).toBe('s-1234');
      expect(sent.machineId).toBe('rpi');
      expect(sent.project).toBe('thing');
      expect(sent.identityKey).toMatch(/^[0-9a-f]{12}$/);
      expect(sent.data.exitCode).toBe(0);
      expect(sent.data.ok).toBe(true);
      expect(typeof sent.ts).toBe('number');
    } finally {
      hub.server.close();
    }
  });

  it('derives the same identityKey for the same machine and project', async () => {
    const hub = await startHub();
    try {
      await runHook(JS, rawEvent('SessionStart'), {
        OFFICE_HUB_URL: hub.url,
        OFFICE_MACHINE_ID: 'rpi',
      });
      await runHook(JS, rawEvent('Stop'), {
        OFFICE_HUB_URL: hub.url,
        OFFICE_MACHINE_ID: 'rpi',
      });
      await settle();
      const keys = hub.received.map((r) => JSON.parse(r.body).identityKey as string);
      const [a, b] = [keys.at(0), keys.at(1)];
      expect(a).toBe(b);
    } finally {
      hub.server.close();
    }
  });

  it('truncates free text to the wire budget', async () => {
    const hub = await startHub();
    try {
      await runHook(JS, rawEvent('UserPromptSubmit', { prompt: 'q'.repeat(500) }), {
        OFFICE_HUB_URL: hub.url,
      });
      await settle();
      const sent = JSON.parse(only(hub.received).body);
      expect(sent.data.promptSummary.length).toBeLessThanOrEqual(80);
      expect(sent.data.promptLength).toBe(500);
    } finally {
      hub.server.close();
    }
  });

  it('drops all free text under OFFICE_REDACT_PROMPTS', async () => {
    const hub = await startHub();
    try {
      await runHook(JS, rawEvent('UserPromptSubmit', { prompt: 'my secret plan' }), {
        OFFICE_HUB_URL: hub.url,
        OFFICE_REDACT_PROMPTS: 'true',
      });
      await settle();
      const sent = JSON.parse(only(hub.received).body);
      expect(sent.data.promptSummary).toBe('');
      expect(sent.data.promptLength).toBe(14);
      expect(only(hub.received).body).not.toContain('secret');
    } finally {
      hub.server.close();
    }
  });

  it('never forwards a raw tool input', async () => {
    const hub = await startHub();
    try {
      await runHook(
        JS,
        rawEvent('PreToolUse', {
          tool_name: 'Write',
          tool_input: { file_path: '/tmp/a.ts', content: 'SUPER_SECRET_FILE_CONTENT' },
        }),
        { OFFICE_HUB_URL: hub.url },
      );
      await settle();
      expect(only(hub.received).body).not.toContain('SUPER_SECRET_FILE_CONTENT');
    } finally {
      hub.server.close();
    }
  });
});

describe('source-level guarantees', () => {
  it('office-hook.cjs imports only Node builtins', () => {
    const src = readFileSync(JS, 'utf8');
    const specifiers = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      expect(spec, `${spec} is not a Node builtin`).toMatch(/^node:/);
    }
  });

  it('neither script puts the payload in argv or spawns a command', () => {
    const sh = readFileSync(SH, 'utf8');
    // The body reaches curl through a pipe, never as an argument.
    expect(sh).toContain('--data-binary @-');
    const js = readFileSync(JS, 'utf8');
    expect(js).not.toMatch(/child_process|execSync|spawnSync/);
  });

  it('the shell hook drains stdin before backgrounding the send', () => {
    const sh = readFileSync(SH, 'utf8');
    const code = sh
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    const drain = code.indexOf('$(cat)');
    const send = code.indexOf('curl ');
    expect(drain, 'stdin is never drained in the foreground').toBeGreaterThan(-1);
    expect(drain).toBeLessThan(send);
  });

  it('the shell hook exits 0 unconditionally as its last statement', () => {
    const sh = readFileSync(SH, 'utf8');
    expect(sh.trimEnd().endsWith('exit 0')).toBe(true);
  });

  it('the settings example wires all eight lifecycle events', () => {
    const cfg = JSON.parse(readFileSync(join(HERE, 'settings.example.json'), 'utf8'));
    for (const event of ALL_EVENTS) {
      expect(cfg.hooks[event], `${event} is not wired`).toBeTruthy();
    }
    expect(Object.keys(cfg.hooks)).toHaveLength(ALL_EVENTS.length);
  });
});
