import { Injectable } from '@nestjs/common';
import { Call } from './entities/call.entity';
import { CallStatus } from './enum/callStatusEnum';

@Injectable()
export class CallRepository {
  private readonly calls = new Map<string, Call>();

  save(call: Call) {
    this.calls.set(call.id, call);
    return Promise.resolve(call);
  }

  findById(id: string) {
    return Promise.resolve(this.calls.get(id) ?? null);
  }

  findActiveCall(userId: string) {
  const call = [...this.calls.values()].find(
    (item) =>
      (item.status === CallStatus.RINGING ||
        item.status === CallStatus.ACCEPTED) &&
      (item.callerId === userId || item.calleeId === userId),
  );

  return Promise.resolve(call ?? null);
}
}