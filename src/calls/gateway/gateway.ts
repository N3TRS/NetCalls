import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Call } from '../entities/call.entity';

@WebSocketGateway({
  cors: { origin: '*' },
})

export class CallGateway {
  @WebSocketServer()
  server: Server;

  private users = new Map<string, string>();

  @SubscribeMessage('register')
  handleRegister(
    @MessageBody() userId: string,
    @ConnectedSocket() client: Socket,
  ) {
    this.users.set(userId, client.id);
  }

  sendIncomingCall(userId: string, data: Call) {
    const socketId = this.users.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('incoming-call', data);
    }
  }

  sendCallAccepted(callerId: string, data: Call) {
    const socketId = this.users.get(callerId);
    if (socketId) {
      this.server.to(socketId).emit('call-accepted', data);
    }
  }

  sendCallEnded(userId: string, data: Call) {
    const socketId = this.users.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('call-ended', data);
    }
  }

  sendCallRejected(userId: string, data: Call) {
    const socketId = this.users.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('call-rejected', data);
    }
  }

  sendCallMissed(userId: string, data: Call) {
    const socketId = this.users.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('call-missed', data);
    }
  }

  handleDisconnect(client: Socket) {
    for (const [userId, socketId] of this.users.entries()) {
      if (socketId === client.id) {
        this.users.delete(userId);
        break;
      }
    }
  }
}
