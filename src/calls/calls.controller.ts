import { Controller, Post, Body, Param, Get } from '@nestjs/common';
import { CallService } from './calls.service';
import { CreateCallDto } from './dto/create-call.dto';
import { CallActionDto } from './dto/call-action.dto';

@Controller('calls')
export class CallController {
  constructor(private service: CallService) {}

  @Post('create')
  createCall(@Body() data: CreateCallDto) {
    return this.service.createCall(data.callerId, data.participants);
  }

  @Post(':id/accept')
  acceptCall(@Param('id') id: string, @Body() data: CallActionDto) {
    return this.service.acceptCall(id, data.userId);
  }

  @Post(':id/reject')
  rejectCall(@Param('id') id: string, @Body() data: CallActionDto) {
    return this.service.rejectCall(id, data.userId);
  }

  @Post(':id/end')
  endCall(@Param('id') id: string) {
    return this.service.endCall(id);
  }

  @Get(':id')
  getCall(@Param('id') id: string) {
    return this.service.getCallResponse(id);
  }
}
