/**
 * Optional static file serving for the built client.
 *
 * In production the hub serves the client itself, so the whole office is one
 * container on one port. That removes the CORS surface entirely, lets the
 * WebSocket share the page's origin, and means a reverse proxy has a single
 * upstream to route rather than two that must agree with each other.
 *
 * When `OFFICE_STATIC_DIR` is unset or missing this module does nothing and the
 * hub stays an API-only server, which is exactly what the Vite dev server
 * wants during development.
 */
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * Content-addressed bundle output can be cached indefinitely; everything else
 * has a stable name and must be revalidated. The 19MB of character and prop
 * GLBs are the reason this distinction is worth making at all.
 */
function cacheControlFor(pathname: string): string {
  return /\/assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(pathname)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=300';
}

export interface StaticHandler {
  (req: IncomingMessage, res: ServerResponse): boolean;
}

/**
 * Returns a handler that serves `root`, or `null` when static serving is off.
 * The handler answers `true` when it took the request.
 */
export function createStaticHandler(root: string | undefined): StaticHandler | null {
  if (root === undefined || root === '') return null;
  const base = resolve(root);
  try {
    if (!statSync(base).isDirectory()) return null;
  } catch {
    return null;
  }

  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;

    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    // `normalize` collapses `..` before the prefix check, so a crafted path can
    // never resolve outside the served root.
    const candidate = resolve(join(base, normalize(pathname)));
    if (candidate !== base && !candidate.startsWith(base + sep)) {
      res.writeHead(403).end();
      return true;
    }

    const target = servableFile(candidate) ?? join(base, 'index.html');
    let size: number;
    try {
      const stat = statSync(target);
      if (!stat.isFile()) return false;
      size = stat.size;
    } catch {
      return false;
    }

    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'content-length': size,
      'cache-control': cacheControlFor(pathname),
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    createReadStream(target).on('error', () => res.destroy()).pipe(res);
    return true;
  };
}

/** Resolves a request path to a real file, or `null` so the SPA fallback runs. */
function servableFile(candidate: string): string | null {
  try {
    const stat = statSync(candidate);
    if (stat.isFile()) return candidate;
    if (stat.isDirectory()) {
      const index = join(candidate, 'index.html');
      return statSync(index).isFile() ? index : null;
    }
  } catch {
    return null;
  }
  return null;
}
