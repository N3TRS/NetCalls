import { MetricsInterceptor } from '../../src/metrics/metrics.interceptor';
import { of } from 'rxjs';

describe('MetricsInterceptor', () => {
  let interceptor: MetricsInterceptor;
  const endTimer = jest.fn();
  const mockMetricsService = {
    httpRequestDuration: { startTimer: jest.fn().mockReturnValue(endTimer) },
    httpRequestsTotal: { inc: jest.fn() },
  };

  beforeEach(() => {
    interceptor = new MetricsInterceptor(mockMetricsService as any);
    jest.clearAllMocks();
    mockMetricsService.httpRequestDuration.startTimer.mockReturnValue(endTimer);
  });

  const makeContext = (method: string, url: string, routePath: string | null, statusCode: number) => ({
    switchToHttp: () => ({
      getRequest: () => ({ method, url, route: routePath ? { path: routePath } : null }),
      getResponse: () => ({ statusCode }),
    }),
  } as any);

  it('starts a duration timer with method and route', (done) => {
    const ctx = makeContext('POST', '/calls', '/calls', 201);
    interceptor.intercept(ctx, { handle: () => of({}) } as any).subscribe({
      complete: () => {
        expect(mockMetricsService.httpRequestDuration.startTimer).toHaveBeenCalledWith({
          method: 'POST',
          route: '/calls',
        });
        done();
      },
    });
  });

  it('calls end timer and increments request counter after response', (done) => {
    const ctx = makeContext('GET', '/calls/123', '/calls/:id', 200);
    interceptor.intercept(ctx, { handle: () => of({}) } as any).subscribe({
      complete: () => {
        expect(endTimer).toHaveBeenCalled();
        expect(mockMetricsService.httpRequestsTotal.inc).toHaveBeenCalledWith({
          method: 'GET',
          status: 200,
          route: '/calls/:id',
        });
        done();
      },
    });
  });

  it('falls back to req.url when route.path is not available', (done) => {
    const ctx = makeContext('GET', '/metrics', null, 200);
    interceptor.intercept(ctx, { handle: () => of({}) } as any).subscribe({
      complete: () => {
        expect(mockMetricsService.httpRequestDuration.startTimer).toHaveBeenCalledWith({
          method: 'GET',
          route: '/metrics',
        });
        expect(mockMetricsService.httpRequestsTotal.inc).toHaveBeenCalledWith(
          expect.objectContaining({ route: '/metrics' }),
        );
        done();
      },
    });
  });
});
