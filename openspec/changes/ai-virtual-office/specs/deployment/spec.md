# Deployment Specification

## Purpose

Two Docker Compose profiles for the same monorepo: a local/dev profile for direct access, and
a production profile that fronts through an external reverse proxy with no exposed ports.

## Requirements

### Requirement: Production Publishes No Host Ports

Every service in the production Compose file MUST NOT publish host ports (no `ports:`
mapping). Services requiring inter-container access MUST use `expose` only.

#### Scenario: Production compose has no ports mapping

- GIVEN the production Compose file
- WHEN each service definition is inspected
- THEN none declares a `ports:` key

### Requirement: Local Compose May Publish Host Ports

The local/dev Compose file MAY map host ports directly so the office can be viewed without a
reverse proxy.

#### Scenario: Local compose exposes the client on a host port

- GIVEN the local Compose file
- WHEN the client service is inspected
- THEN it declares a host port mapping

### Requirement: External Reverse Proxy Network

Every production service MUST join an externally-defined Docker network named
`reverse_proxy_network`, declared as `external: true`.

#### Scenario: Production services join the external network

- GIVEN the production Compose file
- WHEN its network configuration is inspected
- THEN `reverse_proxy_network` is declared external and every service is attached to it

### Requirement: Restart Policy

Every production service MUST set `restart: always`.

#### Scenario: Hub service always restarts

- GIVEN the production Compose file
- WHEN the hub service definition is inspected
- THEN it sets `restart: always`

### Requirement: Optional Production Env File

Every production service MUST load its environment via `env_file: .env.production` with
`required: false`, so a missing file does not fail Compose startup.

#### Scenario: Missing .env.production does not block startup

- GIVEN no `.env.production` file exists
- WHEN production Compose starts
- THEN startup does not fail due to the missing env file

### Requirement: Healthchecks on Every Production Service

Every service in the production Compose file MUST define a `healthcheck`.

#### Scenario: Hub service defines a healthcheck

- GIVEN the production Compose file
- WHEN the hub service definition is inspected
- THEN it declares a `healthcheck` block

### Requirement: Persisted Identity Volume

The hub service MUST mount a named or bind volume dedicated to the per-identity JSON record
file (decision 1), so that file survives container recreation, in both local and production
Compose files.

#### Scenario: Identity file survives container recreation

- GIVEN the hub service with its identity volume mounted
- WHEN the hub container is removed and recreated
- THEN the identity JSON file's contents from before recreation are still present
