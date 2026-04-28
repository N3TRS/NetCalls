import { CallStatus } from '../enum/callStatusEnum';

export class Call {
  id: string;
  callerId: string;
  participants: string[];
  activeParticipants: string[];
  acceptedUsers: string[];
  rejectedUsers: string[];
  status: CallStatus;
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
}
