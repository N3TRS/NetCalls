# NetCalls Backend

Backend API para gestionar llamadas entre múltiples usuarios.

Implementado con NestJS + TypeScript, WebSocket para comunicación real-time, y un repositorio en memoria (sin base de datos por ahora).

## Descripcion

Este servicio permite:

- Crear una llamada grupal entre un `callerId` y múltiples `participants`.
- Aceptar una llamada en estado `RINGING` o `ACCEPTED` (cada usuario por separado).
- Rechazar una llamada en estado `RINGING` o `ACCEPTED` (cada usuario por separado).
- Finalizar una llamada en estado `ACCEPTED`.
- Consultar una llamada por id.
- WebSocket real-time para notificar cambios en las llamadas.

La aplicacion expone los endpoints bajo el prefijo `calls` y corre por defecto en el puerto `3000`.

Base URL local:

```txt
http://localhost:3000
```

## Stack

- Node.js
- NestJS 11
- TypeScript
- Socket.IO (WebSocket real-time)
- Jest (testing)
- Prettier (code formatting)

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
    gateway/
      gateway.ts
    mappers/
      call.mapper.ts
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
  "participants": ["user-b", "user-c", "user-d"]
}
```

Respuesta esperada (ejemplo):

```json
{
  "callId": "a4c0a7d6-72e8-4a2d-885f-dbe338a00f3c",
  "callerId": "user-a",
  "participants": ["user-b", "user-c", "user-d"],
  "acceptedUsers": [],
  "rejectedUsers": [],
  "status": "RINGING",
  "createdAt": "2026-03-20T19:22:31.331Z"
}
```

### 2) Aceptar llamada

- Metodo: `POST`
- Ruta: `/calls/:id/accept`

Request body:

```json
{
  "userId": "user-b"
}
```

Ejemplo:

```bash
curl -X POST http://localhost:3000/calls/<CALL_ID>/accept -H "Content-Type: application/json" -d '{"userId":"user-b"}'
```

### 3) Rechazar llamada

- Metodo: `POST`
- Ruta: `/calls/:id/reject`

Request body:

```json
{
  "userId": "user-b"
}
```

Ejemplo:

```bash
curl -X POST http://localhost:3000/calls/<CALL_ID>/reject -H "Content-Type: application/json" -d '{"userId":"user-b"}'
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

- `createCall` crea en `RINGING` y registra todos los participantes.
- `acceptCall` permite a cada usuario aceptar en estado `RINGING` o `ACCEPTED`. Cuando el primero acepta, cambia a `ACCEPTED`.
- `rejectCall` permite a cada usuario rechazar. Si todos los participantes rechazan en estado `RINGING`, la llamada cambia a `REJECTED`.
- `endCall` cambia `ACCEPTED -> ENDED`.
- Timeout automático: si nadie responde en 50 segundos, la llamada cambia a `MISSED`.

## WebSocket Events

El gateway emite eventos en tiempo real:

- `incoming-call`: Se emite cuando se crea una llamada, solo el receptor recibe.
- `call-accepted`: Se emite cuando un usuario acepta.
- `call-rejected`: Se emite cuando un usuario rechaza.
- `call-ended`: Se emite cuando la llamada finaliza.
- `call-missed`: Se emite cuando la llamada expira sin respuesta.

Para recibir eventos, primero regístrate:

```javascript
socket.emit('register', 'user-id');
socket.on('incoming-call', (call) => {
  console.log('Llamada entrante:', call);
});
```

## Eventos de negocio

Cada acción emite un evento por consola via `EventService`:

- `call.created`: Cuando se crea una llamada.
- `call.accepted`: Cuando un usuario acepta.
- `call.rejected`: Cuando todos rechazan.
- `call.ended`: Cuando finaliza la llamada.
- `call.missed`: Cuando expira sin respuesta.

Actualmente estos eventos se registran con `console.log` e inyectados en el servicio.

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
