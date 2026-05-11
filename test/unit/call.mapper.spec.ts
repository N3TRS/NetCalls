import { CallMapper } from '../../src/calls/mappers/call.mapper';
import { Call } from '../../src/calls/entities/call.entity';
import { CallStatus } from '../../src/calls/enum/callStatusEnum';

describe('CallMapper', () => {
  const baseCall: Call = {
    id: 'call-id',
    callerId: 'caller',
    participants: ['p1', 'p2'],
    activeParticipants: ['caller', 'p1'],
    acceptedUsers: ['p1'],
    rejectedUsers: [],
    status: CallStatus.ACCEPTED,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    startedAt: new Date('2024-01-01T00:00:10Z'),
  };

  it('maps id to callId', () => {
    expect(CallMapper.toResponse(baseCall).callId).toBe('call-id');
  });

  it('maps all scalar fields correctly', () => {
    const dto = CallMapper.toResponse(baseCall);
    expect(dto.callerId).toBe(baseCall.callerId);
    expect(dto.participants).toBe(baseCall.participants);
    expect(dto.activeParticipants).toBe(baseCall.activeParticipants);
    expect(dto.acceptedUsers).toBe(baseCall.acceptedUsers);
    expect(dto.rejectedUsers).toBe(baseCall.rejectedUsers);
    expect(dto.status).toBe(baseCall.status);
    expect(dto.createdAt).toBe(baseCall.createdAt);
    expect(dto.startedAt).toBe(baseCall.startedAt);
  });

  it('sets endedAt to undefined when not present on the entity', () => {
    expect(CallMapper.toResponse(baseCall).endedAt).toBeUndefined();
  });

  it('maps endedAt when present on the entity', () => {
    const endedAt = new Date('2024-01-01T01:00:00Z');
    const dto = CallMapper.toResponse({ ...baseCall, endedAt });
    expect(dto.endedAt).toBe(endedAt);
  });

  it('maps startedAt to undefined when not present', () => {
    const { startedAt: _, ...withoutStartedAt } = baseCall;
    const dto = CallMapper.toResponse(withoutStartedAt as Call);
    expect(dto.startedAt).toBeUndefined();
  });
});
