export class CallResponseDto {
  callId: string;
  sessionId: string;
  callerId: string;
  participants: string[];
  activeParticipants: string[];
  acceptedUsers: string[];
  rejectedUsers: string[];
  status: string;
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
}
