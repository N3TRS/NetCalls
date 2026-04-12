import { Controller, Get } from '@nestjs/common';
import { Registry, Counter, Histogram } from 'prom-client';

@Controller('metrics')
export class MetricsController {

  private registry: Registry;
  private httpRequestsTotal: Counter;
  private httpRequestDuration: Histogram;
  
  constructor() {
    this.registry = new Registry();
    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'status', 'route'],
      registers: [this.registry],
    });
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route'],
      buckets: [0.1, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });
  }
  @Get()
  async getMetrics() {
    return this.registry.metrics();
  }
}