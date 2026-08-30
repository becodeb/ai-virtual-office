/**
 * Executable checks over the delivery contract.
 *
 * These are the properties that regress silently. Nothing crashes when a
 * `ports:` key sneaks into the production compose — the office just quietly
 * becomes reachable from outside the proxy, and nobody notices until somebody
 * goes looking.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (name: string) => readFileSync(join(REPO_ROOT, name), 'utf-8');
const load = (name: string) => parse(read(name)) as ComposeFile;

interface ComposeService {
  ports?: unknown[];
  expose?: unknown[];
  healthcheck?: unknown;
  volumes?: string[];
  restart?: string;
  networks?: string[];
  env_file?: unknown;
}
interface ComposeFile {
  services?: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
  networks?: Record<string, { external?: boolean }>;
}

const LOCAL = 'docker-compose.yml';
const PROD = 'docker-compose.prod.yml';
const PROXY = 'docker-compose.proxy.yml';

describe('production compose', () => {
  const prod = load(PROD);
  const services = Object.entries(prod.services ?? {});

  it('publishes no host ports at all', () => {
    for (const [name, service] of services) {
      expect(service.ports, `service "${name}" publishes host ports in production`).toBeUndefined();
    }
  });

  it('exposes the hub on the internal network instead', () => {
    for (const [name, service] of services) {
      expect(service.expose, `service "${name}" exposes nothing`).toBeDefined();
    }
  });

  /**
   * The measured deploy host runs Coolify, whose proxy attaches the service
   * itself. `reverse_proxy_network` does not exist there, and declaring it
   * external makes `up` fail before anything starts.
   */
  it('declares no external network, leaving that to the opt-in overlay', () => {
    expect(prod.networks ?? {}).toEqual({});
    for (const service of Object.values(prod.services ?? {})) {
      expect(service.networks).toBeUndefined();
    }
  });

  it('restarts always and defines a healthcheck per service', () => {
    for (const [name, service] of services) {
      expect(service.restart, `service "${name}" has no restart policy`).toBe('always');
      expect(service.healthcheck, `service "${name}" has no healthcheck`).toBeDefined();
    }
  });

  it('treats the env file as optional so a fresh host can boot without one', () => {
    const raw = read(PROD);
    expect(raw).toContain('required: false');
  });
});

describe('local compose', () => {
  const local = load(LOCAL);

  it('does publish a host port, because locally you want to open it', () => {
    const services = Object.values(local.services ?? {});
    expect(services.some((s) => Array.isArray(s.ports) && s.ports.length > 0)).toBe(true);
  });
});

describe('identity persistence', () => {
  /**
   * Coffee counts, ranks and assigned skins are the only state that outlives a
   * process. If local and production disagree about where the volume mounts,
   * one of them silently starts from zero on every deploy.
   */
  it('mounts the identity volume at the same path in local and production', () => {
    const mountFor = (file: string) => {
      const compose = load(file);
      const mounts = Object.values(compose.services ?? {}).flatMap((s) => s.volumes ?? []);
      return mounts.filter((m) => m.includes(':/data'));
    };
    const localMounts = mountFor(LOCAL);
    expect(localMounts.length).toBeGreaterThan(0);
    expect(mountFor(PROD)).toEqual(localMounts);
  });

  it('declares the volume in both files', () => {
    for (const file of [LOCAL, PROD]) {
      expect(Object.keys(load(file).volumes ?? {}), `${file} declares no volume`).not.toHaveLength(0);
    }
  });
});

describe('proxy overlay', () => {
  const proxy = load(PROXY);

  it('is the only file that references the external network', () => {
    expect(proxy.networks?.reverse_proxy_network?.external).toBe(true);
  });

  it('adds nothing but network membership', () => {
    for (const service of Object.values(proxy.services ?? {})) {
      expect(Object.keys(service)).toEqual(['networks']);
    }
  });
});

describe('image build', () => {
  const dockerfile = read('Dockerfile');

  it('uses a multi-arch base, since the deploy target is aarch64', () => {
    expect(dockerfile).toMatch(/FROM node:22-alpine/);
  });

  /**
   * Checks what is actually installed rather than what the lockfile mentions.
   * The lockfile also lists optional peer dependencies that are never fetched
   * (jsdom declares `canvas`, which pnpm skips) and `@types/*` packages whose
   * names contain the same substrings — greping it reports offenders that do
   * not exist on disk.
   */
  it('installs no package that needs a native x86-only build', () => {
    const store = join(REPO_ROOT, 'node_modules/.pnpm');
    const installed = existsSync(store) ? readdirSync(store) : [];
    expect(installed.length, 'dependencies are not installed; run pnpm install').toBeGreaterThan(0);
    for (const offender of ['sharp', 'canvas', 'node-canvas']) {
      const hit = installed.find((dir) => dir.startsWith(`${offender}@`));
      expect(hit, `${offender} risks a native x86-only build on ARM`).toBeUndefined();
    }
  });

  it('runs as a non-root user', () => {
    expect(dockerfile).toMatch(/^USER node$/m);
  });

  it('needs no BuildKit-only syntax, so it builds on the classic builder too', () => {
    expect(dockerfile).not.toContain('--mount=type=');
  });

  it('excludes the 267MB raw asset tree from the build context', () => {
    expect(existsSync(join(REPO_ROOT, '.dockerignore'))).toBe(true);
    expect(read('.dockerignore')).toMatch(/^assets\/$/m);
  });
});

describe('the hook and the hub agree on a port', () => {
  /**
   * The single highest-consequence configuration bug in this repo: if these
   * drift, the hook exits 0, the hub reports healthy, and the office simply
   * stays empty with nothing anywhere to explain why.
   */
  it('defaults to the same port on both sides', () => {
    const hookDefault = /127\.0\.0\.1:(\d+)/.exec(read('hooks/office-hook.sh'))?.[1];
    const hubDefault = /process\.env\.PORT \?\? (\d+)/.exec(read('server/src/index.ts'))?.[1];
    expect(hookDefault, 'no default hub URL found in the shell hook').toBeDefined();
    expect(hubDefault, 'no default port found in the hub entrypoint').toBeDefined();
    expect(hookDefault).toBe(hubDefault);
  });

  it('wires the settings example to that same port', () => {
    const settings = read('hooks/settings.example.json');
    const hookDefault = /127\.0\.0\.1:(\d+)/.exec(read('hooks/office-hook.sh'))?.[1];
    expect(settings).toContain(`127.0.0.1:${hookDefault}`);
  });
});
