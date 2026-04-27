# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm run start:dev       # Development with file watch
pnpm run build           # Compile TypeScript
pnpm run start:prod      # Production (requires build first)
pnpm run lint            # ESLint with auto-fix
pnpm run format          # Prettier format
pnpm run test            # Jest unit tests
pnpm run test:watch      # Jest in watch mode
pnpm run test:cov        # Coverage report
pnpm run test:e2e        # End-to-end tests
```

## Environment

Required `.env` variables:
```
PORT=3003
FRONTEND_URL=http://localhost:3000
JWT_SECRET=<secret>
JWT_EXPIRES_IN=3h
```

## Architecture

**NetCalls** is a real-time group calling backend using WebSocket signaling (Socket.IO) and WebRTC peer-to-peer communication. It runs on port 3003.

### Module structure

- **`calls/`** — Core domain. REST endpoints → `CallsController`, business logic → `CallsService`, storage → `CallRepository` (in-memory `Map<string, Call>`), real-time signaling → `CallsGateway` (Socket.IO WebSocket gateway).
- **`auth-integration/`** — JWT guard (`JwtAuthGuard`) that validates Bearer tokens and attaches the user to the request. Applied at the controller level.
- **`metrics/`** — Prometheus metrics via prom-client. Global `MetricsInterceptor` tracks HTTP request duration and counts. Exposed at `GET /metrics`.
- **`events/`** — `EventService` emits typed business events (`call.created`, `call.accepted`, `call.rejected`, `call.ended`, `call.missed`).

### Data flow

REST calls hit `CallsController` (JWT-guarded) → `CallsService` → `CallRepository`. WebSocket events are handled in `CallsGateway`, which also calls `CallsService` for state changes and routes WebRTC signals (offer/answer/ICE candidates) between participants using Socket.IO rooms named `call:{callId}`.

### Call state machine

```
RINGING → ACCEPTED → ENDED
        ↓
      MISSED (auto after 50s timeout)
        ↓
      REJECTED (if all participants reject)
```

### Key patterns

- **Global `ValidationPipe`** in `main.ts`: `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`.
- **Swagger** docs at `/docs` with Bearer auth configured.
- **CORS** enabled globally; WebSocket gateway uses `origin: '*'`.
- Repository methods return `Promise.resolve()` to support future database migration without changing service/controller layers.
