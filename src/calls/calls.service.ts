import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { CallRepository } from "./calls.repository";
import { CallStatus } from "./enum/callStatusEnum";
import { EventService } from "../events/event.service";

@Injectable()
export class CallService {
  constructor(
    private repo: CallRepository,
    private eventService: EventService,
  ) {}

  async createCall(callerId: string, calleeId: string) {
    await this.validateUsers(callerId, calleeId);

    const busy = await this.repo.findActiveCall(calleeId);
    if (busy) throw new Error('User busy');

    const call = await this.repo.save({
      id: randomUUID(),
      callerId,
      calleeId,
      status: CallStatus.RINGING,
      createdAt: new Date(),
    });

    this.eventService.emit('call.created', call);

    return call;
  }

  async acceptCall(callId: string) {
    const call = await this.getOrFail(callId);

    if (call.status !== CallStatus.RINGING)
      throw new Error('Invalid state');

    call.status = CallStatus.ACCEPTED;
    call.startedAt = new Date();

    await this.repo.save(call);

    this.eventService.emit('call.accepted', call);

    return call;
  }

  async rejectCall(callId: string) {
    const call = await this.getOrFail(callId);

    if (call.status !== CallStatus.RINGING)
      throw new Error('Invalid state');

    call.status = CallStatus.REJECTED;

    await this.repo.save(call);

    this.eventService.emit('call.rejected', call);

    return call;
  }

  async endCall(callId: string) {
    const call = await this.getOrFail(callId);

    if (call.status !== CallStatus.ACCEPTED)
      throw new Error('Call not active');

    call.status = CallStatus.ENDED;
    call.endedAt = new Date();

    await this.repo.save(call);

    this.eventService.emit('call.ended', call);

    return call;
  }

  async getOrFail(callId: string) {
    const call = await this.repo.findById(callId);
    if (!call) throw new Error('Call not found');
    return call;
  }

  async validateUsers(callerId: string, calleeId: string) {
    if (!callerId || !calleeId) {
      throw new Error('Caller and callee are required');
    }
  }
}