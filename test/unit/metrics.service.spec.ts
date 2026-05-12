jest.mock('prom-client', () => ({
  Registry: jest.fn().mockImplementation(() => ({
    contentType: 'text/plain; version=0.0.4',
    metrics: jest.fn().mockResolvedValue('# metrics'),
  })),
  Counter: jest.fn().mockImplementation(() => ({ inc: jest.fn() })),
  Histogram: jest.fn().mockImplementation(() => ({
    startTimer: jest.fn().mockReturnValue(jest.fn()),
    observe: jest.fn(),
  })),
  collectDefaultMetrics: jest.fn(),
}));

import { MetricsService } from '../../src/metrics/metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  it('creates a Prometheus registry', () => {
    expect(service.registry).toBeDefined();
  });

  it('creates httpRequestsTotal counter', () => {
    expect(service.httpRequestsTotal).toBeDefined();
  });

  it('creates httpRequestDuration histogram', () => {
    expect(service.httpRequestDuration).toBeDefined();
  });

  it('registers default metrics on the custom registry', () => {
    const { collectDefaultMetrics } = require('prom-client');
    expect(collectDefaultMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ register: service.registry }),
    );
  });
});
