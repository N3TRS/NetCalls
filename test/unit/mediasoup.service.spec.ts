import { MediasoupService } from '../../src/calls/mediasoup/mediasoup.service';

describe('MediasoupService', () => {
  let service: MediasoupService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    service = new MediasoupService();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  const okResponse = (data: any) =>
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) });

  const errResponse = (data: any, status = 500) =>
    fetchMock.mockResolvedValue({ ok: false, status, json: () => Promise.resolve(data) });

  describe('ensureRoom', () => {
    it('posts to /rooms/:callId', async () => {
      okResponse({});
      await service.ensureRoom('call-1');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/rooms/call-1'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws when server returns error', async () => {
      errResponse({ error: 'Room already exists' });
      await expect(service.ensureRoom('call-1')).rejects.toThrow('Room already exists');
    });
  });

  describe('getRouterRtpCapabilities', () => {
    it('returns router rtp capabilities', async () => {
      const caps = { codecs: [], headerExtensions: [] };
      okResponse(caps);
      expect(await service.getRouterRtpCapabilities('call-1')).toEqual(caps);
    });
  });

  describe('createTransport', () => {
    it('returns transport parameters', async () => {
      const transport = { id: 'transport-1', iceParameters: {} };
      okResponse(transport);
      const result = await service.createTransport('call-1', 'user-1');
      expect(result).toEqual(transport);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/rooms/call-1/transports'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('connectTransport', () => {
    it('sends dtlsParameters to connect endpoint', async () => {
      okResponse({});
      await service.connectTransport('call-1', 'transport-1', { fingerprints: [] });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/transports/transport-1/connect'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('produce', () => {
    it('returns producerId from server', async () => {
      okResponse({ producerId: 'prod-1' });
      const result = await service.produce('call-1', 'transport-1', 'user-1', 'audio', {});
      expect(result).toBe('prod-1');
    });
  });

  describe('consume', () => {
    it('returns consumer data', async () => {
      const consumer = { id: 'consumer-1', kind: 'audio', rtpParameters: {} };
      okResponse(consumer);
      const result = await service.consume('call-1', 'transport-1', 'producer-1', {});
      expect(result).toEqual(consumer);
    });
  });

  describe('resumeConsumer', () => {
    it('posts to resume endpoint', async () => {
      okResponse({});
      await service.resumeConsumer('call-1', 'consumer-1');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/consumers/consumer-1/resume'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('getProducers', () => {
    it('returns list of producers', async () => {
      const producers = [{ userId: 'u1', producerId: 'p1', kind: 'video' }];
      okResponse({ producers });
      expect(await service.getProducers('call-1')).toEqual(producers);
    });

    it('returns empty array when fetch fails', async () => {
      fetchMock.mockRejectedValue(new Error('network error'));
      expect(await service.getProducers('call-1')).toEqual([]);
    });
  });

  describe('closeUserResources', () => {
    it('returns closed producer ids', async () => {
      okResponse({ closedProducerIds: ['p1', 'p2'] });
      const result = await service.closeUserResources('call-1', 'user-1');
      expect(result).toEqual(['p1', 'p2']);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/rooms/call-1/users/user-1'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('returns empty array when fetch fails', async () => {
      fetchMock.mockRejectedValue(new Error('network error'));
      expect(await service.closeUserResources('call-1', 'user-1')).toEqual([]);
    });
  });

  describe('closeRoom', () => {
    it('fires DELETE request to room endpoint', () => {
      okResponse({});
      service.closeRoom('call-1');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/rooms/call-1'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('does not throw when request fails', () => {
      fetchMock.mockRejectedValue(new Error('connection refused'));
      expect(() => service.closeRoom('call-1')).not.toThrow();
    });
  });
});
