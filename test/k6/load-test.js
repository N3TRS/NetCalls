
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Métricas personalizadas
const wsConnectTime    = new Trend('ws_connect_time_ms', true);
const wsPingLatency    = new Trend('ws_ping_latency_ms', true);
const wsRegisterTime   = new Trend('ws_register_time_ms', true);
const msRtpCapTime     = new Trend('ms_rtp_capabilities_ms', true);
const msTransportTime  = new Trend('ms_create_transport_ms', true);
const msFullSetupTime  = new Trend('ms_full_sfu_setup_ms', true);
const apiErrorRate     = new Rate('api_error_rate');
const wsErrorRate      = new Rate('ws_error_rate');
const msErrorRate      = new Rate('ms_sfu_error_rate');
const callsCreated     = new Counter('calls_created_total');
const wsConnections    = new Counter('ws_connections_total');
export const options = {
  scenarios: {
    // Escenario A: Carga REST API — creación y consulta de llamadas
    rest_api_load: {
      executor: 'ramping-vus',
      exec: 'restApiScenario',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20  },  // Ramp-up gradual
        { duration: '1m',  target: 50  },  // Estado estable
        { duration: '30s', target: 100 },  // Pico de carga
        { duration: '1m',  target: 100 },  // Pico sostenido
        { duration: '30s', target: 0   },  // Ramp-down
      ],
      gracefulRampDown: '10s',
    },

    // Escenario B: Señalización WebSocket — conexiones simultáneas y latencia
    ws_signaling_load: {
      executor: 'ramping-vus',
      exec: 'wsSignalingScenario',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m',  target: 30 },
        { duration: '30s', target: 50 },
        { duration: '1m',  target: 50 },
        { duration: '30s', target: 0  },
      ],
      gracefulRampDown: '10s',
    },

    // Escenario C: Ciclo completo de llamada — flujo end-to-end realista
    call_lifecycle: {
      executor: 'constant-vus',
      exec: 'callLifecycleScenario',
      vus: 10,
      duration: '3m',
      startTime: '30s',
    },

    // Escenario D: Señalización SFU MediaSoup — flujo completo WebRTC
    mediasoup_sfu: {
      executor: 'ramping-vus',
      exec: 'mediasoupScenario',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 5  },
        { duration: '1m',  target: 15 },
        { duration: '1m',  target: 15 },
        { duration: '30s', target: 0  },
      ],
      startTime: '30s',
    },
  },

  thresholds: {
    // --- REST API ---
    // p95 < 200ms, p99 < 500ms — objetivo del escenario de calidad
    http_req_duration:            ['p(95)<200', 'p(99)<500'],
    http_req_failed:              ['rate<0.01'],
    api_error_rate:               ['rate<0.01'],

    // --- WebSocket ---
    // Latencia de señalización p95 < 100ms (tiempo real)
    ws_ping_latency_ms:           ['p(95)<100', 'p(99)<200'],
    ws_connect_time_ms:           ['p(95)<500', 'p(99)<1000'],
    ws_register_time_ms:          ['p(95)<150', 'p(99)<300'],
    ws_error_rate:                ['rate<0.01'],

    // --- MediaSoup SFU ---
    ms_rtp_capabilities_ms:       ['p(95)<300', 'p(99)<600'],
    ms_create_transport_ms:       ['p(95)<400', 'p(99)<800'],
    ms_full_sfu_setup_ms:         ['p(95)<800', 'p(99)<1500'],
    ms_sfu_error_rate:            ['rate<0.05'],

    // --- Disponibilidad mínima ---
    calls_created_total:          ['count>0'],
  },
};
// Configuración global
const BASE_URL   = __ENV.BASE_URL   || 'http://localhost:3003';
const WS_URL     = __ENV.WS_URL     || 'ws://localhost:3003';
const JWT_TOKEN  = __ENV.JWT_TOKEN  || '';
const SESSION_ID = __ENV.SESSION_ID || 'test-session-k6';

const HEADERS = {
  'Content-Type':  'application/json',
  'Authorization': `Bearer ${JWT_TOKEN}`,
};

