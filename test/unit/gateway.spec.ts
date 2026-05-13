import { Test, TestingModule } from '@nestjs/testing';
import { CallGateway } from '../../src/calls/gateway/gateway';
import { CallRepository } from '../../src/calls/calls.repository';
import { CallService } from '../../src/calls/calls.service';
import { MediasoupService } from '../../src/calls/mediasoup/mediasoup.service';
import { Call } from '../../src/calls/entities/call.entity';
import { CallStatus } from '../../src/calls/enum/callStatusEnum';

const S = 'session-1';

const makeCall = (overrides: Partial<Call> = {}): Call => ({
  id: 'call-1',
  sessionId: S,
  callerId: 'caller',
  participants: ['p1'],
  activeParticipants: ['caller'],
  acceptedUsers: [],
  rejectedUsers: [],
  status: CallStatus.RINGING,
  createdAt: new Date(),
  ...overrides,
});

const makeSocket = (id: string) => ({
  id,
  join: jest.fn(),
  leave: jest.fn(),
  emit: jest.fn(),
  to: jest.fn().mockReturnValue({ emit: jest.fn() }),
});

describe('CallGateway', () => {
  let gateway: CallGateway;
  let serverEmits: Array<{ target: string; event: string; payload: any }>;
  let mockSocket: ReturnType<typeof makeSocket>;
  let mockRepo: any;
  let mockCallService: any;
  let mockMediasoupService: any;

  beforeEach(async () => {
    serverEmits = [];

    mockRepo = {
      findActiveCall: jest.fn().mockResolvedValue(null),
      findInProgressForSession: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(makeCall()),
      findAll: jest.fn().mockResolvedValue([]),
    };

    mockCallService = {
      leaveCall: jest.fn().mockResolvedValue({}),
    };

    mockMediasoupService = {
      ensureRoom: jest.fn().mockResolvedValue(undefined),
      getProducers: jest.fn().mockResolvedValue([]),
      getRouterRtpCapabilities: jest.fn().mockResolvedValue({ codecs: [] }),
      createTransport: jest.fn().mockResolvedValue({ id: 'transport-1' }),
      connectTransport: jest.fn().mockResolvedValue(undefined),
      produce: jest.fn().mockResolvedValue('producer-1'),
      consume: jest.fn().mockResolvedValue({ id: 'consumer-1', kind: 'audio' }),
      resumeConsumer: jest.fn().mockResolvedValue(undefined),
    };

    mockSocket = makeSocket('socket-1');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallGateway,
        { provide: CallRepository, useValue: mockRepo },
        { provide: CallService, useValue: mockCallService },
        { provide: MediasoupService, useValue: mockMediasoupService },
      ],
    }).compile();

    gateway = module.get<CallGateway>(CallGateway);
    gateway.server = {
      to: jest.fn().mockImplementation((target: string) => ({
        emit: (event: string, payload: any) =>
          serverEmits.push({ target, event, payload }),
      })),
    } as any;
  });

  const registerUser = (
    userId: string,
    sessionId: string = S,
    socket: any = mockSocket,
  ) => gateway.handleRegister({ userId, sessionId }, socket);

  describe('handleConnection', () => {
    it('does not throw on new connection', () => {
      expect(() => gateway.handleConnection(mockSocket as any)).not.toThrow();
    });
  });

  describe('handleDisconnect', () => {
    it('removes user registration on disconnect', () => {
      registerUser('alice');
      gateway.handleDisconnect(mockSocket as any);
      expect(gateway.isUserConnected('alice', S)).toBe(false);
    });

    it('triggers leaveCall when user has an active call in the same session on disconnect', async () => {
      registerUser('alice');
      mockRepo.findActiveCall.mockResolvedValueOnce(makeCall({ id: 'call-1' }));
      gateway.handleDisconnect(mockSocket as any);
      await new Promise((r) => setTimeout(r, 10));
      expect(mockCallService.leaveCall).toHaveBeenCalledWith('call-1', 'alice', S);
    });

    it('does NOT trigger leaveCall when the active call belongs to a different session', async () => {
      registerUser('alice');
      mockRepo.findActiveCall.mockResolvedValueOnce(
        makeCall({ id: 'call-1', sessionId: 'other-session' }),
      );
      gateway.handleDisconnect(mockSocket as any);
      await new Promise((r) => setTimeout(r, 10));
      expect(mockCallService.leaveCall).not.toHaveBeenCalled();
    });

    it('cleans up call room when last user disconnects', async () => {
      registerUser('alice');
      await gateway.handleJoinCall({ callId: 'call-1' }, mockSocket as any);
      gateway.handleDisconnect(mockSocket as any);
      expect(gateway.getUsersInCall('call-1')).toHaveLength(0);
    });

    it('removes user from call room but keeps room when others remain', async () => {
      const socket2 = makeSocket('socket-2');
      registerUser('alice');
      registerUser('bob', S, socket2);
      await gateway.handleJoinCall({ callId: 'call-1' }, mockSocket as any);
      await gateway.handleJoinCall({ callId: 'call-1' }, socket2 as any);
      gateway.handleDisconnect(mockSocket as any);
      expect(gateway.getUsersInCall('call-1')).toContain('bob');
      expect(gateway.getUsersInCall('call-1')).not.toContain('alice');
    });

    it('keeps the user registered for the session when another tab of the same user is still open', async () => {
      const tab2 = makeSocket('socket-tab2');
      registerUser('alice', S, mockSocket);
      registerUser('alice', S, tab2);
      gateway.handleDisconnect(mockSocket as any);
      expect(gateway.isUserConnected('alice', S)).toBe(true);
      expect(mockCallService.leaveCall).not.toHaveBeenCalled();
    });

    it('does nothing when socket has no registered ctx', () => {
      expect(() => gateway.handleDisconnect(mockSocket as any)).not.toThrow();
    });
  });

  describe('handleRegister', () => {
    it('registers user and returns success response', () => {
      const result = gateway.handleRegister({ userId: 'alice', sessionId: S }, mockSocket as any);
      expect(result).toMatchObject({ success: true, userId: 'alice', sessionId: S, socketId: 'socket-1' });
    });

    it('returns error when userId is missing', () => {
      const result = gateway.handleRegister({ sessionId: S } as any, mockSocket as any);
      expect(result.success).toBe(false);
    });

    it('returns error when sessionId is missing', () => {
      const result = gateway.handleRegister({ userId: 'alice' } as any, mockSocket as any);
      expect(result.success).toBe(false);
    });

    it('emits registered event to the socket', () => {
      registerUser('alice');
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'registered',
        expect.objectContaining({ success: true, sessionId: S }),
      );
    });

    it('tracks multiple sockets for the same user+session', () => {
      const tab2 = makeSocket('socket-tab2');
      registerUser('alice', S, mockSocket);
      registerUser('alice', S, tab2);
      expect(gateway.isUserConnected('alice', S)).toBe(true);
    });

    it('emits call-in-progress only for an active call in the same session', async () => {
      const activeCall = makeCall({ status: CallStatus.ACCEPTED, sessionId: S });
      mockRepo.findInProgressForSession.mockResolvedValueOnce(activeCall);
      const socket2 = makeSocket('socket-99');
      gateway.handleRegister({ userId: 'outsider', sessionId: S }, socket2 as any);
      await new Promise((r) => setTimeout(r, 10));
      expect(socket2.emit).toHaveBeenCalledWith('call-in-progress', activeCall);
    });

    it('does not emit call-in-progress when no active call exists in this session', async () => {
      mockRepo.findInProgressForSession.mockResolvedValueOnce(null);
      const socket2 = makeSocket('socket-99');
      gateway.handleRegister({ userId: 'outsider', sessionId: S }, socket2 as any);
      await new Promise((r) => setTimeout(r, 10));
      expect(socket2.emit).not.toHaveBeenCalledWith(
        'call-in-progress',
        expect.anything(),
      );
    });

    it('does not emit call-in-progress to users already in the active call', async () => {
      const activeCall = makeCall({
        status: CallStatus.ACCEPTED,
        activeParticipants: ['alice'],
      });
      mockRepo.findInProgressForSession.mockResolvedValueOnce(activeCall);
      gateway.handleRegister({ userId: 'alice', sessionId: S }, mockSocket as any);
      await new Promise((r) => setTimeout(r, 10));
      expect(mockSocket.emit).not.toHaveBeenCalledWith(
        'call-in-progress',
        expect.anything(),
      );
    });
  });

  describe('handleJoinCall', () => {
    it('joins socket room and returns producers when session matches', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValueOnce(makeCall());
      const result = await gateway.handleJoinCall({ callId: 'call-1' }, mockSocket as any);
      expect(mockSocket.join).toHaveBeenCalledWith('call:call-1');
      expect(result).toMatchObject({ success: true, callId: 'call-1', userId: 'alice' });
    });

    it('returns Wrong session error when call belongs to a different session', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValueOnce(makeCall({ sessionId: 'other-session' }));
      const result = await gateway.handleJoinCall({ callId: 'call-1' }, mockSocket as any);
      expect(result).toEqual({ error: 'Wrong session' });
      expect(mockSocket.join).not.toHaveBeenCalled();
    });

    it('returns Not registered error when socket has no ctx', async () => {
      const result = await gateway.handleJoinCall({ callId: 'call-1' }, mockSocket as any);
      expect(result).toEqual({ error: 'Not registered' });
    });

    it('reuses existing room set on second join', async () => {
      registerUser('alice', S, mockSocket);
      const socket2 = makeSocket('socket-2');
      registerUser('bob', S, socket2);
      mockRepo.findById.mockResolvedValue(makeCall());
      await gateway.handleJoinCall({ callId: 'call-1' }, mockSocket as any);
      await gateway.handleJoinCall({ callId: 'call-1' }, socket2 as any);
      expect(gateway.getUsersInCall('call-1')).toEqual(expect.arrayContaining(['alice', 'bob']));
    });
  });

  describe('handleLeaveCall', () => {
    it('leaves socket room when session matches', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValue(makeCall());
      await gateway.handleJoinCall({ callId: 'call-1' }, mockSocket as any);
      const result = await gateway.handleLeaveCall({ callId: 'call-1' }, mockSocket as any);
      expect(mockSocket.leave).toHaveBeenCalledWith('call:call-1');
      expect(result).toMatchObject({ success: true });
    });

    it('returns Wrong session error when call belongs to a different session', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValueOnce(makeCall({ sessionId: 'other-session' }));
      const result = await gateway.handleLeaveCall({ callId: 'call-1' }, mockSocket as any);
      expect(result).toEqual({ error: 'Wrong session' });
    });

    it('removes callRoom entry when last user leaves', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValue(makeCall());
      await gateway.handleJoinCall({ callId: 'call-1' }, mockSocket as any);
      await gateway.handleLeaveCall({ callId: 'call-1' }, mockSocket as any);
      expect(gateway.getUsersInCall('call-1')).toHaveLength(0);
    });
  });

  describe('handlePing', () => {
    it('returns pong with timestamp and userId from ctx', () => {
      registerUser('alice');
      const result = gateway.handlePing(mockSocket as any);
      expect(result.pong).toBe(true);
      expect(typeof result.timestamp).toBe('number');
      expect(result.userId).toBe('alice');
    });
  });

  describe('handleGetRtpCapabilities', () => {
    it('returns rtp capabilities when session matches', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValue(makeCall());
      const result = await gateway.handleGetRtpCapabilities({ callId: 'call-1' }, mockSocket as any);
      expect(mockMediasoupService.ensureRoom).toHaveBeenCalledWith('call-1');
      expect(result).toEqual({ codecs: [] });
    });

    it('returns Wrong session error when call belongs to a different session', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValueOnce(makeCall({ sessionId: 'other-session' }));
      const result = await gateway.handleGetRtpCapabilities({ callId: 'call-1' }, mockSocket as any);
      expect(result).toEqual({ error: 'Wrong session' });
    });

    it('returns error when mediasoup throws', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValue(makeCall());
      mockMediasoupService.ensureRoom.mockRejectedValueOnce(new Error('room error'));
      const result = await gateway.handleGetRtpCapabilities({ callId: 'call-1' }, mockSocket as any);
      expect(result).toEqual({ error: 'room error' });
    });
  });

  describe('handleCreateTransport', () => {
    it('returns Not registered when user is not registered', async () => {
      const result = await gateway.handleCreateTransport({ callId: 'call-1' }, mockSocket as any);
      expect(result).toEqual({ error: 'Not registered' });
    });

    it('creates transport for registered user when session matches', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValue(makeCall());
      const result = await gateway.handleCreateTransport({ callId: 'call-1' }, mockSocket as any);
      expect(mockMediasoupService.createTransport).toHaveBeenCalledWith('call-1', 'alice');
      expect(result).toEqual({ id: 'transport-1' });
    });

    it('returns Wrong session error when call belongs to a different session', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValueOnce(makeCall({ sessionId: 'other-session' }));
      const result = await gateway.handleCreateTransport({ callId: 'call-1' }, mockSocket as any);
      expect(result).toEqual({ error: 'Wrong session' });
    });

    it('returns error when transport creation fails', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValue(makeCall());
      mockMediasoupService.createTransport.mockRejectedValueOnce(new Error('transport error'));
      const result = await gateway.handleCreateTransport({ callId: 'call-1' }, mockSocket as any);
      expect(result).toEqual({ error: 'transport error' });
    });
  });

  describe('handleConnectTransport', () => {
    it('connects transport when session matches', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValue(makeCall());
      const result = await gateway.handleConnectTransport(
        { callId: 'call-1', transportId: 'transport-1', dtlsParameters: {} },
        mockSocket as any,
      );
      expect(mockMediasoupService.connectTransport).toHaveBeenCalledWith('call-1', 'transport-1', {});
      expect(result).toEqual({ success: true });
    });

    it('returns Wrong session error when call belongs to a different session', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValueOnce(makeCall({ sessionId: 'other-session' }));
      const result = await gateway.handleConnectTransport(
        { callId: 'call-1', transportId: 'transport-1', dtlsParameters: {} },
        mockSocket as any,
      );
      expect(result).toEqual({ error: 'Wrong session' });
    });

    it('returns error when connect fails', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValue(makeCall());
      mockMediasoupService.connectTransport.mockRejectedValueOnce(new Error('connect error'));
      const result = await gateway.handleConnectTransport(
        { callId: 'call-1', transportId: 'transport-1', dtlsParameters: {} },
        mockSocket as any,
      );
      expect(result).toEqual({ error: 'connect error' });
    });
  });

  describe('handleProduce', () => {
    it('returns Not registered when user is not registered', async () => {
      const result = await gateway.handleProduce(
        { callId: 'call-1', transportId: 'transport-1', kind: 'audio', rtpParameters: {} },
        mockSocket as any,
      );
      expect(result).toEqual({ error: 'Not registered' });
    });

    it('produces and notifies call room when session matches', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValue(makeCall());
      const toEmit = jest.fn();
      (mockSocket.to as jest.Mock).mockReturnValue({ emit: toEmit });
      const result = await gateway.handleProduce(
        { callId: 'call-1', transportId: 'transport-1', kind: 'audio', rtpParameters: {} },
        mockSocket as any,
      );
      expect(result).toEqual({ producerId: 'producer-1' });
      expect(toEmit).toHaveBeenCalledWith(
        'ms:new-producer',
        expect.objectContaining({ userId: 'alice', producerId: 'producer-1' }),
      );
    });

    it('returns Wrong session error when call belongs to a different session', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValueOnce(makeCall({ sessionId: 'other-session' }));
      const result = await gateway.handleProduce(
        { callId: 'call-1', transportId: 'transport-1', kind: 'audio', rtpParameters: {} },
        mockSocket as any,
      );
      expect(result).toEqual({ error: 'Wrong session' });
    });

    it('returns error when produce fails', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValue(makeCall());
      mockMediasoupService.produce.mockRejectedValueOnce(new Error('produce error'));
      const result = await gateway.handleProduce(
        { callId: 'call-1', transportId: 'transport-1', kind: 'audio', rtpParameters: {} },
        mockSocket as any,
      );
      expect(result).toEqual({ error: 'produce error' });
    });
  });

  describe('handleGetProducers', () => {
    it('returns producers when session matches', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValue(makeCall());
      mockMediasoupService.getProducers.mockResolvedValueOnce([{ id: 'p1' }]);
      const result = await gateway.handleGetProducers({ callId: 'call-1' }, mockSocket as any);
      expect(result).toEqual({ producers: [{ id: 'p1' }] });
    });

    it('returns Wrong session error when call belongs to a different session', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValueOnce(makeCall({ sessionId: 'other-session' }));
      const result = await gateway.handleGetProducers({ callId: 'call-1' }, mockSocket as any);
      expect(result).toEqual({ error: 'Wrong session' });
    });
  });

  describe('handleConsume', () => {
    it('returns Not registered when user is not registered', async () => {
      const result = await gateway.handleConsume(
        { callId: 'call-1', transportId: 'transport-1', producerId: 'p1', rtpCapabilities: {} },
        mockSocket as any,
      );
      expect(result).toEqual({ error: 'Not registered' });
    });

    it('consumes and returns consumer info when session matches', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValue(makeCall());
      const result = await gateway.handleConsume(
        { callId: 'call-1', transportId: 'transport-1', producerId: 'p1', rtpCapabilities: {} },
        mockSocket as any,
      );
      expect(result).toEqual({ id: 'consumer-1', kind: 'audio' });
    });

    it('returns Wrong session error when call belongs to a different session', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValueOnce(makeCall({ sessionId: 'other-session' }));
      const result = await gateway.handleConsume(
        { callId: 'call-1', transportId: 'transport-1', producerId: 'p1', rtpCapabilities: {} },
        mockSocket as any,
      );
      expect(result).toEqual({ error: 'Wrong session' });
    });

    it('returns error when consume fails', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValue(makeCall());
      mockMediasoupService.consume.mockRejectedValueOnce(new Error('consume error'));
      const result = await gateway.handleConsume(
        { callId: 'call-1', transportId: 'transport-1', producerId: 'p1', rtpCapabilities: {} },
        mockSocket as any,
      );
      expect(result).toEqual({ error: 'consume error' });
    });
  });

  describe('handleMuteChanged', () => {
    it('broadcasts mute change to call room when session matches', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValue(makeCall());
      const toEmit = jest.fn();
      (mockSocket.to as jest.Mock).mockReturnValue({ emit: toEmit });
      await gateway.handleMuteChanged({ callId: 'call-1', isMuted: true }, mockSocket as any);
      expect(mockSocket.to).toHaveBeenCalledWith('call:call-1');
      expect(toEmit).toHaveBeenCalledWith('user:mute-changed', { userId: 'alice', isMuted: true });
    });

    it('does nothing when call belongs to a different session', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValueOnce(makeCall({ sessionId: 'other-session' }));
      const toEmit = jest.fn();
      (mockSocket.to as jest.Mock).mockReturnValue({ emit: toEmit });
      await gateway.handleMuteChanged({ callId: 'call-1', isMuted: true }, mockSocket as any);
      expect(toEmit).not.toHaveBeenCalled();
    });
  });

  describe('handleResumeConsumer', () => {
    it('resumes consumer when session matches', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValue(makeCall());
      const result = await gateway.handleResumeConsumer(
        { callId: 'call-1', consumerId: 'consumer-1' },
        mockSocket as any,
      );
      expect(mockMediasoupService.resumeConsumer).toHaveBeenCalledWith('call-1', 'consumer-1');
      expect(result).toEqual({ success: true });
    });

    it('returns Wrong session error when call belongs to a different session', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValueOnce(makeCall({ sessionId: 'other-session' }));
      const result = await gateway.handleResumeConsumer(
        { callId: 'call-1', consumerId: 'consumer-1' },
        mockSocket as any,
      );
      expect(result).toEqual({ error: 'Wrong session' });
    });

    it('returns error when resume fails', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValue(makeCall());
      mockMediasoupService.resumeConsumer.mockRejectedValueOnce(new Error('resume error'));
      const result = await gateway.handleResumeConsumer(
        { callId: 'call-1', consumerId: 'consumer-1' },
        mockSocket as any,
      );
      expect(result).toEqual({ error: 'resume error' });
    });
  });

  describe('handleWebRTCOffer', () => {
    it('relays offer to target user socket in the same session', () => {
      const targetSocket = makeSocket('socket-2');
      registerUser('alice', S, mockSocket);
      registerUser('bob', S, targetSocket);
      gateway.handleWebRTCOffer({ to: 'bob', signal: {} as any }, mockSocket as any);
      const offerEmit = serverEmits.find((e) => e.event === 'webrtc:offer');
      expect(offerEmit?.target).toBe('socket-2');
      expect(offerEmit?.payload).toEqual(expect.objectContaining({ from: 'alice' }));
    });

    it('does not relay across sessions', () => {
      const targetSocket = makeSocket('socket-2');
      registerUser('alice', S, mockSocket);
      registerUser('bob', 'other-session', targetSocket);
      gateway.handleWebRTCOffer({ to: 'bob', signal: {} as any }, mockSocket as any);
      expect(serverEmits.find((e) => e.event === 'webrtc:offer')).toBeUndefined();
    });

    it('does nothing when target user is not connected', () => {
      registerUser('alice');
      expect(() =>
        gateway.handleWebRTCOffer({ to: 'offline', signal: {} as any }, mockSocket as any),
      ).not.toThrow();
    });
  });

  describe('handleWebRTCAnswer', () => {
    it('relays answer to target user socket in the same session', () => {
      const targetSocket = makeSocket('socket-2');
      registerUser('alice', S, mockSocket);
      registerUser('bob', S, targetSocket);
      gateway.handleWebRTCAnswer({ to: 'bob', signal: {} as any }, mockSocket as any);
      const answerEmit = serverEmits.find((e) => e.event === 'webrtc:answer');
      expect(answerEmit?.payload).toEqual(expect.objectContaining({ from: 'alice' }));
    });
  });

  describe('handleWebRTCIceCandidate', () => {
    it('relays ice candidate to target user in the same session', () => {
      const targetSocket = makeSocket('socket-2');
      registerUser('alice', S, mockSocket);
      registerUser('bob', S, targetSocket);
      gateway.handleWebRTCIceCandidate({ to: 'bob', signal: {} as any }, mockSocket as any);
      const iceEmit = serverEmits.find((e) => e.event === 'webrtc:ice-candidate');
      expect(iceEmit?.payload).toEqual(expect.objectContaining({ from: 'alice' }));
    });
  });

  describe('sendIncomingCall', () => {
    it('emits incoming-call to all sockets of the user in the matching session', () => {
      registerUser('alice');
      gateway.sendIncomingCall('alice', makeCall());
      expect(serverEmits.find((e) => e.event === 'incoming-call')).toBeDefined();
    });

    it('does not emit when the user is not connected in the call session', () => {
      registerUser('alice', 'other-session');
      gateway.sendIncomingCall('alice', makeCall());
      expect(serverEmits.find((e) => e.event === 'incoming-call')).toBeUndefined();
    });
  });

  describe('sendCallAccepted', () => {
    it('emits call-accepted to user in the matching session', () => {
      registerUser('alice');
      gateway.sendCallAccepted('alice', makeCall());
      expect(serverEmits.find((e) => e.event === 'call-accepted')).toBeDefined();
    });

    it('does not emit when user is in a different session', () => {
      registerUser('alice', 'other-session');
      gateway.sendCallAccepted('alice', makeCall());
      expect(serverEmits.find((e) => e.event === 'call-accepted')).toBeUndefined();
    });
  });

  describe('sendCallEnded', () => {
    it('emits call-ended to user in the matching session', () => {
      registerUser('alice');
      gateway.sendCallEnded('alice', makeCall());
      expect(serverEmits.find((e) => e.event === 'call-ended')).toBeDefined();
    });
  });

  describe('sendCallRejected', () => {
    it('emits call-rejected to user in the matching session', () => {
      registerUser('alice');
      gateway.sendCallRejected('alice', makeCall());
      expect(serverEmits.find((e) => e.event === 'call-rejected')).toBeDefined();
    });
  });

  describe('sendCallMissed', () => {
    it('emits call-missed to user in the matching session', () => {
      registerUser('alice');
      gateway.sendCallMissed('alice', makeCall());
      expect(serverEmits.find((e) => e.event === 'call-missed')).toBeDefined();
    });
  });

  describe('sendUserLeft', () => {
    it('emits user-left with leaving user info', () => {
      registerUser('alice');
      gateway.sendUserLeft('alice', makeCall(), 'bob');
      const emit = serverEmits.find((e) => e.event === 'user-left');
      expect(emit?.payload).toEqual(expect.objectContaining({ userId: 'bob' }));
    });
  });

  describe('sendUserJoined', () => {
    it('emits user-joined with joining user info', () => {
      registerUser('alice');
      gateway.sendUserJoined('alice', makeCall(), 'bob');
      const emit = serverEmits.find((e) => e.event === 'user-joined');
      expect(emit?.payload).toEqual(expect.objectContaining({ userId: 'bob' }));
    });
  });

  describe('broadcastToCall', () => {
    it('broadcasts event to entire call room', () => {
      gateway.broadcastToCall('call-1', 'ms:producer-closed', { producerId: 'p1' });
      expect(gateway.server.to).toHaveBeenCalledWith('call:call-1');
      const emit = serverEmits.find((e) => e.event === 'ms:producer-closed');
      expect(emit?.payload).toEqual({ producerId: 'p1' });
    });
  });

  describe('isUserConnected', () => {
    it('returns true for registered user in the given session', () => {
      registerUser('alice');
      expect(gateway.isUserConnected('alice', S)).toBe(true);
    });

    it('returns false for a user registered in a different session', () => {
      registerUser('alice', 'other-session');
      expect(gateway.isUserConnected('alice', S)).toBe(false);
    });

    it('returns false for unknown user', () => {
      expect(gateway.isUserConnected('nobody', S)).toBe(false);
    });
  });

  describe('getUsersInCall', () => {
    it('returns list of users in call room', async () => {
      registerUser('alice');
      mockRepo.findById.mockResolvedValue(makeCall());
      await gateway.handleJoinCall({ callId: 'call-1' }, mockSocket as any);
      expect(gateway.getUsersInCall('call-1')).toContain('alice');
    });

    it('returns empty array for unknown call', () => {
      expect(gateway.getUsersInCall('unknown')).toEqual([]);
    });
  });
});
