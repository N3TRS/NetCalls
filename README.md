# NetCalls — Backend de llamadas en tiempo real

Backend del microservicio **NetCalls**, responsable de gestionar llamadas de voz/video en tiempo real entre múltiples usuarios dentro del ecosistema **OMNICODE**.

Implementado con **NestJS + TypeScript**, expone una API REST protegida por JWT, un gateway WebSocket con **Socket.IO** para notificaciones en tiempo real, señalización **WebRTC** peer-to-peer, y un servidor de medios **Mediasoup SFU** para enrutamiento de audio/video.


## Tabla de contenidos

- [Descripción](#descripción)
- [Stack tecnológico](#stack-tecnológico)
- [Arquitectura](#arquitectura)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Instalación](#instalación)
- [Ejecución](#ejecución)
- [API REST](#api-rest)
- [WebSocket — Eventos de llamada](#websocket--eventos-de-llamada)
- [WebSocket — Señalización Mediasoup SFU](#websocket--señalización-mediasoup-sfu)
- [Estados de llamada](#estados-de-llamada)
- [Testing](#testing)

---

## Descripción

NetCalls permite:

- Crear llamadas grupales entre un `callerId` y múltiples `participants`.
- Aceptar o rechazar llamadas individualmente.
- Finalizar o abandonar una llamada activa.
- Invitar nuevos usuarios a una llamada en curso.
- Notificaciones en tiempo real via WebSocket para todos los participantes.
- Señalización WebRTC para conexiones peer-to-peer.
- Enrutamiento de media (audio/video) mediante Mediasoup SFU.
- Timeout automático: si nadie responde en 50 segundos la llamada pasa a `MISSED`.
- Métricas HTTP expuestas en `/metrics` compatibles con Prometheus.

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20 |
| Framework | NestJS 11 + TypeScript |
| WebSocket | Socket.IO |
| Señalización P2P | WebRTC (offer/answer/ICE) |
| Media Server | Mediasoup SFU |
| Autenticación | JWT (Bearer token) |
| Métricas | prom-client (Prometheus) |
| Testing | Jest 30 + ts-jest |
| CI/CD | GitHub Actions → Azure Web App |
| Análisis de calidad | SonarCloud |

---

## Arquitectura

```
Cliente A                        Servidor NetCalls                    Cliente B
   │                                     │                                │
   │── POST /calls/create ──────────────►│                                │
   │◄── { callId, status: RINGING } ─────│                                │
   │                                     │── incoming-call (WS) ─────────►│
   │                                     │                                │
   │── WS: join-call ───────────────────►│◄── WS: join-call ──────────────│
   │                                     │                                │
   │── WS: ms:get-rtp-capabilities ─────►│                                │
   │◄── rtpCapabilities ─────────────────│                                │
   │                                     │                                │
   │── WS: ms:create-transport ─────────►│                                │
   │◄── transportParams ─────────────────│                                │
   │                                     │                                │
   │── WS: ms:produce ──────────────────►│── ms:new-producer (WS) ───────►│
   │                                     │                                │
   │                                     │◄── ms:consume ─────────────────│
   │                                     │── consumerParams ─────────────►│
```

---

## Estructura del proyecto

```
src/
├── app.module.ts                  # Módulo raíz
├── main.ts                        # Bootstrap: CORS, validación global, puerto
│
├── auth-integration/
│   ├── auth-integration.module.ts
│   └── guards/
│       └── jwt-auth.guard.ts      # Guard JWT para endpoints REST
│
├── calls/
│   ├── calls.controller.ts        # Endpoints REST (/calls/*)
│   ├── calls.service.ts           # Lógica de negocio y orquestación
│   ├── calls.repository.ts        # Persistencia en memoria
│   │
│   ├── dto/
│   │   ├── create-call.dto.ts
│   │   ├── call-action.dto.ts
│   │   ├── invite-call.dto.ts
│   │   └── call-response.dto.ts
│   │
│   ├── entities/
│   │   └── call.entity.ts
│   │
│   ├── enum/
│   │   └── callStatusEnum.ts      # RINGING | ACCEPTED | REJECTED | ENDED | MISSED
│   │
│   ├── gateway/
│   │   └── gateway.ts             # WebSocket gateway (Socket.IO)
│   │
│   ├── mappers/
│   │   └── call.mapper.ts
│   │
│   └── mediasoup/
│       └── mediasoup.service.ts   # Gestión de rooms y transports SFU
│
├── events/
│   └── event.service.ts           # Eventos de negocio (console.log)
│
├── metrics/
│   ├── metrics.controller.ts      # GET /metrics (Prometheus scrape endpoint)
│   ├── metrics.interceptor.ts     # Interceptor HTTP para medir latencia
│   └── metrics.service.ts         # Registro de contadores e histogramas
│
└── types/
    └── websocket.types.ts
```

---

## Instalación

```bash
npm install
```

---

## Ejecución

```bash
# Desarrollo con hot-reload
npm run start:dev

# Producción
npm run build
npm run start:prod
```

La API queda disponible en `http://localhost:3000`.  
El socket path es `/calls/socket.io`.

---

## API REST

Todos los endpoints requieren el header:

```
Authorization: Bearer <JWT_TOKEN>
```

### Crear llamada

```
POST /calls/create
```

```json
{
  "callerId": "user-a",
  "participants": ["user-b", "user-c"]
}
```

### Aceptar llamada

```
POST /calls/:id/accept
```

```json
{ "userId": "user-b" }
```

### Rechazar llamada

```
POST /calls/:id/reject
```

```json
{ "userId": "user-b" }
```

### Finalizar llamada

```
POST /calls/:id/end
```

### Abandonar llamada

```
POST /calls/:id/leave
```

```json
{ "userId": "user-b" }
```

### Invitar a llamada

```
POST /calls/:id/invite
```

```json
{ "userId": "user-d" }
```

### Consultar llamada por ID

```
GET /calls/:id
```

### Listar todas las llamadas

```
GET /calls
```

---

## WebSocket — Eventos de llamada

Conectar al gateway:

```javascript
import { io } from 'socket.io-client';
const socket = io('https://omnicode-api-calls.azurewebsites.net', {
  path: '/calls/socket.io',
});
```

### Eventos que emite el cliente

| Evento | Payload | Descripción |
|---|---|---|
| `register` | `{ userId }` | Registrar usuario en el gateway |
| `join-call` | `{ callId, userId }` | Unirse al room de una llamada |
| `leave-call` | `{ callId, userId }` | Salir del room de una llamada |
| `ping` | — | Heartbeat |
| `webrtc:offer` | `{ to, signal }` | Reenviar oferta SDP a otro usuario |
| `webrtc:answer` | `{ to, signal }` | Reenviar respuesta SDP |
| `webrtc:ice-candidate` | `{ to, signal }` | Reenviar ICE candidate |
| `user:mute-changed` | `{ callId, userId, isMuted }` | Notificar cambio de mute |

### Eventos que recibe el cliente

| Evento | Descripción |
|---|---|
| `registered` | Confirmación de registro |
| `incoming-call` | Llamada entrante |
| `call-accepted` | Un participante aceptó |
| `call-rejected` | Un participante rechazó |
| `call-ended` | La llamada finalizó |
| `call-missed` | La llamada expiró sin respuesta |
| `call-in-progress` | Llamada activa al reconectar |
| `user-joined` | Un usuario se unió |
| `user-left` | Un usuario salió |
| `webrtc:offer` | Oferta SDP entrante |
| `webrtc:answer` | Respuesta SDP entrante |
| `webrtc:ice-candidate` | ICE candidate entrante |
| `user:mute-changed` | Cambio de mute de otro usuario |

---

## WebSocket — Señalización Mediasoup SFU

Flujo para publicar y consumir media:

### 1. Obtener capacidades RTP del router

```javascript
socket.emit('ms:get-rtp-capabilities', { callId }, (caps) => { ... });
```

### 2. Crear transport de envío (send) o recepción (recv)

```javascript
socket.emit('ms:create-transport', { callId }, (params) => { ... });
```

### 3. Conectar transport con parámetros DTLS

```javascript
socket.emit('ms:connect-transport', { callId, transportId, dtlsParameters });
```

### 4. Producir media (publicar)

```javascript
socket.emit('ms:produce', { callId, transportId, kind, rtpParameters }, ({ producerId }) => { ... });
// El resto del room recibe: ms:new-producer { userId, producerId, kind }
```

### 5. Listar producers existentes

```javascript
socket.emit('ms:get-producers', { callId }, ({ producers }) => { ... });
```

### 6. Consumir media de otro producer

```javascript
socket.emit('ms:consume', { callId, transportId, producerId, rtpCapabilities }, (params) => { ... });
```

### 7. Reanudar consumer

```javascript
socket.emit('ms:resume-consumer', { callId, consumerId });
```

---

## Estados de llamada

```
createCall ──► RINGING
                  │
         ┌────────┴────────┐
         │                 │
    acceptCall         rejectCall (todos)
         │                 │
      ACCEPTED          REJECTED
         │
    ┌────┴────┐
    │         │
  endCall  timeout (50s)
    │         │
  ENDED     MISSED
```

---

## Testing

```bash
# Ejecutar tests
npm run test

# Con reporte de cobertura
npm run test:cov
```

Los tests unitarios se encuentran en `test/unit/` y cubren: gateway, servicio de llamadas, repositorio, controlador, mapper, guard JWT y servicio de eventos.

El análisis de calidad con SonarCloud se ejecuta automáticamente en cada push a `main`.
