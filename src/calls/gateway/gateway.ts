import {
  WebSocketGateway, WebSocketServer, SubscribeMessage, ConnectedSocket,
  MessageBody, OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Call } from '../entities/call.entity';
import { Logger } from '@nestjs/common';
import { CallRepository } from '../calls.repository';

interface WebRTCSignal {
  from: string;
  to: string;
  signal: any;
}

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

  constructor(private readonly repo: CallRepository) {}

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

      this.repo.forceEndUserCalls(userId).then((count) => {
        if (count > 0) {
          this.logger.log(`Force-ended ${count} active call(s) for disconnected user ${userId}`);
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
      this.logger.log(`User ${userId} was already registered with socket ${oldSocketId}, updating to ${client.id}`);
      this.sockets.delete(oldSocketId);
    }

    this.users.set(userId, client.id);
    this.sockets.set(client.id, userId);

    this.logger.log(`User ${userId} registered with socket ${client.id}`);

    client.emit('registered', { success: true, userId, socketId: client.id });

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

  @SubscribeMessage('webrtc:offer')
  handleWebRTCOffer(@MessageBody() data: WebRTCSignal, @ConnectedSocket() client: Socket,) {
    const { to, signal } = data;
    const from = this.sockets.get(client.id);

    if (!from) {
      this.logger.warn(`Offer from unregistered socket: ${client.id}`);
      return { success: false, error: 'Not registered' };
    }

    const targetSocketId = this.users.get(to);
    if (targetSocketId) {
      this.server.to(targetSocketId).emit('webrtc:offer', { from, signal });
      this.logger.log(`WebRTC offer sent from ${from} to ${to}`);
    }

    return { success: true };
  }

  @SubscribeMessage('webrtc:answer')
  handleWebRTCAnswer(@MessageBody() data: WebRTCSignal, @ConnectedSocket() client: Socket,) {
    const { to, signal } = data;
    const from = this.sockets.get(client.id);

    if (!from) {
      this.logger.warn(`Answer from unregistered socket: ${client.id}`);
      return { success: false, error: 'Not registered' };
    }

    const targetSocketId = this.users.get(to);
    if (targetSocketId) {
      this.server.to(targetSocketId).emit('webrtc:answer', { from, signal });
      this.logger.log(`WebRTC answer sent from ${from} to ${to}`);
    }

    return { success: true };
  }

  @SubscribeMessage('webrtc:ice-candidate')
  handleICECandidate(
    @MessageBody() data: WebRTCSignal,
    @ConnectedSocket() client: Socket,
  ) {
    const { to, signal } = data;
    const from = this.sockets.get(client.id);

    if (!from) {
      this.logger.warn(`ICE candidate from unregistered socket: ${client.id}`);
      return { success: false, error: 'Not registered' };
    }

    const targetSocketId = this.users.get(to);
    if (targetSocketId) {
      this.server
        .to(targetSocketId)
        .emit('webrtc:ice-candidate', { from, signal });
      this.logger.log(`ICE candidate sent from ${from} to ${to}`);
    }

    return { success: true };
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    const userId = this.sockets.get(client.id);
    return { pong: true, timestamp: Date.now(), userId };
  }

  sendIncomingCall(userId: string, data: Call) {
    this.logger.log(`Attempting to send incoming call to user ${userId}`);
    this.logger.log(`Current users map:`, Array.from(this.users.entries()));

    const socketId = this.users.get(userId);
    if (socketId) {
      this.logger.log(`Found socket ${socketId} for user ${userId}`);
      this.server.to(socketId).emit('incoming-call', data);
      this.logger.log(`Incoming call event emitted to user ${userId} (socket: ${socketId})`);
      this.logger.log(`Call data:`, data);
    } else {
      this.logger.warn(`User ${userId} not connected, cannot send incoming call`);
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

}
