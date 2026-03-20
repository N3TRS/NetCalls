import { Controller, Post, Body, Param, Get } from '@nestjs/common';
import { CallService } from './calls.service';
import { CreateCallDto } from './dto/create-call.dto';

@Controller('calls')
export class CallController {
  constructor(private service: CallService) {}

  @Post('create')
  createCall(@Body() data: CreateCallDto) {
    return this.service.createCall(data.callerId, data.calleeId);
  }

  @Post(':id/accept')
  acceptCall(@Param('id') id: string) {
    return this.service.acceptCall(id);
  }

  @Post(':id/reject')
  rejectCall(@Param('id') id: string) {
    return this.service.rejectCall(id);
  }

  @Post(':id/end')
  endCall(@Param('id') id: string) {
    return this.service.endCall(id);
  }

  @Get(':id')
  getCall(@Param('id') id: string) {
    return this.service.getOrFail(id);
  }
}