// Helpers — protocolo Socket.IO v4 sobre WebSocket puro

/**
 * Construye un paquete Socket.IO v4:
 *   42["event",payload]           — sin ACK
 *   42<ackId>["event",payload]    — con ACK
 */
function sioEmit(event, payload, ackId) {
  const body = JSON.stringify([event, payload]);
  return ackId !== undefined ? `42${ackId}${body}` : `42${body}`;
}

/**
 * Parsea un mensaje raw de Socket.IO v4.
 * Retorna null si no es un evento o ACK reconocible.
 */
function sioParseMessage(raw) {
  if (typeof raw !== 'string') return null;

  // Engine.IO ping (servidor → cliente): '2'
  if (raw === '2') return { type: 'ping' };

  // Socket.IO namespace connect: '40...'
  if (raw.startsWith('40')) return { type: 'connect' };

  // Socket.IO EVENT: '42["event", ...]' o '42<N>["event", ...]'
  if (raw.startsWith('42')) {
    const rest = raw.slice(2);
    // Con ACK id
    const ackMatch = rest.match(/^(\d+)(\[.*\])$/s);
    if (ackMatch) {
      try {
        return { type: 'ack', ackId: parseInt(ackMatch[1]), data: JSON.parse(ackMatch[2]) };
      } catch (_) { return null; }
    }
    // Sin ACK id
    try {
      const parsed = JSON.parse(rest);
      return { type: 'event', event: parsed[0], data: parsed[1] };
    } catch (_) { return null; }
  }

  // ACK de servidor: '43<N>[...]'
  if (raw.startsWith('43')) {
    const rest = raw.slice(2);
    const ackMatch = rest.match(/^(\d+)(\[.*\])$/s);
    if (ackMatch) {
      try {
        return { type: 'ack', ackId: parseInt(ackMatch[1]), data: JSON.parse(ackMatch[2]) };
      } catch (_) { return null; }
    }
  }

  return null;
}

// Escenario A: REST API — operaciones CRUD de llamadas
export function restApiScenario() {
  const callerId     = `caller-${uuidv4().slice(0, 8)}`;
  const participantA = `user-${uuidv4().slice(0, 8)}`;
  const participantB = `user-${uuidv4().slice(0, 8)}`;

  group('REST: Crear llamada', () => {
    const payload = JSON.stringify({
      callerId,
      sessionId: SESSION_ID,
      participants: [participantA, participantB],
    });

    const res = http.post(`${BASE_URL}/calls/create`, payload, { headers: HEADERS });

    const ok = check(res, {
      'crear llamada → 201':           (r) => r.status === 201 || r.status === 200,
      'respuesta tiene callId':         (r) => {
        try { return JSON.parse(r.body).callId !== undefined; } catch { return false; }
      },
      'latencia < 200ms':              (r) => r.timings.duration < 200,
    });

    apiErrorRate.add(res.status >= 400);

    if (res.status >= 200 && res.status < 300) {
      callsCreated.add(1);
      const call = JSON.parse(res.body);
      const callId = call.callId;

      group('REST: Consultar llamada', () => {
        const getRes = http.get(`${BASE_URL}/calls/${callId}`, { headers: HEADERS });
        check(getRes, {
          'GET llamada → 200':    (r) => r.status === 200,
          'callId coincide':      (r) => {
            try { return JSON.parse(r.body).callId === callId; } catch { return false; }
          },
          'latencia GET < 150ms': (r) => r.timings.duration < 150,
        });
        apiErrorRate.add(getRes.status >= 400);
      });

      group('REST: Aceptar llamada', () => {
        const acceptPayload = JSON.stringify({ userId: participantA, sessionId: SESSION_ID });
        const acceptRes = http.post(
          `${BASE_URL}/calls/${callId}/accept`,
          acceptPayload,
          { headers: HEADERS },
        );
        check(acceptRes, {
          'aceptar llamada → 2xx': (r) => r.status >= 200 && r.status < 300,
          'latencia < 200ms':      (r) => r.timings.duration < 200,
        });
        apiErrorRate.add(acceptRes.status >= 400);
      });

      group('REST: Finalizar llamada', () => {
        const endRes = http.post(`${BASE_URL}/calls/${callId}/end`, null, { headers: HEADERS });
        check(endRes, {
          'finalizar llamada → 2xx': (r) => r.status >= 200 && r.status < 300,
          'latencia < 200ms':        (r) => r.timings.duration < 200,
        });
        apiErrorRate.add(endRes.status >= 400);
      });
    }
  });

  // GET /calls devuelve TODAS las llamadas sin paginación — solo ejecutar 1 de cada 10 iteraciones
  // para evitar que el payload creciente sature la red durante la prueba de carga
  if (Math.random() < 0.1) {
    group('REST: Listar todas las llamadas', () => {
      const listRes = http.get(`${BASE_URL}/calls`, { headers: HEADERS });
      check(listRes, {
        'listar llamadas → 200':   (r) => r.status === 200,
        'respuesta es array':       (r) => {
          try { return Array.isArray(JSON.parse(r.body)); } catch { return false; }
        },
        'latencia < 300ms':         (r) => r.timings.duration < 300,
      });
      apiErrorRate.add(listRes.status >= 400);
    });
  }

  sleep(Math.random() * 1 + 0.5); // think time: 0.5–1.5 s
}

