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

export interface WebRTCSignalPayload {
  from?: string;
  to: string;
  signal: RTCSessionDescriptionInit | RTCIceCandidateInit;
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

export interface WebRTCOfferEvent {
  event: 'webrtc:offer';
  data: {
    from: string;
    signal: RTCSessionDescriptionInit;
  };
}

export interface WebRTCAnswerEvent {
  event: 'webrtc:answer';
  data: {
    from: string;
    signal: RTCSessionDescriptionInit;
  };
}

export interface WebRTCIceCandidateEvent {
  event: 'webrtc:ice-candidate';
  data: {
    from: string;
    signal: RTCIceCandidateInit;
  };
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

export interface WebRTCResponse {
  success: boolean;
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
  | CallMissedEvent
  | WebRTCOfferEvent
  | WebRTCAnswerEvent
  | WebRTCIceCandidateEvent;

export type ClientToServerEvents =
  | 'register'
  | 'join-call'
  | 'leave-call'
  | 'webrtc:offer'
  | 'webrtc:answer'
  | 'webrtc:ice-candidate'
  | 'ping';
