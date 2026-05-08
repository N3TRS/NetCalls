import { Call } from '../calls/entities/call.entity';

export interface RegisterPayload {
  userId: string;
}

export interface JoinCallPayload {
  callId: string;
  userId: string;
}

export interface LeaveCallPayload {
  callId: string;
  userId: string;
}

export interface IncomingCallEvent {
  event: 'incoming-call';
  data: Call;
}

export interface CallAcceptedEvent {
  event: 'call-accepted';
  data: Call;
}

export interface CallRejectedEvent {
  event: 'call-rejected';
  data: Call;
}

export interface CallEndedEvent {
  event: 'call-ended';
  data: Call;
}

export interface CallMissedEvent {
  event: 'call-missed';
  data: Call;
}

export interface RegisterResponse {
  success: boolean;
  userId?: string;
  socketId?: string;
  error?: string;
}

export interface JoinCallResponse {
  success: boolean;
  callId?: string;
  userId?: string;
  error?: string;
}

export interface LeaveCallResponse {
  success: boolean;
  callId?: string;
  userId?: string;
  error?: string;
}

export interface PingResponse {
  pong: boolean;
  timestamp: number;
  userId?: string;
}

export type ServerToClientEvents =
  | IncomingCallEvent
  | CallAcceptedEvent
  | CallRejectedEvent
  | CallEndedEvent
  | CallMissedEvent;

export type ClientToServerEvents =
  | 'register'
  | 'join-call'
  | 'leave-call'
  | 'ping'
  | 'ms:get-rtp-capabilities'
  | 'ms:create-transport'
  | 'ms:connect-transport'
  | 'ms:produce'
  | 'ms:get-producers'
  | 'ms:consume'
  | 'ms:resume-consumer';