// Escenario B: WebSocket — conectividad y latencia de señalización
export function wsSignalingScenario() {
  const userId    = `ws-user-${uuidv4().slice(0, 8)}`;
  const sessionId = SESSION_ID;

  // URL Socket.IO v4 sobre WebSocket puro
  const url = `${WS_URL}/calls/socket.io/?EIO=4&transport=websocket`;

  const connectStart = Date.now();
  let connected      = false;
  let registered     = false;
  let pingsSent      = 0;
  let ackCounter     = 1;

  // Mapa de ack pendientes: ackId → { sentAt, resolve }
  const pendingAcks = new Map();
  const registerStart = { ts: 0 };

  const response = ws.connect(url, { headers: { Origin: BASE_URL } }, (socket) => {

    socket.on('open', () => {
      wsConnections.add(1);
      connected = true;
      wsConnectTime.add(Date.now() - connectStart);

      // 1. Conectar al namespace por defecto (Socket.IO v4)
      socket.send('40');
    });

    socket.on('message', (raw) => {
      const msg = sioParseMessage(raw);
      if (!msg) return;

      switch (msg.type) {
        // Engine.IO ping → responder pong
        case 'ping':
          socket.send('3');
          break;

        // Namespace conectado → registrar usuario
        case 'connect':
          if (!registered) {
            registerStart.ts = Date.now();
            const ackId = ackCounter++;
            pendingAcks.set(ackId, { sentAt: Date.now() });
            socket.send(sioEmit('register', { userId, sessionId }, ackId));
          }
          break;

        // ACK de servidor (respuesta a register, join-call, etc.)
        case 'ack': {
          const pending = pendingAcks.get(msg.ackId);
          if (pending) {
            const latency = Date.now() - pending.sentAt;
            pendingAcks.delete(msg.ackId);

            if (!registered && registerStart.ts > 0) {
              wsRegisterTime.add(Date.now() - registerStart.ts);
              registered = true;

              // 2. Una vez registrado, iniciar ciclo de ping de aplicación
              socket.setInterval(() => {
                if (pingsSent >= 5) {
                  socket.close();
                  return;
                }
                const pingAckId = ackCounter++;
                pendingAcks.set(pingAckId, { sentAt: Date.now(), isPing: true });
                socket.send(sioEmit('ping', {}, pingAckId));
                pingsSent++;
              }, 1000);
            } else if (pending.isPing) {
              wsPingLatency.add(latency);
              check(latency, { 'ping latencia < 100ms': (v) => v < 100 });
            }
          }
          break;
        }

        // Eventos del servidor (incoming-call, call-accepted, etc.)
        case 'event':
          // Registrar pero no bloquear
          break;
      }
    });

    socket.on('error', (e) => {
      wsErrorRate.add(1);
    });

    socket.on('close', () => {
      wsErrorRate.add(!registered ? 1 : 0);
    });

    // Timeout de seguridad: cerrar después de 12 segundos
    socket.setTimeout(() => {
      socket.close();
    }, 12000);
  });

  check(response, {
    'WebSocket handshake exitoso': (r) => r && r.status === 101,
  });

  sleep(Math.random() * 0.5 + 0.2);
}

