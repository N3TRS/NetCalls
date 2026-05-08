import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as mediasoup from 'mediasoup';

type Worker = mediasoup.types.Worker;
type Router = mediasoup.types.Router;
type WebRtcTransport = mediasoup.types.WebRtcTransport;
type Producer = mediasoup.types.Producer;
type Consumer = mediasoup.types.Consumer;
type RtpCapabilities = mediasoup.types.RtpCapabilities;
type DtlsParameters = mediasoup.types.DtlsParameters;
type MediaKind = mediasoup.types.MediaKind;
type RtpParameters = mediasoup.types.RtpParameters;

interface ProducerInfo {
  userId: string;
  producer: Producer;
  kind: 'audio' | 'video';
}

interface TransportInfo {
  transport: WebRtcTransport;
  userId: string;
}

interface RoomData {
  router: Router;
  producers: Map<string, ProducerInfo>;
  transports: Map<string, TransportInfo>;
  consumers: Map<string, Consumer>;
}

@Injectable()
export class MediasoupService implements OnModuleInit, OnModuleDestroy {
  private worker!: Worker;
  private rooms = new Map<string, RoomData>();
  private readonly logger = new Logger(MediasoupService.name);

  private readonly mediaCodecs: mediasoup.types.RtpCodecCapability[] = [
    {
      kind: 'audio',
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2,
    },
    {
      kind: 'video',
      mimeType: 'video/VP8',
      clockRate: 90000,
      parameters: { 'x-google-start-bitrate': 1000 },
    },
    {
      kind: 'video',
      mimeType: 'video/H264',
      clockRate: 90000,
      parameters: {
        'packetization-mode': 1,
        'profile-level-id': '4d0032',
        'level-asymmetry-allowed': 1,
      },
    },
  ];

  async onModuleInit(): Promise<void> {
    await this.startWorker();
  }

  private async startWorker(): Promise<void> {
    this.worker = await mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: parseInt(process.env.MEDIASOUP_RTC_MIN_PORT ?? '40000'),
      rtcMaxPort: parseInt(process.env.MEDIASOUP_RTC_MAX_PORT ?? '49999'),
    });

    this.worker.on('died', async () => {
      this.logger.error('MediaSoup worker died — restarting');
      await this.startWorker();
    });

    this.logger.log('MediaSoup worker started');
  }

  async onModuleDestroy(): Promise<void> {
    this.worker?.close();
  }

  async ensureRoom(callId: string): Promise<RoomData> {
    if (!this.rooms.has(callId)) {
      const router = await this.worker.createRouter({
        mediaCodecs: this.mediaCodecs,
      });
      this.rooms.set(callId, {
        router,
        producers: new Map(),
        transports: new Map(),
        consumers: new Map(),
      });
      this.logger.log(`Room created for call ${callId}`);
    }
    return this.rooms.get(callId)!;
  }

  getRouterRtpCapabilities(callId: string): RtpCapabilities {
    const room = this.rooms.get(callId);
    if (!room) throw new Error(`Room not found: ${callId}`);
    return room.router.rtpCapabilities;
  }

  async createTransport(
    callId: string,
    userId: string,
  ): Promise<{
    id: string;
    iceParameters: mediasoup.types.IceParameters;
    iceCandidates: mediasoup.types.IceCandidate[];
    dtlsParameters: DtlsParameters;
  }> {
    const room = this.rooms.get(callId);
    if (!room) throw new Error(`Room not found: ${callId}`);

    const announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP ?? '127.0.0.1';

    const transport = await room.router.createWebRtcTransport({
      listenIps: [{ ip: '0.0.0.0', announcedIp }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 600_000,
    });

    room.transports.set(transport.id, { transport, userId });
    this.logger.log(`Transport ${transport.id} for user ${userId}`);

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async connectTransport(
    callId: string,
    transportId: string,
    dtlsParameters: DtlsParameters,
  ): Promise<void> {
    const room = this.rooms.get(callId);
    if (!room) throw new Error(`Room not found: ${callId}`);
    const info = room.transports.get(transportId);
    if (!info) throw new Error(`Transport ${transportId} not found`);
    await info.transport.connect({ dtlsParameters });
  }

  async produce(
    callId: string,
    transportId: string,
    userId: string,
    kind: MediaKind,
    rtpParameters: RtpParameters,
  ): Promise<string> {
    const room = this.rooms.get(callId);
    if (!room) throw new Error(`Room not found: ${callId}`);
    const info = room.transports.get(transportId);
    if (!info) throw new Error(`Transport ${transportId} not found`);

    const producer = await info.transport.produce({ kind, rtpParameters });
    room.producers.set(producer.id, {
      userId,
      producer,
      kind: kind as 'audio' | 'video',
    });

    producer.on('transportclose', () => {
      room.producers.delete(producer.id);
    });

    this.logger.log(`Producer ${producer.id} (${kind}) for user ${userId}`);
    return producer.id;
  }

  async consume(
    callId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities,
  ): Promise<{
    id: string;
    producerId: string;
    kind: MediaKind;
    rtpParameters: RtpParameters;
  }> {
    const room = this.rooms.get(callId);
    if (!room) throw new Error(`Room not found: ${callId}`);
    const transportInfo = room.transports.get(transportId);
    if (!transportInfo) throw new Error(`Transport ${transportId} not found`);

    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error(`Cannot consume producer ${producerId}`);
    }

    const consumer = await transportInfo.transport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });

    room.consumers.set(consumer.id, consumer);
    this.logger.log(`Consumer ${consumer.id} for producer ${producerId}`);

    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  async resumeConsumer(callId: string, consumerId: string): Promise<void> {
    const room = this.rooms.get(callId);
    if (!room) return;
    const consumer = room.consumers.get(consumerId);
    if (consumer && !consumer.closed) await consumer.resume();
  }

  getProducers(
    callId: string,
  ): { userId: string; producerId: string; kind: string }[] {
    const room = this.rooms.get(callId);
    if (!room) return [];
    return Array.from(room.producers.entries()).map(([id, info]) => ({
      userId: info.userId,
      producerId: id,
      kind: info.kind,
    }));
  }

  // Closes all producers/transports for a user and returns the closed producer IDs
  // so they can be broadcast to the call room.
  closeUserResources(callId: string, userId: string): string[] {
    const room = this.rooms.get(callId);
    if (!room) return [];

    const closedIds: string[] = [];

    for (const [id, info] of room.producers.entries()) {
      if (info.userId === userId) {
        if (!info.producer.closed) info.producer.close();
        room.producers.delete(id);
        closedIds.push(id);
      }
    }

    for (const [id, info] of room.transports.entries()) {
      if (info.userId === userId) {
        if (!info.transport.closed) info.transport.close();
        room.transports.delete(id);
      }
    }

    if (closedIds.length > 0) {
      this.logger.log(
        `Closed mediasoup resources for user ${userId} in call ${callId}: [${closedIds.join(', ')}]`,
      );
    }
    return closedIds;
  }

  closeRoom(callId: string): void {
    const room = this.rooms.get(callId);
    if (room) {
      if (!room.router.closed) room.router.close();
      this.rooms.delete(callId);
      this.logger.log(`Room closed for call ${callId}`);
    }
  }
}
