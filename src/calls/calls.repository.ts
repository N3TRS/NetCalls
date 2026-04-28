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
        (item.callerId === userId || item.activeParticipants?.includes(userId)),
    );

    return Promise.resolve(call ?? null);
  }

  async forceEndUserCalls(userId: string): Promise<number> {
    let count = 0;
    const activeCalls = [...this.calls.values()].filter(
      (call) =>
        (call.status === CallStatus.RINGING ||
          call.status === CallStatus.ACCEPTED) &&
        (call.callerId === userId || call.activeParticipants?.includes(userId)),
    );

    for (const call of activeCalls) {
      call.status = CallStatus.ENDED;
      call.endedAt = new Date();
      await this.save(call);
      count++;
    }

    return count;
  }

  // Get all calls
  findAll() {
    return Promise.resolve([...this.calls.values()]);
  }
}
