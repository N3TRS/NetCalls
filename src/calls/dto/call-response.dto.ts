export class CallResponseDto {
  callId: string;
  callerId: string;
  participants: string[];
  acceptedUsers: string[];
  rejectedUsers: string[];
  status: string;
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
}
