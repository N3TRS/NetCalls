import { Module } from '@nestjs/common';
import { CallController } from './calls/calls.controller';
import { CallRepository } from './calls/calls.repository';
import { CallService } from './calls/calls.service';
import { EventService } from './events/event.service';
import { CallGateway } from './calls/gateway/gateway';

@Module({
  imports: [],
  controllers: [CallController],
  providers: [CallService, CallRepository, EventService, CallGateway],
  exports: [EventService],
})
export class AppModule {}
