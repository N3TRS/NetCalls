# 📞 NetCalls — Microservicio de Llamadas de Voz/Video en Tiempo Real

<div align="center">

### 🛠️ Stack Tecnológico

![TypeScript](https://img.shields.io/badge/TypeScript-5.7.3-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11.0.1-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8.3-010101?style=for-the-badge&logo=socketdotio&logoColor=white)
![WebRTC](https://img.shields.io/badge/WebRTC-P2P-333333?style=for-the-badge&logo=webrtc&logoColor=white)

### ☁️ Infraestructura & Calidad

![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-CI/CD-2088FF?style=for-the-badge&logo=github-actions&logoColor=white)
![SonarQube](https://img.shields.io/badge/SonarQube-Quality-4E9BCD?style=for-the-badge&logo=sonarqube&logoColor=white)
![Azure](https://img.shields.io/badge/Azure-App_Service-0078D4?style=for-the-badge&logo=microsoftazure&logoColor=white)
![Prometheus](https://img.shields.io/badge/Prometheus-Metrics-E6522C?style=for-the-badge&logo=prometheus&logoColor=white)

### 🏗️ Arquitectura

![Modular](https://img.shields.io/badge/Architecture-Modular_NestJS-blueviolet?style=for-the-badge)
![Mediasoup](https://img.shields.io/badge/Mediasoup-SFU-FF6B35?style=for-the-badge)
![REST API](https://img.shields.io/badge/REST-API-009688?style=for-the-badge)

</div>

---

## 📑 Tabla de Contenidos

1. [👤 Integrantes](#1--integrantes)
2. [🎯 Objetivo del Microservicio](#2--objetivo-del-microservicio)
3. [⚡ Funcionalidades Principales](#3--funcionalidades-principales)
4. [📋 Estrategia de Versionamiento y Branches](#4--estrategia-de-versionamiento-y-branches)
5. [⚙️ Tecnologías Utilizadas](#5-️-tecnologías-utilizadas)
6. [🧩 Funcionalidad y Endpoints](#6--funcionalidad-y-endpoints)
7. [🏛️ Arquitectura, Patrones y Módulos](#7-️-arquitectura-patrones-y-módulos)
8. [⚠️ Manejo de Errores y Estados](#8-️-manejo-de-errores-y-estados)
9. [🧪 Evidencia de Pruebas y Cobertura](#9--evidencia-de-pruebas-y-cobertura)
10. [🗂️ Organización del Código](#10-️-organización-del-código)
11. [🔗 Conexiones con Servicios Externos](#11--conexiones-con-servicios-externos)
12. [🚀 Ejecución del Proyecto](#12--ejecución-del-proyecto)
13. [⚙️ Pipelines CI/CD](#13-️-pipelines-cicd)
14. [☁️ Despliegue en Azure](#14-️-despliegue-en-azure)
15. [🤝 Integrantes y Contribuciones](#15--integrantes-y-contribuciones)

---

## 1. 👤 Integrantes

- Tulio Riaño Sánchez
- Julian Camilo Lopez Barrero
- Juan Sebastián Puentes Julio
- David Alejandro Patacon Henao

---

## 2. 🎯 Objetivo del Microservicio

**NetCalls** gestiona el ciclo completo de llamadas de voz/video grupales dentro de **OmniCode**. Orquesta el estado de las llamadas (creación, aceptación, rechazo, fin), provee señalización WebSocket para conexiones peer-to-peer WebRTC, y coordina con un servidor Mediasoup SFU para enrutamiento de streams de audio y video. El estado de las llamadas se mantiene en memoria; no requiere base de datos persistente.

---

## 3. ⚡ Funcionalidades Principales

| Funcionalidad | Descripción |
|---|---|
| **Gestión de llamadas grupales** | Crea, acepta, rechaza, finaliza y abandona llamadas entre múltiples participantes. |
| **Notificaciones en tiempo real** | Difunde eventos de llamada a todos los participantes via Socket.IO. |
| **Señalización WebRTC P2P** | Relay de SDP offer/answer e ICE candidates entre pares. |
| **Mediasoup SFU** | Orquesta transportes, producers y consumers en el servidor SFU para audio/video. |
| **Timeout automático** | Llamadas sin respuesta pasan a `MISSED` tras 50 segundos. |
| **Invitación dinámica** | Agrega nuevos participantes a una llamada ya en curso. |
| **Métricas Prometheus** | Expone `http_requests_total` y latencia en `/metrics`. |

---

## 4. 📋 Estrategia de Versionamiento y Branches

### Estrategia de Ramas (Git Flow)

#### `main` — Estable, dispara CI/CD a Azure
#### `develop` — Integración de features
#### `feature/*` — Desarrollo específico

### 4.1 Convenciones para commits

```
feat: agregar endpoint POST /calls/:id/invite
fix: corregir timeout de llamada MISSED a 50s
test: agregar pruebas para mediasoup.service
docs: documentar flujo WebRTC en README
```

---

## 5. ⚙️ Tecnologías Utilizadas

| **Tecnología** | **Uso en el proyecto** |
|---|---|
| **TypeScript 5.7.3** | Lenguaje base. |
| **NestJS 11.0.1** | Framework REST + WebSocket. |
| **Node.js 20** | Runtime. |
| **Socket.IO 4.8.3** | WebSocket para señalización y notificaciones. |
| **@nestjs/jwt** | Validación de JWT en REST y WebSocket. |
| **prom-client 15.1.3** | Métricas Prometheus. |
| **class-validator** | Validación de DTOs. |
| **Jest 30** | Framework de pruebas unitarias. |
| **SonarCloud** | Análisis estático de calidad. |
| **GitHub Actions** | Pipeline CI/CD. |
| **Azure Web App** | Despliegue en producción. |

---

## 6. 🧩 Funcionalidad y Endpoints

### REST API (todas requieren `Authorization: Bearer <JWT>`)

---

#### 1️⃣ Crear Llamada — `POST /calls/create`

```json
{ "callerId": "user-a", "sessionId": "sess-001", "participants": ["user-b", "user-c"] }
```

**Response (201):** `CallResponseDto` con `status: RINGING`

---

#### 2️⃣ Aceptar — `POST /calls/:id/accept`

```json
{ "userId": "user-b", "sessionId": "sess-001" }
```

**Response (200):** `CallResponseDto` con `status: ACCEPTED`

---

#### 3️⃣ Rechazar — `POST /calls/:id/reject`

```json
{ "userId": "user-b", "sessionId": "sess-001" }
```

---

#### 4️⃣ Finalizar — `POST /calls/:id/end`

---

#### 5️⃣ Abandonar — `POST /calls/:id/leave`

```json
{ "userId": "user-b", "sessionId": "sess-001" }
```

---

#### 6️⃣ Unirse — `POST /calls/:id/join`

```json
{ "userId": "user-b", "sessionId": "sess-001" }
```

---

#### 7️⃣ Invitar — `POST /calls/:id/invite`

```json
{ "inviterId": "user-a", "sessionId": "sess-001", "inviteeIds": ["user-d"] }
```

---

#### 8️⃣ Consultar Llamada — `GET /calls/:id`

#### 9️⃣ Listar Llamadas — `GET /calls`

#### 🔟 Limpiar Llamadas de Usuario — `POST /calls/users/:userId/cleanup`

---

### WebSocket Gateway (`/calls/socket.io`)

**Autenticación:** JWT en header `Authorization` del handshake.

#### Eventos que emite el cliente

| Evento | Payload | Descripción |
|---|---|---|
| `register` | `{ userId, sessionId }` | Registrar usuario en el gateway |
| `join-call` | `{ callId, userId }` | Unirse al room |
| `leave-call` | `{ callId, userId }` | Salir del room |
| `ping` | — | Heartbeat |
| `webrtc:offer` | `{ to, signal }` | Relay oferta SDP |
| `webrtc:answer` | `{ to, signal }` | Relay respuesta SDP |
| `webrtc:ice-candidate` | `{ to, signal }` | Relay ICE candidate |
| `user:mute-changed` | `{ callId, userId, isMuted }` | Cambio de mute |

#### Señalización Mediasoup SFU

| Evento | Payload | Descripción |
|---|---|---|
| `ms:get-rtp-capabilities` | `{ callId }` | Capacidades RTP del router |
| `ms:create-transport` | `{ callId }` | Crear transport send/recv |
| `ms:connect-transport` | `{ callId, transportId, dtlsParameters }` | Conectar transport |
| `ms:produce` | `{ callId, transportId, kind, rtpParameters }` | Publicar stream |
| `ms:get-producers` | `{ callId }` | Listar producers activos |
| `ms:consume` | `{ callId, transportId, producerId, rtpCapabilities }` | Suscribirse a stream |
| `ms:resume-consumer` | `{ callId, consumerId }` | Reanudar consumer |

---

## 7. 🏛️ Arquitectura, Patrones y Módulos

### Flujo de una Llamada

```
Cliente A                   NetCalls                    Cliente B
   │                           │                            │
   ├─POST /calls/create ───────►│                            │
   │◄── { callId, RINGING } ───│                            │
   │                           ├── incoming-call (WS) ─────►│
   │── WS: join-call ──────────►│◄── WS: join-call ──────────│
   │── ms:get-rtp-capabilities ►│                            │
   │── ms:create-transport ────►│                            │
   │── ms:produce ─────────────►│── ms:new-producer (WS) ───►│
   │                           │◄── ms:consume ─────────────│
```

### Patrones Aplicados

| Patrón | Dónde | Propósito |
|---|---|---|
| **Repository (in-memory)** | `calls.repository.ts` | Map en memoria para estado de llamadas. Sin persistencia; estado efímero. |
| **Guard** | `JwtAuthGuard` | Valida JWT en REST. |
| **Mapper** | `call.mapper.ts` | Convierte `Call` entity → `CallResponseDto`. |
| **Proxy HTTP** | `mediasoup.service.ts` | Reenvía operaciones SFU al servidor Mediasoup externo. |
| **Interceptor** | `MetricsInterceptor` | Tracking de latencia Prometheus. |

---

## 8. ⚠️ Manejo de Errores y Estados

### Ciclo de Vida de una Llamada

```
createCall ──► RINGING
                  │
         ┌────────┴────────┐
         │                 │
    acceptCall         rejectCall (todos)
         │                 │
      ACCEPTED          REJECTED
         │
    ┌────┴─────┐
    │          │
  endCall  timeout (50s)
    │          │
  ENDED      MISSED
```

### Errores HTTP

| ⚠️ Escenario | 🔢 HTTP | Descripción |
|:---|:---:|:---|
| JWT inválido | 401 | Guard rechaza la petición |
| Llamada no encontrada | 404 | Repositorio no encuentra el ID |
| Acción inválida para estado actual | 409 | Lógica de servicio rechaza transición |
| Validación de DTO | 422 | `ValidationPipe` global |

---

## 9. 🧪 Evidencia de Pruebas y Cobertura

### Suites de prueba — 8 archivos

```
test/unit/
├── calls.controller.spec.ts
├── calls.service.spec.ts
├── calls.repository.spec.ts
├── gateway.spec.ts
├── call.mapper.spec.ts
├── event.service.spec.ts
├── jwt-auth.guard.spec.ts
└── app.e2e-spec.ts
```

### Cómo ejecutar

```bash
npm run test          # Unitarias
npm run test:cov      # Cobertura (LCOV)
```

---

## 10. 🗂️ Organización del Código

```
NetCalls/
│
├── src/
│   ├── main.ts                          # Bootstrap, CORS, Swagger
│   ├── app.module.ts
│   ├── auth-integration/
│   │   └── guards/jwt-auth.guard.ts     # JWT para REST
│   ├── calls/
│   │   ├── calls.controller.ts          # Endpoints REST /calls/*
│   │   ├── calls.service.ts             # Lógica de negocio + timeouts
│   │   ├── calls.repository.ts          # Map en memoria
│   │   ├── dto/                         # create, action, invite, response
│   │   ├── entities/call.entity.ts
│   │   ├── enum/callStatusEnum.ts       # RINGING | ACCEPTED | REJECTED | ENDED | MISSED
│   │   ├── gateway/gateway.ts           # Socket.IO gateway
│   │   ├── mappers/call.mapper.ts
│   │   └── mediasoup/mediasoup.service.ts  # HTTP client → SFU server
│   ├── events/event.service.ts          # Eventos de negocio
│   ├── metrics/                         # Prometheus
│   └── types/websocket.types.ts
│
├── test/unit/
├── .github/workflows/main_omnicode-api-calls.yml
├── package.json
├── sonar-project.properties
└── tsconfig.json
```

---

## 11. 🔗 Conexiones con Servicios Externos

| Servicio | Variable de Entorno | Descripción |
|---|---|---|
| **Mediasoup SFU** | `MEDIASOUP_SERVER_URL` | Servidor SFU para rooms de audio/video. Default: `http://localhost:3001`. |
| **JWT** (NetAuthentication) | `JWT_SECRET` | Secreto compartido para validar tokens. |
| **SonarCloud** | `SONAR_TOKEN` | Análisis estático (org: n3trs). |

---

## 12. 🚀 Ejecución del Proyecto

```bash
npm install
npm run start:dev
```

📍 **URL Local:** `http://localhost:3000`
🔌 **Socket path:** `/calls/socket.io`
📚 **Swagger:** `http://localhost:3000/api`

### ⚙️ Variables de Entorno

| Variable | Requerida | Default | Descripción |
|:---|:---:|:---|:---|
| `PORT` | ❌ | `3000` | Puerto del servidor |
| `JWT_SECRET` | ✅ | — | Clave JWT |
| `MEDIASOUP_SERVER_URL` | ❌ | `http://localhost:3001` | URL del SFU |

---

## 13. ⚙️ Pipelines CI/CD

### Pipeline — `main_omnicode-api-calls.yml`

**Triggers:** push a `main`, `workflow_dispatch`

```
Checkout → Node.js 20.x → npm install → build → test:cov
    → SonarCloud scan
    → Azure login (OIDC federated) → Deploy omnicode-api-calls
```

### Secrets requeridos

| Secret | Descripción |
|---|---|
| `SONAR_TOKEN` | SonarCloud (org: n3trs) |
| `AZUREAPPSERVICE_CLIENTID` | Service Principal |
| `AZUREAPPSERVICE_TENANTID` | Azure tenant |
| `AZUREAPPSERVICE_SUBSCRIPTIONID` | Azure subscription |

---

## 14. ☁️ Despliegue en Azure

| Recurso | Valor |
|---|---|
| **App Service** | `omnicode-api-calls` |
| **Runtime** | Node.js 20, Linux |
| **Slot** | Production |

---

## 15. 🤝 Integrantes y Contribuciones

<div align="center">

![Course](https://img.shields.io/badge/Course-ARSW-orange?style=for-the-badge)
![Year](https://img.shields.io/badge/Year-2026--1-blue?style=for-the-badge)

| 👤 Integrante | 🎓 Rol |
|:---|:---|
| Tulio Riaño Sánchez | Desarrollo y arquitectura |
| Julian Camilo Lopez Barrero | Desarrollo y arquitectura |
| Juan Sebastián Puentes Julio | Desarrollo y arquitectura |
| David Alejandro Patacon Henao | Desarrollo y arquitectura |

> 💡 **NetCalls** orquesta llamadas grupales en OmniCode combinando señalización Socket.IO, WebRTC peer-to-peer y un servidor Mediasoup SFU para streams de audio/video escalables.

**🎓 Escuela Colombiana de Ingeniería Julio Garavito**

</div>
