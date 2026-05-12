import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CallService } from '../../src/calls/calls.service';
import { CallRepository } from '../../src/calls/calls.repository';
import { EventService } from '../../src/events/event.service';
import { CallGateway } from '../../src/calls/gateway/gateway';
import { MediasoupService } from '../../src/calls/mediasoup/mediasoup.service';
import { Call } from '../../src/calls/entities/call.entity';
import { CallStatus } from '../../src/calls/enum/callStatusEnum';

const makeCall = (overrides: Partial<Call> = {}): Call => ({
  id: 'call-1',
  callerId: 'caller',
  participants: ['p1', 'p2'],
  activeParticipants: ['caller'],
  acceptedUsers: [],
  rejectedUsers: [],
  status: CallStatus.RINGING,
  createdAt: new Date(),
  ...overrides,
});

describe('CallService', () => {
  let service: CallService;
  let repo: jest.Mocked<CallRepository>;
  let gateway: jest.Mocked<CallGateway>;
  let eventService: jest.Mocked<EventService>;
  let mediasoupService: jest.Mocked<MediasoupService>;

  beforeEach(async () => {
    const mockRepo = {
      save: jest.fn().mockImplementation((c) => Promise.resolve(c)),
      findById: jest.fn().mockResolvedValue(null),
      findActiveCall: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
      forceEndUserCalls: jest.fn().mockResolvedValue(0),
    };

    const mockGateway = {
      sendIncomingCall: jest.fn(),
      sendCallAccepted: jest.fn(),
      sendCallRejected: jest.fn(),
      sendCallEnded: jest.fn(),
      sendCallMissed: jest.fn(),
      sendUserLeft: jest.fn(),
      sendUserJoined: jest.fn(),
      broadcastToCall: jest.fn(),
    };

    const mockEventService = { emit: jest.fn() };

    const mockMediasoupService = {
      closeRoom: jest.fn(),
      closeUserResources: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallService,
        { provide: CallRepository, useValue: mockRepo },
        { provide: EventService, useValue: mockEventService },
        { provide: CallGateway, useValue: mockGateway },
        { provide: MediasoupService, useValue: mockMediasoupService },
      ],
    }).compile();

    service = module.get<CallService>(CallService);
    repo = module.get(CallRepository);
    gateway = module.get(CallGateway);
    eventService = module.get(EventService);
    mediasoupService = module.get(MediasoupService);
  });

  // createCall

  describe('createCall', () => {
    it('saves the call, notifies participants and emits event', async () => {
      jest.useFakeTimers();

      const result = await service.createCall('caller', ['p1', 'p2']);

      expect(repo.save).toHaveBeenCalled();
      expect(gateway.sendIncomingCall).toHaveBeenCalledTimes(2);
      expect(gateway.sendIncomingCall).toHaveBeenCalledWith('p1', expect.any(Object));
      expect(gateway.sendIncomingCall).toHaveBeenCalledWith('p2', expect.any(Object));
      expect(eventService.emit).toHaveBeenCalledWith('call.created', expect.any(Object));
      expect(result.status).toBe(CallStatus.RINGING);
      expect(result.callerId).toBe('caller');

      jest.useRealTimers();
    });

    it('throws if callerId is empty', async () => {
      await expect(service.createCall('', ['p1'])).rejects.toThrow(BadRequestException);
    });

    it('throws if participants array is empty', async () => {
      await expect(service.createCall('caller', [])).rejects.toThrow(BadRequestException);
    });

    it('throws if caller is included in participants', async () => {
      await expect(service.createCall('caller', ['caller', 'p1'])).rejects.toThrow(BadRequestException);
    });

    it('throws if the caller is already in an active call', async () => {
      repo.findActiveCall.mockResolvedValueOnce(makeCall());
      await expect(service.createCall('caller', ['p1'])).rejects.toThrow(BadRequestException);
    });

    it('throws if a participant is already in an active call', async () => {
      repo.findActiveCall
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeCall({ callerId: 'p1' }));
      await expect(service.createCall('caller', ['p1'])).rejects.toThrow(BadRequestException);
    });

    it('transitions to MISSED after 50 seconds if still RINGING', async () => {
      jest.useFakeTimers();

      const savedCall = makeCall({ status: CallStatus.RINGING });
      repo.findById.mockResolvedValue(savedCall);

      await service.createCall('caller', ['p1']);

      await jest.runAllTimersAsync();

      expect(savedCall.status).toBe(CallStatus.MISSED);
      expect(eventService.emit).toHaveBeenCalledWith('call.missed', savedCall);

      jest.useRealTimers();
    });
  });

  // acceptCall 

  describe('acceptCall', () => {
    it('transitions status from RINGING to ACCEPTED and sets startedAt', async () => {
      const call = makeCall({ participants: ['p1'] });
      repo.findById.mockResolvedValue(call);

      const result = await service.acceptCall('call-1', 'p1');

      expect(result.status).toBe(CallStatus.ACCEPTED);
      expect(result.startedAt).toBeInstanceOf(Date);
      expect(result.acceptedUsers).toContain('p1');
    });

    it('does not reset startedAt on a second accept', async () => {
      const startedAt = new Date('2024-01-01');
      const call = makeCall({
        status: CallStatus.ACCEPTED,
        participants: ['p1', 'p2'],
        acceptedUsers: ['p1'],
        startedAt,
      });
      repo.findById.mockResolvedValue(call);

      await service.acceptCall('call-1', 'p2');

      expect(call.startedAt).toBe(startedAt);
    });

    it('does not add user twice to acceptedUsers', async () => {
      const call = makeCall({ participants: ['p1'], acceptedUsers: ['p1'], status: CallStatus.ACCEPTED });
      repo.findById.mockResolvedValue(call);

      await service.acceptCall('call-1', 'p1');

      expect(call.acceptedUsers.filter((u) => u === 'p1')).toHaveLength(1);
    });

    it('notifies all users via gateway', async () => {
      const call = makeCall({ participants: ['p1'] });
      repo.findById.mockResolvedValue(call);

      await service.acceptCall('call-1', 'p1');

      expect(gateway.sendCallAccepted).toHaveBeenCalled();
    });

    it('throws NotFoundException when call does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.acceptCall('missing', 'p1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when call status is ENDED', async () => {
      repo.findById.mockResolvedValue(makeCall({ status: CallStatus.ENDED, participants: ['p1'] }));
      await expect(service.acceptCall('call-1', 'p1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when user is not a participant', async () => {
      repo.findById.mockResolvedValue(makeCall({ participants: ['p1'] }));
      await expect(service.acceptCall('call-1', 'stranger')).rejects.toThrow(BadRequestException);
    });
  });

  // rejectCall 

  describe('rejectCall', () => {
    it('adds user to rejectedUsers and keeps RINGING when not all rejected', async () => {
      const call = makeCall({ participants: ['p1', 'p2'] });
      repo.findById.mockResolvedValue(call);

      const result = await service.rejectCall('call-1', 'p1');

      expect(result.rejectedUsers).toContain('p1');
      expect(result.status).toBe(CallStatus.RINGING);
    });

    it('transitions to REJECTED when all participants reject', async () => {
      const call = makeCall({ participants: ['p1'] });
      repo.findById.mockResolvedValue(call);

      const result = await service.rejectCall('call-1', 'p1');

      expect(result.status).toBe(CallStatus.REJECTED);
    });

    it('does not add user twice to rejectedUsers', async () => {
      const call = makeCall({ participants: ['p1'], rejectedUsers: ['p1'] });
      repo.findById.mockResolvedValue(call);

      await service.rejectCall('call-1', 'p1');

      expect(call.rejectedUsers.filter((u) => u === 'p1')).toHaveLength(1);
    });

    it('notifies all users via gateway', async () => {
      const call = makeCall({ participants: ['p1'] });
      repo.findById.mockResolvedValue(call);

      await service.rejectCall('call-1', 'p1');

      expect(gateway.sendCallRejected).toHaveBeenCalled();
    });

    it('throws NotFoundException when call does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.rejectCall('missing', 'p1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when call is already ENDED', async () => {
      repo.findById.mockResolvedValue(makeCall({ status: CallStatus.ENDED, participants: ['p1'] }));
      await expect(service.rejectCall('call-1', 'p1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when user is not a participant', async () => {
      repo.findById.mockResolvedValue(makeCall({ participants: ['p1'] }));
      await expect(service.rejectCall('call-1', 'stranger')).rejects.toThrow(BadRequestException);
    });
  });

  //  endCall 

  describe('endCall', () => {
    it('transitions ACCEPTED call to ENDED and sets endedAt', async () => {
      repo.findById.mockResolvedValue(makeCall({ status: CallStatus.ACCEPTED }));

      const result = await service.endCall('call-1');

      expect(result.status).toBe(CallStatus.ENDED);
      expect(result.endedAt).toBeInstanceOf(Date);
    });

    it('transitions RINGING call to ENDED', async () => {
      repo.findById.mockResolvedValue(makeCall({ status: CallStatus.RINGING }));

      const result = await service.endCall('call-1');

      expect(result.status).toBe(CallStatus.ENDED);
    });

    it('notifies all users and emits call.ended event', async () => {
      repo.findById.mockResolvedValue(makeCall({ status: CallStatus.ACCEPTED }));

      await service.endCall('call-1');

      expect(gateway.sendCallEnded).toHaveBeenCalled();
      expect(eventService.emit).toHaveBeenCalledWith('call.ended', expect.any(Object));
    });

    it('closes the mediasoup room', async () => {
      repo.findById.mockResolvedValue(makeCall({ status: CallStatus.ACCEPTED }));

      await service.endCall('call-1');

      expect(mediasoupService.closeRoom).toHaveBeenCalledWith('call-1');
    });

    it('throws BadRequestException when call is already ENDED', async () => {
      repo.findById.mockResolvedValue(makeCall({ status: CallStatus.ENDED }));
      await expect(service.endCall('call-1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when call does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.endCall('missing')).rejects.toThrow(NotFoundException);
    });
  });


  describe('leaveCall', () => {
    it('removes participant from activeParticipants', async () => {
      const call = makeCall({
        status: CallStatus.ACCEPTED,
        activeParticipants: ['caller', 'p1'],
      });
      repo.findById.mockResolvedValue(call);

      await service.leaveCall('call-1', 'p1');

      expect(call.activeParticipants).not.toContain('p1');
    });

    it('ends the call when the caller leaves', async () => {
      const call = makeCall({ status: CallStatus.ACCEPTED, activeParticipants: ['caller', 'p1'] });
      repo.findById.mockResolvedValue(call);

      const result = await service.leaveCall('call-1', 'caller');

      expect(result.status).toBe(CallStatus.ENDED);
    });

    it('notifies others via gateway when a non-caller leaves', async () => {
      const call = makeCall({
        status: CallStatus.ACCEPTED,
        activeParticipants: ['caller', 'p1'],
      });
      repo.findById.mockResolvedValue(call);

      await service.leaveCall('call-1', 'p1');

      expect(gateway.sendUserLeft).toHaveBeenCalled();
    });

    it('returns response without changes when call is not active', async () => {
      const call = makeCall({ status: CallStatus.ENDED });
      repo.findById.mockResolvedValue(call);

      const result = await service.leaveCall('call-1', 'p1');

      expect(result.status).toBe(CallStatus.ENDED);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('returns response without changes when user is not an active participant', async () => {
      const call = makeCall({ status: CallStatus.ACCEPTED, activeParticipants: ['caller'] });
      repo.findById.mockResolvedValue(call);

      await service.leaveCall('call-1', 'p1');

      expect(repo.save).not.toHaveBeenCalled();
    });
  });


  describe('joinCall', () => {
    it('adds user to activeParticipants and participants', async () => {
      const call = makeCall({ status: CallStatus.ACCEPTED, participants: ['p1'] });
      repo.findById.mockResolvedValue(call);

      await service.joinCall('call-1', 'p2');

      expect(call.participants).toContain('p2');
      expect(call.activeParticipants).toContain('p2');
    });

    it('notifies all users via gateway', async () => {
      const call = makeCall({ status: CallStatus.ACCEPTED });
      repo.findById.mockResolvedValue(call);

      await service.joinCall('call-1', 'p1');

      expect(gateway.sendUserJoined).toHaveBeenCalled();
    });

    it('throws BadRequestException when call is not ACCEPTED', async () => {
      repo.findById.mockResolvedValue(makeCall({ status: CallStatus.RINGING }));
      await expect(service.joinCall('call-1', 'p1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when call does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.joinCall('missing', 'p1')).rejects.toThrow(NotFoundException);
    });
  });


  describe('inviteToCall', () => {
    it('adds new invitees, sends incoming-call events and emits call.invited', async () => {
      const call = makeCall({ status: CallStatus.ACCEPTED, activeParticipants: ['caller'] });
      repo.findById.mockResolvedValue(call);

      await service.inviteToCall('call-1', 'caller', ['p3']);

      expect(call.participants).toContain('p3');
      expect(gateway.sendIncomingCall).toHaveBeenCalledWith('p3', expect.any(Object));
      expect(eventService.emit).toHaveBeenCalledWith('call.invited', expect.any(Object));
    });

    it('returns response without changes when all invitees are already in call', async () => {
      const call = makeCall({ status: CallStatus.ACCEPTED, participants: ['p1'], activeParticipants: ['caller'] });
      repo.findById.mockResolvedValue(call);

      await service.inviteToCall('call-1', 'caller', ['p1']);

      expect(gateway.sendIncomingCall).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when inviter is not in the call', async () => {
      const call = makeCall({ status: CallStatus.ACCEPTED, activeParticipants: ['caller'] });
      repo.findById.mockResolvedValue(call);

      await expect(service.inviteToCall('call-1', 'outsider', ['p3'])).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when call is not active', async () => {
      repo.findById.mockResolvedValue(makeCall({ status: CallStatus.ENDED }));
      await expect(service.inviteToCall('call-1', 'caller', ['p3'])).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when an invitee is already in another call', async () => {
      const call = makeCall({ status: CallStatus.ACCEPTED, activeParticipants: ['caller'] });
      repo.findById.mockResolvedValue(call);
      repo.findActiveCall.mockResolvedValueOnce(makeCall({ callerId: 'p3' }));

      await expect(service.inviteToCall('call-1', 'caller', ['p3'])).rejects.toThrow(BadRequestException);
    });
  });


  describe('cleanupUserCalls', () => {
    it('delegates to repo.forceEndUserCalls and returns summary', async () => {
      repo.forceEndUserCalls.mockResolvedValue(2);

      const result = await service.cleanupUserCalls('alice');

      expect(repo.forceEndUserCalls).toHaveBeenCalledWith('alice');
      expect(result.count).toBe(2);
      expect(result.success).toBe(true);
    });
  });


  describe('getAllCalls', () => {
    it('returns all calls from the repository', async () => {
      const calls = [makeCall({ id: 'c1' }), makeCall({ id: 'c2' })];
      repo.findAll.mockResolvedValue(calls);

      const result = await service.getAllCalls();

      expect(result).toBe(calls);
    });
  });


  describe('getCallResponse', () => {
    it('returns mapped response for existing call', async () => {
      const call = makeCall({ status: CallStatus.ACCEPTED });
      repo.findById.mockResolvedValue(call);

      const result = await service.getCallResponse('call-1');

      expect(result.callId).toBe('call-1');
      expect(result.status).toBe(CallStatus.ACCEPTED);
    });

    it('throws NotFoundException when call does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.getCallResponse('missing')).rejects.toThrow(NotFoundException);
    });
  });


  describe('leaveCall broadcastToCall', () => {
    it('broadcasts closed producer ids when mediasoup returns them', async () => {
      const call = makeCall({ status: CallStatus.ACCEPTED, activeParticipants: ['caller', 'p1'] });
      repo.findById.mockResolvedValue(call);
      mediasoupService.closeUserResources.mockResolvedValue(['prod-1', 'prod-2']);

      await service.leaveCall('call-1', 'p1');

      expect(gateway.broadcastToCall).toHaveBeenCalledWith('call-1', 'ms:producer-closed', { producerId: 'prod-1' });
      expect(gateway.broadcastToCall).toHaveBeenCalledWith('call-1', 'ms:producer-closed', { producerId: 'prod-2' });
    });
  });
});
