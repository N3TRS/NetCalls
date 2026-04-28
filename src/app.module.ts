import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CallController } from './calls/calls.controller';
import { CallRepository } from './calls/calls.repository';
import { CallService } from './calls/calls.service';
import { EventService } from './events/event.service';
import { CallGateway } from './calls/gateway/gateway';
import { ConfigModule } from '@nestjs/config';
import { MetricsController } from './metrics/metrics.controller';
import { MetricsService } from './metrics/metrics.service';
import { MetricsInterceptor } from './metrics/metrics.interceptor';
import { AuthIntegrationModule } from './auth-integration/auth-integration.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), AuthIntegrationModule],
  controllers: [CallController, MetricsController],
  providers: [
    CallService,
    CallRepository,
    EventService,
    CallGateway,
    MetricsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
  exports: [EventService],
})
export class AppModule {}
