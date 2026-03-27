import { EventService } from "src/events/event.service";
import { CallRepository } from "./calls.repository";
import { Call } from "./entities/call.entity";
import { CallStatus } from "./enum/callStatusEnum";
import { CallGateway } from "./gateway/gateway";
import { CallMapper } from "./mappers/call.mapper";
import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";

@Injectable()
export class CallService {
  constructor(
    private repo: CallRepository,
    private eventService: EventService,
    private gateway: CallGateway,
  ) {}

  async createCall(callerId: string, participants: string[]) {
    await this.validateUsers(callerId, participants);

    // validar caller
    const callerBusy = await this.repo.findActiveCall(callerId);
    if (callerBusy) throw new Error('Caller already in call');

    // validar participantes
    for (const userId of participants) {
      const busy = await this.repo.findActiveCall(userId);
      if (busy) throw new Error(`User ${userId} already in call`);
    }

    const call: Call = {
      id: randomUUID(),
      callerId,
      participants,
      acceptedUsers: [],
      rejectedUsers: [],
      status: CallStatus.RINGING,
      createdAt: new Date(),
    };

    await this.repo.save(call);

    participants.forEach((userId) => {
      this.gateway.sendIncomingCall(userId, call);
    });

    this.eventService.emit('call.created', call);

    // llamada perdida tienen 50 seg para responder o rechazar la llamada
    setTimeout(async () => {
      const current = await this.repo.findById(call.id);

      if (current && current.status === CallStatus.RINGING) {
        current.status = CallStatus.MISSED;
        await this.repo.save(current);

        this.notifyAll(current, 'missed');
        this.eventService.emit('call.missed', current);
      }
    }, 50000);

    return CallMapper.toResponse(call);
  }

  async acceptCall(callId: string, userId: string) {
    const call = await this.getOrFail(callId);

    if (
      call.status !== CallStatus.RINGING &&
      call.status !== CallStatus.ACCEPTED
    ) {
      throw new Error('Invalid state');
    }

    if (!call.participants.includes(userId)) {
      throw new Error('User not part of call');
    }

    if (!call.acceptedUsers.includes(userId)) {
      call.acceptedUsers.push(userId);
    }

    if (call.status === CallStatus.RINGING) {
      call.status = CallStatus.ACCEPTED;
      call.startedAt = new Date();
    }

    await this.repo.save(call);

    this.notifyAll(call, 'accepted');

    return CallMapper.toResponse(call);
  }

  async rejectCall(callId: string, userId: string) {
    const call = await this.getOrFail(callId);

    if (call.status !== CallStatus.RINGING &&
      call.status !== CallStatus.ACCEPTED) {
      throw new Error('Invalid state');
    }

    if (!call.participants.includes(userId)) {
      throw new Error('User not part of call');
    }

    if (!call.rejectedUsers.includes(userId)) {
      call.rejectedUsers.push(userId);
    }

    await this.repo.save(call);

    if (call.status === CallStatus.RINGING &&
      call.rejectedUsers.length === call.participants.length) {
      call.status = CallStatus.REJECTED;
      await this.repo.save(call);
    }

    this.notifyAll(call, 'rejected');

    return CallMapper.toResponse(call);
  }


  async endCall(callId: string) {
    const call = await this.getOrFail(callId);

    if (call.status !== CallStatus.ACCEPTED) {
      throw new Error('Call not active');
    }

    call.status = CallStatus.ENDED;
    call.endedAt = new Date();

    await this.repo.save(call);

    this.notifyAll(call, 'ended');
    this.eventService.emit('call.ended', call);

    return CallMapper.toResponse(call);
  }

  private notifyAll(call: Call, type: string) {
    const users = [call.callerId, ...call.participants];

    users.forEach((userId) => {
      switch (type) {
        case 'accepted':
          this.gateway.sendCallAccepted(userId, call);
          break;
        case 'rejected':
          this.gateway.sendCallRejected(userId, call);
          break;
        case 'ended':
          this.gateway.sendCallEnded(userId, call);
          break;
        case 'missed':
          this.gateway.sendCallMissed(userId, call);
          break;
      }
    });
  }

  async getOrFail(callId: string): Promise<Call> {
    const call = await this.repo.findById(callId);
    if (!call) throw new Error('Call not found');
    return call;
  }

  async getCallResponse(callId: string) {
    const call = await this.getOrFail(callId);
    return CallMapper.toResponse(call);
  }

  async validateUsers(callerId: string, participants: string[]) {
    if (!callerId || !participants || participants.length === 0) {
      throw new Error('Caller and participants are required');
    }

    if (participants.includes(callerId)) {
      throw new Error('Caller cannot be in participants');
    }
  }
}