// Escenario C: Ciclo completo de llamada (flujo realista end-to-end)
export function callLifecycleScenario() {
  // Generar IDs únicos por VU
  const callerId   = `lifecycle-caller-${__VU}-${__ITER}`;
  const callee     = `lifecycle-callee-${__VU}-${__ITER}`;

  // Fase 1: Crear llamada vía REST
  let callId;

  group('Lifecycle: Crear llamada', () => {
    const res = http.post(
      `${BASE_URL}/calls/create`,
      JSON.stringify({ callerId, sessionId: SESSION_ID, participants: [callee] }),
      { headers: HEADERS },
    );

    const ok = check(res, {
      'crear llamada → 2xx': (r) => r.status >= 200 && r.status < 300,
    });
    apiErrorRate.add(!ok);

    if (ok && res.status < 300) {
      try { callId = JSON.parse(res.body).callId; } catch (_) {}
    }
  });

  if (!callId) {
    sleep(1);
    return;
  }

  callsCreated.add(1);
  sleep(0.5); // simular delay del usuario

  // Fase 2: Callee acepta por REST
  group('Lifecycle: Aceptar llamada', () => {
    const res = http.post(
      `${BASE_URL}/calls/${callId}/accept`,
      JSON.stringify({ userId: callee, sessionId: SESSION_ID }),
      { headers: HEADERS },
    );
    const ok = check(res, {
      'aceptar → 2xx': (r) => r.status >= 200 && r.status < 300,
    });
    apiErrorRate.add(!ok);
  });

  sleep(0.3);

  // Fase 3: Señalización WebSocket — join-call y pings durante la llamada
  group('Lifecycle: Señalización durante llamada', () => {
    const url = `${WS_URL}/calls/socket.io/?EIO=4&transport=websocket`;
    let ackCounter = 1;
    let namespaceConnected = false;
    let userRegistered = false;
    let joinedCall = false;
    let messagesExchanged = 0;
    const maxMessages = 8;
    const pending = new Map();
    const registerTs = { v: 0 };

    ws.connect(url, { headers: { Origin: BASE_URL } }, (socket) => {
      socket.on('open', () => { socket.send('40'); });

      socket.on('message', (raw) => {
        const msg = sioParseMessage(raw);
        if (!msg) return;

        if (msg.type === 'ping') { socket.send('3'); return; }

        if (msg.type === 'connect' && !namespaceConnected) {
          namespaceConnected = true;
          registerTs.v = Date.now();
          const ack = ackCounter++;
          pending.set(ack, { sentAt: Date.now(), action: 'register' });
          socket.send(sioEmit('register', { userId: callerId, sessionId: SESSION_ID }, ack));
          return;
        }

        if (msg.type === 'ack') {
          const p = pending.get(msg.ackId);
          if (!p) return;
          pending.delete(msg.ackId);
          const latency = Date.now() - p.sentAt;

          if (p.action === 'register') {
            wsRegisterTime.add(Date.now() - registerTs.v);
            userRegistered = true;

            // Unirse al call room
            const ack = ackCounter++;
            pending.set(ack, { sentAt: Date.now(), action: 'join' });
            socket.send(sioEmit('join-call', { callId }, ack));

          } else if (p.action === 'join') {
            joinedCall = true;
            // Simular intercambio de pings durante la llamada
            socket.setInterval(() => {
              if (messagesExchanged >= maxMessages) {
                socket.close();
                return;
              }
              const ack = ackCounter++;
              pending.set(ack, { sentAt: Date.now(), action: 'ping' });
              socket.send(sioEmit('ping', {}, ack));
              messagesExchanged++;
            }, 500);

          } else if (p.action === 'ping') {
            wsPingLatency.add(latency);
          }
        }
      });

      socket.on('error', () => wsErrorRate.add(1));

      socket.setTimeout(() => socket.close(), 8000);
    });
  });

  sleep(0.5);

  // Fase 4: Terminar la llamada
  group('Lifecycle: Finalizar llamada', () => {
    const res = http.post(`${BASE_URL}/calls/${callId}/end`, null, { headers: HEADERS });
    const ok = check(res, {
      'finalizar → 2xx': (r) => r.status >= 200 && r.status < 300,
    });
    apiErrorRate.add(!ok);
  });

  sleep(Math.random() * 1 + 0.5);
}

