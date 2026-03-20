# NetCalls Backend

Backend API para gestionar llamadas entre usuarios.

Implementado con NestJS + TypeScript y un repositorio en memoria (sin base de datos por ahora).

## Descripcion

Este servicio permite:

- Crear una llamada entre `callerId` y `calleeId`.
- Aceptar una llamada en estado `RINGING`.
- Rechazar una llamada en estado `RINGING`.
- Finalizar una llamada en estado `ACCEPTED`.
- Consultar una llamada por id.

La aplicacion expone los endpoints bajo el prefijo `calls` y corre por defecto en el puerto `3000`.

Base URL local:

```txt
http://localhost:3000
```

## Stack

- Node.js
- NestJS 11
- TypeScript
- Jest (testing)

## Estructura del proyecto

```txt
src/
  app.module.ts
  main.ts
  calls/
    calls.controller.ts
    calls.service.ts
    calls.repository.ts
    dto/
      create-call.dto.ts
      call-action.dto.ts
      call-response.dto.ts
    entities/
      call.entity.ts
    enum/
      callStatusEnum.ts
  events/
    event.service.ts
```

## Instalacion

Con `pnpm` (recomendado por lockfile):

```bash
pnpm install
```

Opcional con `npm`:

```bash
npm install
```

## Ejecucion

Modo desarrollo:

```bash
pnpm run start:dev
```

Ejecucion normal:

```bash
pnpm run start
```

Produccion (requiere build previo):

```bash
pnpm run build
pnpm run start:prod
```

## API

### 1) Crear llamada

- Metodo: `POST`
- Ruta: `/calls/create`

Request body:

```json
{
  "callerId": "user-a",
  "calleeId": "user-b"
}
```

Respuesta esperada (ejemplo):

```json
{
  "id": "a4c0a7d6-72e8-4a2d-885f-dbe338a00f3c",
  "callerId": "user-a",
  "calleeId": "user-b",
  "status": "RINGING",
  "createdAt": "2026-03-20T19:22:31.331Z"
}
```

### 2) Aceptar llamada

- Metodo: `POST`
- Ruta: `/calls/:id/accept`

Ejemplo:

```bash
curl -X POST http://localhost:3000/calls/<CALL_ID>/accept
```

### 3) Rechazar llamada

- Metodo: `POST`
- Ruta: `/calls/:id/reject`

Ejemplo:

```bash
curl -X POST http://localhost:3000/calls/<CALL_ID>/reject
```

### 4) Finalizar llamada

- Metodo: `POST`
- Ruta: `/calls/:id/end`

Ejemplo:

```bash
curl -X POST http://localhost:3000/calls/<CALL_ID>/end
```

### 5) Consultar llamada por id

- Metodo: `GET`
- Ruta: `/calls/:id`

Ejemplo:

```bash
curl http://localhost:3000/calls/<CALL_ID>
```

## Estados de llamada

El enum de estados disponibles es:

- `RINGING`
- `ACCEPTED`
- `REJECTED`
- `ENDED`
- `MISSED`

Transiciones implementadas actualmente:

- `createCall` crea en `RINGING`.
- `acceptCall` cambia `RINGING -> ACCEPTED`.
- `rejectCall` cambia `RINGING -> REJECTED`.
- `endCall` cambia `ACCEPTED -> ENDED`.

## Eventos

Cada accion emite un evento por consola via `EventService`:

- `call.created`
- `call.accepted`
- `call.rejected`
- `call.ended`

Actualmente estos eventos se registran con `console.log`.

## Pruebas

Ejecutar pruebas unitarias:

```bash
pnpm run test
```

Ejecutar pruebas e2e:

```bash
pnpm run test:e2e
```

Cobertura:

```bash
pnpm run test:cov
```

