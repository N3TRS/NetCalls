import { CallRepository } from '../../src/calls/calls.repository';
import { Call } from '../../src/calls/entities/call.entity';
import { CallStatus } from '../../src/calls/enum/callStatusEnum';

const makeCall = (overrides: Partial<Call> = {}): Call => ({
  id: 'call-1',
  callerId: 'user-1',
  participants: ['user-2'],
  activeParticipants: ['user-1'],
  acceptedUsers: [],
  rejectedUsers: [],
  status: CallStatus.RINGING,
  createdAt: new Date(),
  ...overrides,
});

describe('CallRepository', () => {
  let repo: CallRepository;

  beforeEach(() => {
    repo = new CallRepository();
  });

  describe('save & findById', () => {
    it('saves a call and retrieves it by id', async () => {
      const call = makeCall();
      await repo.save(call);
      expect(await repo.findById('call-1')).toEqual(call);
    });

    it('returns null for an unknown id', async () => {
      expect(await repo.findById('nonexistent')).toBeNull();
    });

    it('overwrites existing call on re-save', async () => {
      const call = makeCall();
      await repo.save(call);
      call.status = CallStatus.ACCEPTED;
      await repo.save(call);
      expect((await repo.findById('call-1'))?.status).toBe(CallStatus.ACCEPTED);
    });

    it('returns the saved call instance', async () => {
      const call = makeCall();
      const returned = await repo.save(call);
      expect(returned).toBe(call);
    });
  });

  describe('findActiveCall', () => {
    it('finds a RINGING call for the caller', async () => {
      await repo.save(makeCall({ id: 'c1', callerId: 'alice', status: CallStatus.RINGING }));
      expect(await repo.findActiveCall('alice')).not.toBeNull();
    });

    it('finds an ACCEPTED call for an active participant', async () => {
      await repo.save(
        makeCall({ id: 'c1', status: CallStatus.ACCEPTED, activeParticipants: ['user-1', 'bob'] }),
      );
      expect(await repo.findActiveCall('bob')).not.toBeNull();
    });

    it('returns null for ENDED calls', async () => {
      await repo.save(makeCall({ callerId: 'alice', status: CallStatus.ENDED }));
      expect(await repo.findActiveCall('alice')).toBeNull();
    });

    it('returns null for REJECTED calls', async () => {
      await repo.save(makeCall({ callerId: 'alice', status: CallStatus.REJECTED }));
      expect(await repo.findActiveCall('alice')).toBeNull();
    });

    it('returns null for MISSED calls', async () => {
      await repo.save(makeCall({ callerId: 'alice', status: CallStatus.MISSED }));
      expect(await repo.findActiveCall('alice')).toBeNull();
    });

    it('returns null if user is not in any active call', async () => {
      await repo.save(makeCall({ callerId: 'alice', status: CallStatus.RINGING }));
      expect(await repo.findActiveCall('charlie')).toBeNull();
    });

    it('returns null when the store is empty', async () => {
      expect(await repo.findActiveCall('anyone')).toBeNull();
    });
  });

  describe('forceEndUserCalls', () => {
    it('ends RINGING and ACCEPTED calls and returns the count', async () => {
      await repo.save(makeCall({ id: 'c1', callerId: 'alice', status: CallStatus.RINGING }));
      await repo.save(makeCall({ id: 'c2', callerId: 'alice', status: CallStatus.ACCEPTED }));
      await repo.save(makeCall({ id: 'c3', callerId: 'alice', status: CallStatus.ENDED }));

      const count = await repo.forceEndUserCalls('alice');

      expect(count).toBe(2);
      expect((await repo.findById('c1'))?.status).toBe(CallStatus.ENDED);
      expect((await repo.findById('c2'))?.status).toBe(CallStatus.ENDED);
    });

    it('sets endedAt on forced-ended calls', async () => {
      await repo.save(makeCall({ id: 'c1', callerId: 'alice', status: CallStatus.RINGING }));
      await repo.forceEndUserCalls('alice');
      expect((await repo.findById('c1'))?.endedAt).toBeInstanceOf(Date);
    });

    it('returns 0 when the user has no active calls', async () => {
      expect(await repo.forceEndUserCalls('nobody')).toBe(0);
    });

    it('ends calls where user is an active participant', async () => {
      await repo.save(
        makeCall({ id: 'c1', callerId: 'bob', activeParticipants: ['bob', 'alice'], status: CallStatus.ACCEPTED }),
      );
      const count = await repo.forceEndUserCalls('alice');
      expect(count).toBe(1);
    });
  });

  describe('findAll', () => {
    it('returns all saved calls', async () => {
      await repo.save(makeCall({ id: 'c1' }));
      await repo.save(makeCall({ id: 'c2' }));
      expect(await repo.findAll()).toHaveLength(2);
    });

    it('returns an empty array when no calls exist', async () => {
      expect(await repo.findAll()).toEqual([]);
    });
  });
});
