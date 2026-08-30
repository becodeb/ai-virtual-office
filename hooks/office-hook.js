#!/usr/bin/env node
/**
 * AI Virtual Office - Claude Code lifecycle hook (Node fallback).
 *
 * `office-hook.sh` is the primary implementation and is roughly seven times
 * faster (6ms versus 44ms), almost all of the difference being Node's own
 * process startup. Use this only on hosts without `curl`.
 *
 * Unlike the shell version, this one can parse, so it emits a fully-formed
 * HookEventPayload with `v` set. The hub accepts that shape directly and skips
 * server-side normalisation.
 *
 * Obligations are identical to the shell version and are not negotiable, since
 * this runs inside somebody's real session:
 *   - stdout stays empty (on UserPromptSubmit it would be injected into the
 *     user's prompt context)
 *   - exit code is always 0
 *   - the payload never touches argv or the environment
 *
 * Imports are restricted to Node builtins. This file has no dependencies and
 * must never acquire any.
 */

'use strict';

const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const WIRE_PAYLOAD_VERSION = 1;
const MAX_TEXT = 80;
const SEND_TIMEOUT_MS = 1000;

/** Nothing this script can hit is worth failing somebody's session over. */
const bail = () => process.exit(0);
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);

const KNOWN_EVENTS = new Set([
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'SubagentStart', 'SubagentStop', 'Stop', 'SessionEnd',
]);

const redacted = process.env.OFFICE_REDACT_PROMPTS === 'true';

/** Collapse whitespace and clip to the wire's text budget. */
function clip(value) {
  if (redacted || typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_TEXT ? flat : flat.slice(0, MAX_TEXT - 1) + '…';
}

/**
 * Reduce a tool's raw input to the few fields the role classifier needs.
 * The raw input is never forwarded - it is arbitrary user content.
 */
function summariseInput(tool, input) {
  if (!input || typeof input !== 'object') return {};
  switch (tool) {
    case 'Bash': {
      const command = clip(input.command);
      return { command, argv0: String(input.command || '').trim().split(/\s+/)[0] || '' };
    }
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit': {
      const p = String(input.file_path || input.path || '');
      return { path: clip(p), ext: path.extname(p) };
    }
    case 'Grep': case 'Glob':
      return { path: clip(String(input.path || '')), pattern: clip(String(input.pattern || '')) };
    case 'WebFetch': case 'WebSearch': {
      const url = String(input.url || '');
      let host = '';
      try { host = url ? new URL(url).host : ''; } catch { host = ''; }
      return { query: clip(String(input.query || url)), host };
    }
    case 'Task':
      return {
        subagentType: String(input.subagent_type || ''),
        model: String(input.model || ''),
        taskSummary: clip(String(input.description || input.prompt || '')),
      };
    default:
      return {};
  }
}

/** Build the event-specific `data` block for one lifecycle event. */
function buildData(event, raw) {
  const tool = String(raw.tool_name || '');
  const response = raw.tool_response || {};
  switch (event) {
    case 'SessionStart':
      return { source: String(raw.source || 'startup'), model: String(raw.model || '') };
    case 'UserPromptSubmit': {
      const prompt = String(raw.prompt || '');
      return { promptSummary: clip(prompt), promptLength: prompt.length };
    }
    case 'PreToolUse':
      return { tool, toolUseId: String(raw.tool_use_id || ''), input: summariseInput(tool, raw.tool_input) };
    case 'PostToolUse': {
      const exitCode = typeof response.exit_code === 'number' ? response.exit_code : null;
      return {
        tool,
        toolUseId: String(raw.tool_use_id || ''),
        exitCode,
        ok: exitCode === null ? response.is_error !== true : exitCode === 0,
        durationMs: Number(raw.duration_ms) || 0,
        outputSummary: clip(String(response.stdout || response.output || '')),
      };
    }
    case 'SubagentStart':
      return {
        subagentId: String(raw.subagent_id || raw.session_id || ''),
        subagentType: String(raw.subagent_type || ''),
        model: String(raw.model || ''),
        taskSummary: clip(String(raw.description || raw.prompt || '')),
      };
    case 'SubagentStop':
      return { subagentId: String(raw.subagent_id || raw.session_id || ''), ok: raw.is_error !== true };
    case 'Stop':
      return { reason: String(raw.stop_reason || raw.reason || 'complete') };
    case 'SessionEnd':
      return { reason: String(raw.reason || 'exit') };
    default:
      return {};
  }
}

/** Stable across restarts, and matches the hub's own derivation. */
function identityFor(machineId, cwd) {
  return crypto.createHash('sha256').update(`${machineId} ${cwd}`).digest('hex').slice(0, 12);
}

function send(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const base = process.env.OFFICE_HUB_URL || 'http://127.0.0.1:8787';
  const url = new URL('/events', base);
  const transport = url.protocol === 'https:' ? https : http;

  const req = transport.request(
    {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        'x-office-machine': payload.machineId,
      },
    },
    (res) => res.resume(),
  );

  // Every failure mode ends the same way: quietly.
  req.on('error', () => {});
  req.setTimeout(SEND_TIMEOUT_MS, () => req.destroy());
  req.end(body);
}

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('error', bail);
process.stdin.on('data', (chunk) => {
  stdin += chunk;
  if (stdin.length > 1024 * 1024) bail();
});
process.stdin.on('end', () => {
  if (process.env.OFFICE_HOOK_DISABLED === '1') bail();
  try {
    const raw = JSON.parse(stdin || '{}');
    const event = String(raw.hook_event_name || '');
    if (!KNOWN_EVENTS.has(event)) bail();

    const machineId = process.env.OFFICE_MACHINE_ID || os.hostname() || 'unknown';
    const cwd = String(raw.cwd || process.cwd());

    send({
      v: WIRE_PAYLOAD_VERSION,
      event,
      sessionId: String(raw.session_id || ''),
      parentSessionId: raw.parent_session_id ? String(raw.parent_session_id) : null,
      machineId,
      cwd,
      project: path.basename(cwd),
      identityKey: identityFor(machineId, cwd),
      ts: Date.now(),
      data: buildData(event, raw),
    });
  } catch {
    bail();
  }
});
