import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();

    if (req.path === '/metrics' || req.url === '/metrics' || req.url?.startsWith('/metrics')) {
      return next.handle();
    }

    const end = this.metricsService.httpRequestDuration.startTimer({
      method: req.method,
      route: req.route?.path || req.url,
    });

    return next.handle().pipe(
      tap(() => {
        const res = context.switchToHttp().getResponse();
        end();
        this.metricsService.httpRequestsTotal.inc({
          method: req.method,
          status: res.statusCode,
          route: req.route?.path || req.url,
        });
      }),
    );
  }
}