import { Test, TestingModule } from '@nestjs/testing';
import { MetricsController } from '../../src/metrics/metrics.controller';
import { MetricsService } from '../../src/metrics/metrics.service';

describe('MetricsController', () => {
  let controller: MetricsController;
  const metricsOutput = '# HELP http_requests_total Total HTTP requests\n# TYPE http_requests_total counter';
  const mockMetricsService = {
    registry: {
      contentType: 'text/plain; version=0.0.4; charset=utf-8',
      metrics: jest.fn().mockResolvedValue(metricsOutput),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [{ provide: MetricsService, useValue: mockMetricsService }],
    }).compile();

    controller = module.get<MetricsController>(MetricsController);
    jest.clearAllMocks();
    mockMetricsService.registry.metrics.mockResolvedValue(metricsOutput);
  });

  it('sets Content-Type header from registry', async () => {
    const res = { set: jest.fn(), end: jest.fn() };
    await controller.getMetrics(res as any);
    expect(res.set).toHaveBeenCalledWith('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  });

  it('ends response with prometheus metrics output', async () => {
    const res = { set: jest.fn(), end: jest.fn() };
    await controller.getMetrics(res as any);
    expect(res.end).toHaveBeenCalledWith(metricsOutput);
  });
});
