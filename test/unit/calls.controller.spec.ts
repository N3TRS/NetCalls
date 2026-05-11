import { Test, TestingModule } from '@nestjs/testing';
import { CallController } from '../../src/calls/calls.controller';
import { CallService } from '../../src/calls/calls.service';
import { JwtAuthGuard } from '../../src/auth-integration/guards/jwt-auth.guard';
import { CreateCallDto } from '../../src/calls/dto/create-call.dto';
import { CallActionDto } from '../../src/calls/dto/call-action.dto';
import { InviteCallDto } from '../../src/calls/dto/invite-call.dto';
import { CallStatus } from '../../src/calls/enum/callStatusEnum';

const mockResponse = {
  callId: 'call-1',
  callerId: 'caller',
  participants: ['p1'],
  activeParticipants: ['caller'],
  acceptedUsers: [],
  rejectedUsers: [],
  status: CallStatus.RINGING,
  createdAt: new Date(),
};

describe('CallController', () => {
  let controller: CallController;
  let service: jest.Mocked<CallService>;

  beforeEach(async () => {
    const mockService = {
      createCall: jest.fn().mockResolvedValue(mockResponse),
      acceptCall: jest.fn().mockResolvedValue(mockResponse),
      rejectCall: jest.fn().mockResolvedValue(mockResponse),
      endCall: jest.fn().mockResolvedValue(mockResponse),
      leaveCall: jest.fn().mockResolvedValue(mockResponse),
      joinCall: jest.fn().mockResolvedValue(mockResponse),
      inviteToCall: jest.fn().mockResolvedValue(mockResponse),
      getCallResponse: jest.fn().mockResolvedValue(mockResponse),
      cleanupUserCalls: jest.fn().mockResolvedValue({ success: true, count: 0, message: '' }),
      getAllCalls: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CallController],
      providers: [{ provide: CallService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CallController>(CallController);
    service = module.get(CallService);
  });

  it('createCall delegates to service with correct args', async () => {
    const dto: CreateCallDto = { callerId: 'caller', participants: ['p1'] };

    const result = await controller.createCall(dto);

    expect(service.createCall).toHaveBeenCalledWith('caller', ['p1']);
    expect(result).toBe(mockResponse);
  });

  it('acceptCall delegates to service with callId and userId', async () => {
    const dto: CallActionDto = { userId: 'p1' };

    await controller.acceptCall('call-1', dto);

    expect(service.acceptCall).toHaveBeenCalledWith('call-1', 'p1');
  });

  it('rejectCall delegates to service with callId and userId', async () => {
    const dto: CallActionDto = { userId: 'p1' };

    await controller.rejectCall('call-1', dto);

    expect(service.rejectCall).toHaveBeenCalledWith('call-1', 'p1');
  });

  it('endCall delegates to service with callId', async () => {
    await controller.endCall('call-1');

    expect(service.endCall).toHaveBeenCalledWith('call-1');
  });

  it('leaveCall delegates to service with callId and userId', async () => {
    const dto: CallActionDto = { userId: 'p1' };

    await controller.leaveCall('call-1', dto);

    expect(service.leaveCall).toHaveBeenCalledWith('call-1', 'p1');
  });

  it('joinCall delegates to service with callId and userId', async () => {
    const dto: CallActionDto = { userId: 'p1' };

    await controller.joinCall('call-1', dto);

    expect(service.joinCall).toHaveBeenCalledWith('call-1', 'p1');
  });

  it('inviteToCall delegates to service with callId, inviterId and inviteeIds', async () => {
    const dto: InviteCallDto = { inviterId: 'caller', inviteeIds: ['p3'] };

    await controller.inviteToCall('call-1', dto);

    expect(service.inviteToCall).toHaveBeenCalledWith('call-1', 'caller', ['p3']);
  });

  it('getCall delegates to service and returns response', async () => {
    const result = await controller.getCall('call-1');

    expect(service.getCallResponse).toHaveBeenCalledWith('call-1');
    expect(result).toBe(mockResponse);
  });

  it('cleanupUserCalls delegates to service with userId', async () => {
    await controller.cleanupUserCalls('alice');

    expect(service.cleanupUserCalls).toHaveBeenCalledWith('alice');
  });

  it('getAllCalls delegates to service and returns list', async () => {
    const calls = [mockResponse];
    service.getAllCalls.mockResolvedValue(calls as any);

    const result = await controller.getAllCalls();

    expect(service.getAllCalls).toHaveBeenCalled();
    expect(result).toBe(calls);
  });
});
