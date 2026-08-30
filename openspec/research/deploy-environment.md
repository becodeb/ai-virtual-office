# Deploy Environment — Verified

Inspected directly on the target host. This **corrects** the deploy convention recorded in
`openspec/config.yaml`, which was inferred from the user's sibling repos rather than measured.

## What is actually running

| Fact | Value |
|---|---|
| Docker | 29.3.1 |
| Compose | v5.1.1 |
| Platform | **linux / aarch64** (Raspberry Pi) |
| Orchestrator | **Coolify 4.3.14** (`coollabsio/coolify:4.3.14`) |
| Ingress | **`coolify-proxy`, Traefik v3.6** |
| Docker network `coolify` | exists |
| Docker network `reverse_proxy_network` | **does not exist** |

## Two corrections

**1. `reverse_proxy_network` is not available here.** The `kodu` and `trellofake` prod composes
declare it `external: true`. That convention belongs to a different deploy target. Declaring it
here makes `docker compose -f docker-compose.prod.yml up` fail immediately with an unknown
network error, before anything starts.

**2. The host is ARM64.** Every base image must have an `arm64` variant, and any native
dependency must build on aarch64. Prefer `node:22-alpine` (multi-arch) and avoid packages that
ship x86-only prebuilt binaries. `sharp` and `canvas` are the usual offenders — the asset
pipeline needs neither, since it runs headless three.js over plain buffers.

## Resolution: satisfy both paths, ask nothing

`docker-compose.prod.yml` publishes **no host ports** (`expose` only) and declares **no external
network**. Coolify attaches the service to its own proxy network and generates the Traefik
labels itself, so this file works as-is under Coolify.

For the manual reverse-proxy convention used in the sibling repos, ship
`docker-compose.proxy.yml` as an opt-in overlay that adds the external
`reverse_proxy_network` membership:

```
docker compose -f docker-compose.prod.yml -f docker-compose.proxy.yml up -d
```

Both deploy targets are served, neither is guessed at, and the base file never references a
network that may not exist.

## Local

`docker-compose.yml` **does** map ports — client and hub reachable on the host for development,
exactly as requested.