// Escenario D: Señalización SFU MediaSoup completa
// Simula el flujo real: join → get-rtp-capabilities → create-transport →
//                       connect-transport → produce → get-producers

// Parámetros RTP mínimos para audio (opus) — values reales que acepta mediasoup
const FAKE_RTP_PARAMETERS = {
  mid: '0',
  codecs: [{
    mimeType: 'audio/opus',
    payloadType: 111,
    clockRate: 48000,
    channels: 2,
    parameters: { minptime: 10, useinbandfec: 1 },
    rtcpFeedback: [],
  }],
  headerExtensions: [],
  encodings: [{ ssrc: Math.floor(Math.random() * 0xFFFFFFFF) }],
  rtcp: { cname: 'k6-test', reducedSize: true },
};

// DTLS parameters mínimos (simulados — mediasoup los valida en connect-transport)
const FAKE_DTLS_PARAMETERS = {
  role: 'client',
  fingerprints: [{
    algorithm: 'sha-256',
    value: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
  }],
};

export function mediasoupScenario() {
  const callerId   = `ms-caller-${__VU}-${__ITER}`;
  const calleeId   = `ms-callee-${__VU}-${__ITER}`;

  // 1. Crear la llamada vía REST
  let callId;
  {
    const res = http.post(
      `${BASE_URL}/calls/create`,
      JSON.stringify({ callerId, sessionId: SESSION_ID, participants: [calleeId] }),
      { headers: HEADERS },
    );
    if (res.status < 200 || res.status >= 300) {
      apiErrorRate.add(1);
      sleep(1);
      return;
    }
    try { callId = JSON.parse(res.body).callId; } catch (_) { sleep(1); return; }
    callsCreated.add(1);
    apiErrorRate.add(0);
  }

  sleep(0.2);

  // 2. Aceptar la llamada (callee)
  {
    const res = http.post(
      `${BASE_URL}/calls/${callId}/accept`,
      JSON.stringify({ userId: calleeId, sessionId: SESSION_ID }),
      { headers: HEADERS },
    );
    apiErrorRate.add(res.status >= 400 ? 1 : 0);
  }

  sleep(0.2);

  // 3. Señalización SFU completa vía WebSocket
  const url = `${WS_URL}/calls/socket.io/?EIO=4&transport=websocket`;
  let ackCtr = 1;
  const pend = new Map();

  // Estado de la máquina de estados del flujo SFU
  const state = {
    nsConnected: false,
    registered: false,
    joined: false,
    rtpCaps: null,
    transportId: null,
    transportConnected: false,
    produced: false,
    setupStart: 0,
    step: 'register',   // register → join → rtp → transport → connect → produce → done
  };

  const sfuSetupStart = Date.now();

  ws.connect(url, { headers: { Origin: BASE_URL } }, (socket) => {
    socket.on('open', () => { socket.send('40'); });

    socket.on('message', (raw) => {
      const msg = sioParseMessage(raw);
      if (!msg) return;

      if (msg.type === 'ping') { socket.send('3'); return; }

      // Namespace conectado → registrar
      if (msg.type === 'connect' && !state.nsConnected) {
        state.nsConnected = true;
        const ack = ackCtr++;
        pend.set(ack, { sentAt: Date.now(), step: 'register' });
        socket.send(sioEmit('register', { userId: callerId, sessionId: SESSION_ID }, ack));
        return;
      }

      if (msg.type !== 'ack') return;
      const p = pend.get(msg.ackId);
      if (!p) return;
      pend.delete(msg.ackId);

      const latency = Date.now() - p.sentAt;
      const data = Array.isArray(msg.data) ? msg.data[0] : msg.data;

      switch (p.step) {

        case 'register': {
          wsRegisterTime.add(latency);
          state.registered = true;
          // Unirse al call room
          const ack = ackCtr++;
          pend.set(ack, { sentAt: Date.now(), step: 'join' });
          socket.send(sioEmit('join-call', { callId }, ack));
          break;
        }

        case 'join': {
          if (data && data.error) { msErrorRate.add(1); socket.close(); break; }
          state.joined = true;
          // Obtener RTP capabilities del router MediaSoup
          const ack = ackCtr++;
          pend.set(ack, { sentAt: Date.now(), step: 'rtp' });
          socket.send(sioEmit('ms:get-rtp-capabilities', { callId }, ack));
          break;
        }

        case 'rtp': {
          msRtpCapTime.add(latency);
          if (data && data.error) { msErrorRate.add(1); socket.close(); break; }
          msErrorRate.add(0);
          state.rtpCaps = data;
          // Crear transport de envío
          const ack = ackCtr++;
          pend.set(ack, { sentAt: Date.now(), step: 'transport' });
          socket.send(sioEmit('ms:create-transport', { callId }, ack));
          break;
        }

        case 'transport': {
          msTransportTime.add(latency);
          if (data && data.error) { msErrorRate.add(1); socket.close(); break; }
          msErrorRate.add(0);
          state.transportId = data && data.id;
          // Conectar transport con DTLS
          const ack = ackCtr++;
          pend.set(ack, { sentAt: Date.now(), step: 'connect' });
          socket.send(sioEmit('ms:connect-transport', {
            callId,
            transportId: state.transportId,
            dtlsParameters: FAKE_DTLS_PARAMETERS,
          }, ack));
          break;
        }

        case 'connect': {
          if (data && data.error) { msErrorRate.add(1); socket.close(); break; }
          state.transportConnected = true;
          // Publicar stream de audio simulado
          const ack = ackCtr++;
          pend.set(ack, { sentAt: Date.now(), step: 'produce' });
          socket.send(sioEmit('ms:produce', {
            callId,
            transportId: state.transportId,
            kind: 'audio',
            rtpParameters: FAKE_RTP_PARAMETERS,
          }, ack));
          break;
        }

        case 'produce': {
          const totalSetup = Date.now() - sfuSetupStart;
          msFullSetupTime.add(totalSetup);
          if (data && data.error) {
            msErrorRate.add(1);
          } else {
            msErrorRate.add(0);
            state.produced = true;
          }
          check(totalSetup, { 'SFU setup completo < 800ms': (v) => v < 800 });
          socket.close();
          break;
        }
      }
    });

    socket.on('error', () => { wsErrorRate.add(1); msErrorRate.add(1); });
    socket.setTimeout(() => socket.close(), 15000);
  });

  sleep(0.3);

  // 4. Terminar la llamada
  http.post(`${BASE_URL}/calls/${callId}/end`, null, { headers: HEADERS });

  sleep(Math.random() * 0.5 + 0.3);
}

// Setup: validar conectividad antes de la prueba
export function setup() {
  console.log(`[k6] Iniciando prueba contra: ${BASE_URL}`);
  console.log(`[k6] WS endpoint: ${WS_URL}/calls/socket.io/`);

  if (!JWT_TOKEN) {
    console.warn('[k6] ADVERTENCIA: JWT_TOKEN no definido. Las rutas protegidas retornarán 401.');
  }

  // Health check básico
  const metricsRes = http.get(`${BASE_URL}/metrics`);
  check(metricsRes, {
    'servidor disponible (metrics)': (r) => r.status === 200,
  });

  return { startTime: new Date().toISOString() };
}


export function teardown(data) {
  console.log(`[k6] Prueba finalizada. Inicio: ${data.startTime} — Fin: ${new Date().toISOString()}`);
}
