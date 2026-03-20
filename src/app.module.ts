import { Module } from '@nestjs/common';
import { CallController } from './calls/calls.controller';
import { CallRepository } from './calls/calls.repository';
import { CallService } from './calls/calls.service';
import { EventService } from './events/event.service';

@Module({
  imports: [],
  controllers: [CallController],
  providers: [CallService, CallRepository, EventService],
  exports: [EventService],
})
export class AppModule {}
