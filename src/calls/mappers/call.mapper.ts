import { CallResponseDto } from '../dto/call-response.dto';
import { Call } from '../entities/call.entity';

export class CallMapper {
  static toResponse(call: Call): CallResponseDto {
    return {
      callId: call.id,
      callerId: call.callerId,
      participants: call.participants,
      acceptedUsers: call.acceptedUsers,
      rejectedUsers: call.rejectedUsers,
      status: call.status,
      createdAt: call.createdAt,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
    };
  }
}
