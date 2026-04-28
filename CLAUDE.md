# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
pnpm run start:dev       # watch mode
pnpm run start:debug     # debug + watch

# Build & production
pnpm run build           # compiles to dist/
pnpm run start:prod      # runs dist/main.js

# Testing
pnpm run test            # unit tests (rootDir: src, pattern: *.spec.ts)
pnpm run test:watch      # watch mode
pnpm run test:cov        # coverage
pnpm run test:e2e        # e2e via test/jest-e2e.json

# Code quality
pnpm run lint            # ESLint with autofix
pnpm run format          # Prettier over src/ and test/
```

Runs on port `3003` by default (or `PORT` env var). Swagger UI is at `/docs`.

## Architecture

NestJS 11 service for real-time audio/video call management. All state is **in-memory** (no database) — the `CallRepository` uses a plain `Map<string, Call>`.

### Request flow

REST request → `JwtAuthGuard` (validates Bearer token via `JWT_SECRET`) → `CallController` → `CallService` → `CallRepository` (mutates in-memory store) + `CallGateway` (emits Socket.IO events to affected users) + `EventService` (console.log audit trail).

### Key modules

| Module | Purpose |
|---|---|
| `calls/` | Core domain: controller, service, repository, gateway, DTOs, entity, mapper |
| `auth-integration/` | JWT validation only — exports `JwtAuthGuard` and `JwtModule` for use in AppModule |
| `metrics/` | Prometheus metrics via `prom-client`; exposed at `GET /metrics` (no auth guard); `MetricsInterceptor` is registered as a global `APP_INTERCEPTOR` |
| `events/` | `EventService` — thin wrapper around `console.log`; emits named business events (`call.created`, `call.accepted`, etc.) |

### WebSocket gateway

`CallGateway` mounts at path `/calls/socket.io`. It maintains two in-memory maps:

- `users: Map<userId, socketId>` — used to route server-initiated events to specific clients
- `sockets: Map<socketId, userId>` — reverse lookup on disconnect / WebRTC relay

Clients must emit `register` with their `userId` before receiving any call events. WebRTC signaling (`webrtc:offer`, `webrtc:answer`, `webrtc:ice-candidate`) is relayed peer-to-peer through the server using these maps.

### Call state machine

```
RINGING → ACCEPTED (first participant accepts)
RINGING → REJECTED (all participants reject)
RINGING → MISSED  (50-second setTimeout, no response)
RINGING → ENDED   (caller hangs up before anyone accepts)
ACCEPTED → ENDED
```

### Auth

All `CallController` routes are protected by `JwtAuthGuard`. The guard reads `Authorization: Bearer <token>` and calls `jwtService.verifyAsync`. `JWT_SECRET` must be set in the environment (`.env` or Azure App Service config).

### Deployment

CI/CD via GitHub Actions (`.github/workflows/main_omnicode-api-calls.yml`) deploys to **Azure Web App** (`omnicode-api-calls`, Production slot) on every push to `main`. The workflow runs `npm install && npm run build && npm run test`.
