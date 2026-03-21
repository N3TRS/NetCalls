import { Injectable } from '@nestjs/common';

@Injectable()
export class EventService {
  emit(event: string, payload: any) {
    console.log(`EVENT: ${event}`, payload);
  }
}
