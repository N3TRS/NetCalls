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

@WebSocketGateway({
  path: '/calls/socket.io',
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
})
export class CallGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(CallGateway.name);
  private socketCtx = new Map<string, { userId: string; sessionId: string }>();
  private userSockets = new Map<string, Set<string>>(); // `${userId}::${sessionId}` → socketIds
  private callRooms = new Map<string, Set<string>>();

  private userKey(userId: string, sessionId: string) {
    return `${userId}::${sessionId}`;
  }

  private getSocketIdsFor(userId: string, sessionId: string): string[] {
    const set = this.userSockets.get(this.userKey(userId, sessionId));
    return set ? [...set] : [];
  }

  private requireCtx(client: Socket) {
    const ctx = this.socketCtx.get(client.id);
    if (!ctx) throw new Error('Not registered');
    return ctx;
  }

  private async assertSocketCallSession(client: Socket, callId: string) {
    const ctx = this.requireCtx(client);
    const call = await this.repo.findById(callId);
    if (!call) throw new Error('Call not found');
    if (call.sessionId !== ctx.sessionId) throw new Error('Wrong session');
    return { ctx, call };
  }

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
    const ctx = this.socketCtx.get(client.id);
    if (!ctx) return;
    const { userId, sessionId } = ctx;
    this.logger.log(
      `User ${userId} (session ${sessionId}) disconnected (socket: ${client.id})`,
    );

    this.socketCtx.delete(client.id);
    const key = this.userKey(userId, sessionId);
    const set = this.userSockets.get(key);
    if (set) {
      set.delete(client.id);
      if (set.size > 0) {
        // Other tabs of this user in this session are still connected; keep the call alive.
        return;
      }
      this.userSockets.delete(key);
    }

    this.callRooms.forEach((users, callId) => {
      if (users.has(userId)) {
        users.delete(userId);
        if (users.size === 0) {
          this.callRooms.delete(callId);
        }
      }
    });

    this.repo.findActiveCall(userId).then((call) => {
      if (call && call.sessionId === sessionId) {
        this.callService.leaveCall(call.id, userId, sessionId).catch(() => {});
        this.logger.log(`User ${userId} left call ${call.id} on disconnect`);
      }
    });
  }

  @SubscribeMessage('register')
  handleRegister(
    @MessageBody() data: { userId?: string; sessionId?: string } | string,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = typeof data === 'string' ? data : data?.userId;
    const sessionId = typeof data === 'string' ? undefined : data?.sessionId;

    if (!userId || !sessionId) {
      this.logger.warn(
        `Registration missing userId/sessionId: ${client.id}`,
      );
      return { success: false, error: 'userId and sessionId are required' };
    }

    this.socketCtx.set(client.id, { userId, sessionId });
    const key = this.userKey(userId, sessionId);
    let set = this.userSockets.get(key);
    if (!set) {
      set = new Set();
      this.userSockets.set(key, set);
    }
    set.add(client.id);

    this.logger.log(
      `User ${userId} registered (session ${sessionId}, socket ${client.id})`,
    );

    client.emit('registered', {
      success: true,
      userId,
      sessionId,
      socketId: client.id,
    });

    // Notify late joiners about an ongoing call in THIS session only.
    this.repo.findInProgressForSession(sessionId).then((activeCall) => {
      if (activeCall && !activeCall.activeParticipants.includes(userId)) {
        client.emit('call-in-progress', activeCall);
      }
    });

    return { success: true, userId, sessionId, socketId: client.id };
  }

  @SubscribeMessage('join-call')
  async handleJoinCall(
    @MessageBody() data: { callId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { callId } = data;
    try {
      const { ctx } = await this.assertSocketCallSession(client, callId);
      const { userId } = ctx;

      if (!this.callRooms.has(callId)) {
        this.callRooms.set(callId, new Set());
      }
      this.callRooms.get(callId)!.add(userId);
      client.join(`call:${callId}`);

      this.logger.log(`User ${userId} joined call ${callId}`);

      const producers = await this.mediasoupService.getProducers(callId);
      return { success: true, callId, userId, producers };
    } catch (e: any) {
      return { error: e.message };
    }
  }

  @SubscribeMessage('leave-call')
  async handleLeaveCall(
    @MessageBody() data: { callId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { callId } = data;
    try {
      const { ctx } = await this.assertSocketCallSession(client, callId);
      const { userId } = ctx;

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
    } catch (e: any) {
      return { error: e.message };
    }
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    const ctx = this.socketCtx.get(client.id);
    return { pong: true, timestamp: Date.now(), userId: ctx?.userId };
  }

  // WebRTC P2P signaling relay

  @SubscribeMessage('webrtc:offer')
  handleWebRTCOffer(
    @MessageBody() data: { to: string; signal: RTCSessionDescriptionInit },
    @ConnectedSocket() client: Socket,
  ) {
    const ctx = this.socketCtx.get(client.id);
    if (!ctx) return;
    for (const sid of this.getSocketIdsFor(data.to, ctx.sessionId)) {
      this.server.to(sid).emit('webrtc:offer', { from: ctx.userId, signal: data.signal });
    }
  }

  @SubscribeMessage('webrtc:answer')
  handleWebRTCAnswer(
    @MessageBody() data: { to: string; signal: RTCSessionDescriptionInit },
    @ConnectedSocket() client: Socket,
  ) {
    const ctx = this.socketCtx.get(client.id);
    if (!ctx) return;
    for (const sid of this.getSocketIdsFor(data.to, ctx.sessionId)) {
      this.server.to(sid).emit('webrtc:answer', { from: ctx.userId, signal: data.signal });
    }
  }

  @SubscribeMessage('webrtc:ice-candidate')
  handleWebRTCIceCandidate(
    @MessageBody() data: { to: string; signal: RTCIceCandidateInit },
    @ConnectedSocket() client: Socket,
  ) {
    const ctx = this.socketCtx.get(client.id);
    if (!ctx) return;
    for (const sid of this.getSocketIdsFor(data.to, ctx.sessionId)) {
      this.server.to(sid).emit('webrtc:ice-candidate', { from: ctx.userId, signal: data.signal });
    }
  }

  // MediaSoup SFU signaling

  @SubscribeMessage('ms:get-rtp-capabilities')
  async handleGetRtpCapabilities(
    @MessageBody() data: { callId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      await this.assertSocketCallSession(client, data.callId);
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
    try {
      const { ctx } = await this.assertSocketCallSession(client, data.callId);
      await this.mediasoupService.ensureRoom(data.callId);
      return await this.mediasoupService.createTransport(data.callId, ctx.userId);
    } catch (e: any) {
      return { error: e.message };
    }
  }

  @SubscribeMessage('ms:connect-transport')
  async handleConnectTransport(
    @MessageBody()
    data: { callId: string; transportId: string; dtlsParameters: any },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      await this.assertSocketCallSession(client, data.callId);
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
    try {
      const { ctx } = await this.assertSocketCallSession(client, data.callId);
      const { userId } = ctx;
      const producerId = await this.mediasoupService.produce(
        data.callId,
        data.transportId,
        userId,
        data.kind as any,
        data.rtpParameters,
      );
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
  async handleGetProducers(
    @MessageBody() data: { callId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      await this.assertSocketCallSession(client, data.callId);
      return { producers: await this.mediasoupService.getProducers(data.callId) };
    } catch (e: any) {
      return { error: e.message };
    }
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
    try {
      const { ctx } = await this.assertSocketCallSession(client, data.callId);
      this.logger.log(`[DEBUG] ms:consume — user=${ctx.userId} producer=${data.producerId} transport=${data.transportId}`);
      const result = await this.mediasoupService.consume(
        data.callId,
        data.transportId,
        data.producerId,
        data.rtpCapabilities,
      );
      this.logger.log(`[DEBUG] ms:consume OK — consumerId=${result.id} kind=${result.kind}`);
      return result;
    } catch (e: any) {
      this.logger.error(`[DEBUG] ms:consume FAILED — ${e.message}`);
      return { error: e.message };
    }
  }

  @SubscribeMessage('user:mute-changed')
  async handleMuteChanged(
    @MessageBody() data: { callId: string; isMuted: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { ctx } = await this.assertSocketCallSession(client, data.callId);
      client.to(`call:${data.callId}`).emit('user:mute-changed', {
        userId: ctx.userId,
        isMuted: data.isMuted,
      });
    } catch {
      // silent — mute UI updates aren't worth surfacing to client
    }
  }

  @SubscribeMessage('ms:resume-consumer')
  async handleResumeConsumer(
    @MessageBody() data: { callId: string; consumerId: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.logger.log(`[DEBUG] ms:resume-consumer called — callId=${data.callId} consumerId=${data.consumerId}`);
    try {
      await this.assertSocketCallSession(client, data.callId);
      await this.mediasoupService.resumeConsumer(data.callId, data.consumerId);
      return { success: true };
    } catch (e: any) {
      return { error: e.message };
    }
  }

  // MediaSoup SFU signaling

  private emitToUserInSession(
    userId: string,
    sessionId: string,
    event: string,
    payload: any,
  ) {
    const sockets = this.getSocketIdsFor(userId, sessionId);
    for (const sid of sockets) {
      this.server.to(sid).emit(event, payload);
    }
    return sockets.length;
  }

  sendIncomingCall(userId: string, data: Call) {
    const count = this.emitToUserInSession(userId, data.sessionId, 'incoming-call', data);
    if (count === 0) {
      this.logger.warn(
        `User ${userId} not connected in session ${data.sessionId}, cannot send incoming call`,
      );
    } else {
      this.logger.log(
        `incoming-call emitted to ${userId} in session ${data.sessionId} (${count} socket(s))`,
      );
    }
  }

  sendCallAccepted(userId: string, data: Call) {
    this.emitToUserInSession(userId, data.sessionId, 'call-accepted', data);
  }

  sendCallEnded(userId: string, data: Call) {
    this.emitToUserInSession(userId, data.sessionId, 'call-ended', data);
  }

  sendCallRejected(userId: string, data: Call) {
    this.emitToUserInSession(userId, data.sessionId, 'call-rejected', data);
  }

  sendCallMissed(userId: string, data: Call) {
    this.emitToUserInSession(userId, data.sessionId, 'call-missed', data);
  }

  isUserConnected(userId: string, sessionId: string): boolean {
    return this.getSocketIdsFor(userId, sessionId).length > 0;
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
    this.emitToUserInSession(userId, data.sessionId, 'user-left', {
      call: data,
      userId: leavingUserId,
    });
  }

  sendUserJoined(userId: string, data: Call, joiningUserId: string) {
    this.emitToUserInSession(userId, data.sessionId, 'user-joined', {
      call: data,
      userId: joiningUserId,
    });
  }
}
