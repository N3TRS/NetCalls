import { CallStatus } from "../enum/callStatusEnum";

export class Call {
  id: string;
  callerId: string;
  calleeId: string;
  status: CallStatus;
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
}