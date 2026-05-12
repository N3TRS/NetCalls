import { EventService } from '../../src/events/event.service';

describe('EventService', () => {
  let service: EventService;

  beforeEach(() => {
    service = new EventService();
  });

  it('emit logs the event without throwing', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    service.emit('call.created', { id: 'call-1' });
    expect(spy).toHaveBeenCalledWith('EVENT: call.created', expect.any(Object));
    spy.mockRestore();
  });

  it('emit accepts any payload', () => {
    expect(() => service.emit('call.ended', null)).not.toThrow();
    expect(() => service.emit('call.missed', undefined)).not.toThrow();
  });
});
