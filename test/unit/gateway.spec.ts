import { Test, TestingModule } from '@nestjs/testing';
import { CallGateway } from '../../src/calls/gateway/gateway';
import { CallRepository } from '../../src/calls/calls.repository';
import { CallService } from '../../src/calls/calls.service';
import { MediasoupService } from '../../src/calls/mediasoup/mediasoup.service';
import { Call } from '../../src/calls/entities/call.entity';
import { CallStatus } from '../../src/calls/enum/callStatusEnum';

const makeCall = (overrides: Partial<Call> = {}): Call => ({
  id: 'call-1',
  callerId: 'caller',
  participants: ['p1'],
  activeParticipants: ['caller'],
  acceptedUsers: [],
  rejectedUsers: [],
  status: CallStatus.RINGING,
  createdAt: new Date(),
  ...overrides,
});

describe('CallGateway', () => {
  let gateway: CallGateway;
  let emitSpy: jest.Mock;
  let mockSocket: any;
  let mockRepo: any;
  let mockCallService: any;
  let mockMediasoupService: any;

  beforeEach(async () => {
    emitSpy = jest.fn();

    mockRepo = {
      findActiveCall: jest.fn().mockResolvedValue(null),
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

    mockSocket = {
      id: 'socket-1',
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallGateway,
        { provide: CallRepository, useValue: mockRepo },
        { provide: CallService, useValue: mockCallService },
        { provide: MediasoupService, useValue: mockMediasoupService },
      ],
    }).compile();

    gateway = module.get<CallGateway>(CallGateway);
    gateway.server = { to: jest.fn().mockReturnValue({ emit: emitSpy }) } as any;
  });

  const registerUser = (userId: string, socket = mockSocket) => {
    gateway.handleRegister({ userId }, socket);
  };

  // ─── Connection lifecycle ─────────────────────────────────────────────────

  describe('handleConnection', () => {
    it('does not throw on new connection', () => {
      expect(() => gateway.handleConnection(mockSocket)).not.toThrow();
    });
  });

  describe('handleDisconnect', () => {
    it('removes user registration on disconnect', () => {
      registerUser('alice');
      gateway.handleDisconnect(mockSocket);
      expect(gateway.isUserConnected('alice')).toBe(false);
    });

    it('triggers leaveCall when user has an active call on disconnect', async () => {
      registerUser('alice');
      mockRepo.findActiveCall.mockResolvedValueOnce(makeCall({ id: 'call-1' }));
      gateway.handleDisconnect(mockSocket);
      await new Promise((r) => setTimeout(r, 10));
      expect(mockCallService.leaveCall).toHaveBeenCalledWith('call-1', 'alice');
    });

    it('cleans up call room when last user disconnects', async () => {
      registerUser('alice');
      await gateway.handleJoinCall({ callId: 'call-1', userId: 'alice' }, mockSocket);
      gateway.handleDisconnect(mockSocket);
      expect(gateway.getUsersInCall('call-1')).toHaveLength(0);
    });

    it('removes user from call room but keeps room when others remain', async () => {
      const socket2 = { ...mockSocket, id: 'socket-2', emit: jest.fn() };
      registerUser('alice');
      registerUser('bob', socket2 as any);
      await gateway.handleJoinCall({ callId: 'call-1', userId: 'alice' }, mockSocket);
      await gateway.handleJoinCall({ callId: 'call-1', userId: 'bob' }, socket2 as any);
      gateway.handleDisconnect(mockSocket);
      expect(gateway.getUsersInCall('call-1')).toContain('bob');
      expect(gateway.getUsersInCall('call-1')).not.toContain('alice');
    });

    it('does nothing when socket has no registered user', () => {
      expect(() => gateway.handleDisconnect(mockSocket)).not.toThrow();
    });
  });

  // ─── handleRegister ───────────────────────────────────────────────────────

  describe('handleRegister', () => {
    it('registers user and returns success response', () => {
      const result = gateway.handleRegister({ userId: 'alice' }, mockSocket);
      expect(result).toMatchObject({ success: true, userId: 'alice', socketId: 'socket-1' });
    });

    it('accepts plain string as userId', () => {
      const result = gateway.handleRegister('alice' as any, mockSocket);
      expect(result.userId).toBe('alice');
    });

    it('returns error when userId is not provided', () => {
      const result = gateway.handleRegister({} as any, mockSocket);
      expect(result.success).toBe(false);
    });

    it('emits registered event to the socket', () => {
      registerUser('alice');
      expect(mockSocket.emit).toHaveBeenCalledWith('registered', expect.objectContaining({ success: true }));
    });

    it('updates socket mapping when user reconnects', () => {
      const socket2 = { ...mockSocket, id: 'socket-2', emit: jest.fn() };
      registerUser('alice');
      gateway.handleRegister({ userId: 'alice' }, socket2 as any);
      expect(gateway.isUserConnected('alice')).toBe(true);
    });

    it('emits call-in-progress when user reconnects to active call', async () => {
      const activeCall = makeCall({ status: CallStatus.ACCEPTED });
      mockRepo.findAll.mockResolvedValueOnce([activeCall]);
      const socket2 = { ...mockSocket, id: 'socket-99', emit: jest.fn() };
      gateway.handleRegister({ userId: 'outsider' }, socket2 as any);
      await new Promise((r) => setTimeout(r, 10));
      expect(socket2.emit).toHaveBeenCalledWith('call-in-progress', activeCall);
    });
  });

  // ─── handleJoinCall / handleLeaveCall ─────────────────────────────────────

  describe('handleJoinCall', () => {
    it('joins socket room and returns producers', async () => {
      const result = await gateway.handleJoinCall({ callId: 'call-1', userId: 'alice' }, mockSocket);
      expect(mockSocket.join).toHaveBeenCalledWith('call:call-1');
      expect(result).toMatchObject({ success: true, callId: 'call-1' });
    });

    it('reuses existing room set on second join', async () => {
      await gateway.handleJoinCall({ callId: 'call-1', userId: 'alice' }, mockSocket);
      await gateway.handleJoinCall({ callId: 'call-1', userId: 'bob' }, mockSocket);
      expect(gateway.getUsersInCall('call-1')).toContain('alice');
      expect(gateway.getUsersInCall('call-1')).toContain('bob');
    });
  });

  describe('handleLeaveCall', () => {
    it('leaves socket room and removes user from tracking', async () => {
      await gateway.handleJoinCall({ callId: 'call-1', userId: 'alice' }, mockSocket);
      const result = gateway.handleLeaveCall({ callId: 'call-1', userId: 'alice' }, mockSocket);
      expect(mockSocket.leave).toHaveBeenCalledWith('call:call-1');
      expect(result.success).toBe(true);
    });

    it('removes callRoom entry when last user leaves', async () => {
      await gateway.handleJoinCall({ callId: 'call-1', userId: 'alice' }, mockSocket);
      gateway.handleLeaveCall({ callId: 'call-1', userId: 'alice' }, mockSocket);
      expect(gateway.getUsersInCall('call-1')).toHaveLength(0);
    });
  });

  // ─── handlePing ───────────────────────────────────────────────────────────

  describe('handlePing', () => {
    it('returns pong with timestamp', () => {
      registerUser('alice');
      const result = gateway.handlePing(mockSocket);
      expect(result.pong).toBe(true);
      expect(typeof result.timestamp).toBe('number');
    });
  });

  // ─── WebRTC signaling relay ───────────────────────────────────────────────

  describe('handleWebRTCOffer', () => {
    it('relays offer to target user socket', () => {
      const targetSocket = { ...mockSocket, id: 'socket-2', emit: jest.fn() };
      registerUser('alice');
      registerUser('bob', targetSocket as any);

      gateway.handleWebRTCOffer({ to: 'bob', signal: {} as any }, mockSocket);

      expect(emitSpy).toHaveBeenCalledWith('webrtc:offer', expect.objectContaining({ from: 'alice' }));
    });

    it('does nothing when target user is not connected', () => {
      registerUser('alice');
      expect(() => gateway.handleWebRTCOffer({ to: 'offline', signal: {} as any }, mockSocket)).not.toThrow();
    });
  });

  describe('handleWebRTCAnswer', () => {
    it('relays answer to target user socket', () => {
      const targetSocket = { ...mockSocket, id: 'socket-2', emit: jest.fn() };
      registerUser('alice');
      registerUser('bob', targetSocket as any);

      gateway.handleWebRTCAnswer({ to: 'bob', signal: {} as any }, mockSocket);

      expect(emitSpy).toHaveBeenCalledWith('webrtc:answer', expect.objectContaining({ from: 'alice' }));
    });
  });

  describe('handleWebRTCIceCandidate', () => {
    it('relays ice candidate to target user', () => {
      const targetSocket = { ...mockSocket, id: 'socket-2', emit: jest.fn() };
      registerUser('alice');
      registerUser('bob', targetSocket as any);

      gateway.handleWebRTCIceCandidate({ to: 'bob', signal: {} as any }, mockSocket);

      expect(emitSpy).toHaveBeenCalledWith('webrtc:ice-candidate', expect.objectContaining({ from: 'alice' }));
    });
  });

  // ─── Notification helpers ─────────────────────────────────────────────────

  describe('sendIncomingCall', () => {
    it('emits incoming-call to connected user', () => {
      registerUser('alice');
      gateway.sendIncomingCall('alice', makeCall());
      expect(emitSpy).toHaveBeenCalledWith('incoming-call', expect.any(Object));
    });

    it('does nothing when user is not connected', () => {
      gateway.sendIncomingCall('offline', makeCall());
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('sendCallAccepted', () => {
    it('emits call-accepted to connected user', () => {
      registerUser('alice');
      gateway.sendCallAccepted('alice', makeCall());
      expect(emitSpy).toHaveBeenCalledWith('call-accepted', expect.any(Object));
    });

    it('does nothing when user is not connected', () => {
      gateway.sendCallAccepted('offline', makeCall());
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('sendCallEnded', () => {
    it('emits call-ended to connected user', () => {
      registerUser('alice');
      gateway.sendCallEnded('alice', makeCall());
      expect(emitSpy).toHaveBeenCalledWith('call-ended', expect.any(Object));
    });

    it('does nothing when user is not connected', () => {
      gateway.sendCallEnded('offline', makeCall());
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('sendCallRejected', () => {
    it('emits call-rejected to connected user', () => {
      registerUser('alice');
      gateway.sendCallRejected('alice', makeCall());
      expect(emitSpy).toHaveBeenCalledWith('call-rejected', expect.any(Object));
    });

    it('does nothing when user is not connected', () => {
      gateway.sendCallRejected('offline', makeCall());
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('sendCallMissed', () => {
    it('emits call-missed to connected user', () => {
      registerUser('alice');
      gateway.sendCallMissed('alice', makeCall());
      expect(emitSpy).toHaveBeenCalledWith('call-missed', expect.any(Object));
    });

    it('does nothing when user is not connected', () => {
      gateway.sendCallMissed('offline', makeCall());
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('sendUserLeft', () => {
    it('emits user-left with leaving user info', () => {
      registerUser('alice');
      gateway.sendUserLeft('alice', makeCall(), 'bob');
      expect(emitSpy).toHaveBeenCalledWith('user-left', expect.objectContaining({ userId: 'bob' }));
    });
  });

  describe('sendUserJoined', () => {
    it('emits user-joined with joining user info', () => {
      registerUser('alice');
      gateway.sendUserJoined('alice', makeCall(), 'bob');
      expect(emitSpy).toHaveBeenCalledWith('user-joined', expect.objectContaining({ userId: 'bob' }));
    });
  });

  describe('broadcastToCall', () => {
    it('broadcasts event to entire call room', () => {
      gateway.broadcastToCall('call-1', 'ms:producer-closed', { producerId: 'p1' });
      expect(gateway.server.to).toHaveBeenCalledWith('call:call-1');
      expect(emitSpy).toHaveBeenCalledWith('ms:producer-closed', { producerId: 'p1' });
    });
  });

  // ─── Utility ──────────────────────────────────────────────────────────────

  describe('isUserConnected', () => {
    it('returns true for registered user', () => {
      registerUser('alice');
      expect(gateway.isUserConnected('alice')).toBe(true);
    });

    it('returns false for unknown user', () => {
      expect(gateway.isUserConnected('nobody')).toBe(false);
    });
  });

  describe('getUsersInCall', () => {
    it('returns list of users in call room', async () => {
      await gateway.handleJoinCall({ callId: 'call-1', userId: 'alice' }, mockSocket);
      expect(gateway.getUsersInCall('call-1')).toContain('alice');
    });

    it('returns empty array for unknown call', () => {
      expect(gateway.getUsersInCall('unknown')).toEqual([]);
    });
  });
});
