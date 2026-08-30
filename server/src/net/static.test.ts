import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStaticHandler } from './static.js';

let root: string;
let server: Server;
let base: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'office-static-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>office</title>');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'assets', 'app-a1b2c3d4e5.js'), 'console.log(1)');
  writeFileSync(join(root, 'assets', 'animations.glb'), 'glTF-ish');
  // A file the served root must never be able to reach.
  writeFileSync(join(root, '..', 'office-static-secret.txt'), 'do not serve me');

  const handler = createStaticHandler(root);
  server = createServer((req, res) => {
    if (handler !== null && handler(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
  rmSync(join(root, '..', 'office-static-secret.txt'), { force: true });
});

describe('static handler', () => {
  it('is disabled when no directory is configured', () => {
    expect(createStaticHandler(undefined)).toBeNull();
    expect(createStaticHandler('')).toBeNull();
    expect(createStaticHandler('/definitely/not/a/real/path')).toBeNull();
  });

  it('serves index.html at the root', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('office');
  });

  it('serves a GLB with the glTF binary content type', async () => {
    const res = await fetch(`${base}/assets/animations.glb`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
  });

  it('caches content-addressed bundles immutably and everything else briefly', async () => {
    const hashed = await fetch(`${base}/assets/app-a1b2c3d4e5.js`);
    expect(hashed.headers.get('cache-control')).toContain('immutable');

    const glb = await fetch(`${base}/assets/animations.glb`);
    expect(glb.headers.get('cache-control')).not.toContain('immutable');
  });

  it('falls back to index.html for unknown routes so the SPA can route', async () => {
    const res = await fetch(`${base}/some/client/route`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('office');
  });

  it.each([
    ['/../office-static-secret.txt'],
    ['/assets/../../office-static-secret.txt'],
    ['/%2e%2e/office-static-secret.txt'],
  ])('never serves outside the root: %s', async (path) => {
    const res = await fetch(`${base}${path}`);
    const body = await res.text();
    expect(body).not.toContain('do not serve me');
  });

  it('does not take non-GET requests', async () => {
    const res = await fetch(`${base}/index.html`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
