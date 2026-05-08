import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Call } from '../entities/call.entity';
import { forwardRef, Inject, Logger } from '@nestjs/common';
import { CallRepository } from '../calls.repository';
import { CallService } from '../calls.service';
import { MediasoupService } from '../mediasoup/mediasoup.service';
import { CallStatus } from '../enum/callStatusEnum';

@WebSocketGateway({
  path: '/calls/socket.io',
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
})
export class CallGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(CallGateway.name);
  private users = new Map<string, string>();
  private sockets = new Map<string, string>();
  private callRooms = new Map<string, Set<string>>();

  constructor(
    private readonly repo: CallRepository,
    @Inject(forwardRef(() => CallService))
    private readonly callService: CallService,
    private readonly mediasoupService: MediasoupService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    const userId = this.sockets.get(client.id);
    if (userId) {
      this.logger.log(`User ${userId} disconnected (socket: ${client.id})`);
      this.users.delete(userId);
      this.sockets.delete(client.id);

      this.callRooms.forEach((users, callId) => {
        if (users.has(userId)) {
          users.delete(userId);
          if (users.size === 0) {
            this.callRooms.delete(callId);
          }
        }
      });

      this.repo.findActiveCall(userId).then((call) => {
        if (call) {
          this.callService.leaveCall(call.id, userId).catch(() => {});
          this.logger.log(`User ${userId} left call ${call.id} on disconnect`);
        }
      });
    }
  }

  @SubscribeMessage('register')
  handleRegister(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    const userId = typeof data === 'string' ? data : data?.userId;

    if (!userId) {
      this.logger.warn(`Registration attempt without userId: ${client.id}`);
      this.logger.warn(`Received data:`, data);
      return { success: false, error: 'userId is required' };
    }

    const oldSocketId = this.users.get(userId);
    if (oldSocketId) {
      this.logger.log(
        `User ${userId} was already registered with socket ${oldSocketId}, updating to ${client.id}`,
      );
      this.sockets.delete(oldSocketId);
    }

    this.users.set(userId, client.id);
    this.sockets.set(client.id, userId);

    this.logger.log(`User ${userId} registered with socket ${client.id}`);

    client.emit('registered', { success: true, userId, socketId: client.id });

    // Notify late joiners about any ongoing call they are not part of
    this.repo.findAll().then((calls) => {
      const activeCall = calls.find(
        (c) =>
          c.status === CallStatus.ACCEPTED &&
          !c.activeParticipants.includes(userId),
      );
      if (activeCall) {
        client.emit('call-in-progress', activeCall);
      }
    });

    return { success: true, userId, socketId: client.id };
  }

  @SubscribeMessage('join-call')
  handleJoinCall(
    @MessageBody() data: { callId: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { callId, userId } = data;

    if (!this.callRooms.has(callId)) {
      this.callRooms.set(callId, new Set());
    }

    const room = this.callRooms.get(callId);
    if (room) {
      room.add(userId);
    }
    client.join(`call:${callId}`);

    this.logger.log(`User ${userId} joined call ${callId}`);
    return { success: true, callId, userId };
  }

  @SubscribeMessage('leave-call')
  handleLeaveCall(
    @MessageBody() data: { callId: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { callId, userId } = data;

    const room = this.callRooms.get(callId);
    if (room) {
      room.delete(userId);
      if (room.size === 0) {
        this.callRooms.delete(callId);
      }
    }

    client.leave(`call:${callId}`);

    this.logger.log(`User ${userId} left call ${callId}`);
    return { success: true, callId, userId };
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    const userId = this.sockets.get(client.id);
    return { pong: true, timestamp: Date.now(), userId };
  }

  // MediaSoup SFU signaling

  @SubscribeMessage('ms:get-rtp-capabilities')
  async handleGetRtpCapabilities(
    @MessageBody() data: { callId: string },
  ) {
    try {
      await this.mediasoupService.ensureRoom(data.callId);
      return this.mediasoupService.getRouterRtpCapabilities(data.callId);
    } catch (e: any) {
      return { error: e.message };
    }
  }

  @SubscribeMessage('ms:create-transport')
  async handleCreateTransport(
    @MessageBody() data: { callId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = this.sockets.get(client.id);
    if (!userId) return { error: 'Not registered' };
    try {
      return await this.mediasoupService.createTransport(data.callId, userId);
    } catch (e: any) {
      return { error: e.message };
    }
  }

  @SubscribeMessage('ms:connect-transport')
  async handleConnectTransport(
    @MessageBody()
    data: { callId: string; transportId: string; dtlsParameters: any },
  ) {
    try {
      await this.mediasoupService.connectTransport(
        data.callId,
        data.transportId,
        data.dtlsParameters,
      );
      return { success: true };
    } catch (e: any) {
      return { error: e.message };
    }
  }

  @SubscribeMessage('ms:produce')
  async handleProduce(
    @MessageBody()
    data: {
      callId: string;
      transportId: string;
      kind: string;
      rtpParameters: any;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = this.sockets.get(client.id);
    if (!userId) return { error: 'Not registered' };
    try {
      const producerId = await this.mediasoupService.produce(
        data.callId,
        data.transportId,
        userId,
        data.kind as any,
        data.rtpParameters,
      );
      // Notify everyone else in the call room about the new producer
      client.to(`call:${data.callId}`).emit('ms:new-producer', {
        userId,
        producerId,
        kind: data.kind,
      });
      return { producerId };
    } catch (e: any) {
      return { error: e.message };
    }
  }

  @SubscribeMessage('ms:get-producers')
  handleGetProducers(@MessageBody() data: { callId: string }) {
    return { producers: this.mediasoupService.getProducers(data.callId) };
  }

  @SubscribeMessage('ms:consume')
  async handleConsume(
    @MessageBody()
    data: {
      callId: string;
      transportId: string;
      producerId: string;
      rtpCapabilities: any;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = this.sockets.get(client.id);
    if (!userId) return { error: 'Not registered' };
    try {
      return await this.mediasoupService.consume(
        data.callId,
        data.transportId,
        data.producerId,
        data.rtpCapabilities,
      );
    } catch (e: any) {
      return { error: e.message };
    }
  }

  @SubscribeMessage('ms:resume-consumer')
  async handleResumeConsumer(
    @MessageBody() data: { callId: string; consumerId: string },
  ) {
    try {
      await this.mediasoupService.resumeConsumer(data.callId, data.consumerId);
      return { success: true };
    } catch (e: any) {
      return { error: e.message };
    }
  }

  // MediaSoup SFU signaling

  sendIncomingCall(userId: string, data: Call) {
    this.logger.log(`Attempting to send incoming call to user ${userId}`);
    this.logger.log(`Current users map:`, Array.from(this.users.entries()));

    const socketId = this.users.get(userId);
    if (socketId) {
      this.logger.log(`Found socket ${socketId} for user ${userId}`);
      this.server.to(socketId).emit('incoming-call', data);
      this.logger.log(
        `Incoming call event emitted to user ${userId} (socket: ${socketId})`,
      );
      this.logger.log(`Call data:`, data);
    } else {
      this.logger.warn(
        `User ${userId} not connected, cannot send incoming call`,
      );
      this.logger.warn(`Available users:`, Array.from(this.users.keys()));
    }
  }

  sendCallAccepted(userId: string, data: Call) {
    const socketId = this.users.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('call-accepted', data);
      this.logger.log(`Call accepted notification sent to user ${userId}`);
    }
  }

  sendCallEnded(userId: string, data: Call) {
    const socketId = this.users.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('call-ended', data);
      this.logger.log(`Call ended notification sent to user ${userId}`);
    }
  }

  sendCallRejected(userId: string, data: Call) {
    const socketId = this.users.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('call-rejected', data);
      this.logger.log(`Call rejected notification sent to user ${userId}`);
    }
  }

  sendCallMissed(userId: string, data: Call) {
    const socketId = this.users.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('call-missed', data);
      this.logger.log(`Call missed notification sent to user ${userId}`);
    }
  }

  isUserConnected(userId: string): boolean {
    return this.users.has(userId);
  }

  getUsersInCall(callId: string): string[] {
    const room = this.callRooms.get(callId);
    return room ? Array.from(room) : [];
  }

  broadcastToCall(callId: string, event: string, data: any) {
    this.server.to(`call:${callId}`).emit(event, data);
    this.logger.log(`Broadcast to call ${callId}: ${event}`);
  }

  sendUserLeft(userId: string, data: Call, leavingUserId: string) {
    const socketId = this.users.get(userId);
    if (socketId) {
      this.server
        .to(socketId)
        .emit('user-left', { call: data, userId: leavingUserId });
      this.logger.log(
        `user-left notification sent to ${userId} (left: ${leavingUserId})`,
      );
    }
  }

  sendUserJoined(userId: string, data: Call, joiningUserId: string) {
    const socketId = this.users.get(userId);
    if (socketId) {
      this.server
        .to(socketId)
        .emit('user-joined', { call: data, userId: joiningUserId });
      this.logger.log(
        `user-joined notification sent to ${userId} (joined: ${joiningUserId})`,
      );
    }
  }
}
