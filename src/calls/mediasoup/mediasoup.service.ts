import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MediasoupService {
  private readonly logger = new Logger(MediasoupService.name);
  private readonly baseUrl =
    process.env.MEDIASOUP_SERVER_URL ?? 'http://localhost:3001';

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data = (await res.json()) as any;
    if (!res.ok) {
      throw new Error(data.error ?? `mediasoup-server error ${res.status}`);
    }
    return data as T;
  }

  async ensureRoom(callId: string): Promise<void> {
    await this.request('POST', `/rooms/${callId}`);
  }

  async getRouterRtpCapabilities(callId: string): Promise<any> {
    return this.request('GET', `/rooms/${callId}/rtp-capabilities`);
  }

  async createTransport(callId: string, userId: string): Promise<any> {
    return this.request('POST', `/rooms/${callId}/transports`, { userId });
  }

  async connectTransport(
    callId: string,
    transportId: string,
    dtlsParameters: any,
  ): Promise<void> {
    await this.request(
      'POST',
      `/rooms/${callId}/transports/${transportId}/connect`,
      { dtlsParameters },
    );
  }

  async produce(
    callId: string,
    transportId: string,
    userId: string,
    kind: string,
    rtpParameters: any,
  ): Promise<string> {
    const { producerId } = await this.request<{ producerId: string }>(
      'POST',
      `/rooms/${callId}/transports/${transportId}/produce`,
      { userId, kind, rtpParameters },
    );
    return producerId;
  }

  async consume(
    callId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: any,
  ): Promise<any> {
    return this.request('POST', `/rooms/${callId}/consume`, {
      transportId,
      producerId,
      rtpCapabilities,
    });
  }

  async resumeConsumer(callId: string, consumerId: string): Promise<void> {
    await this.request(
      'POST',
      `/rooms/${callId}/consumers/${consumerId}/resume`,
    );
  }

  async getProducers(
    callId: string,
  ): Promise<{ userId: string; producerId: string; kind: string }[]> {
    const result = await this.request<{ producers: any[] }>(
      'GET',
      `/rooms/${callId}/producers`,
    ).catch(() => ({ producers: [] }));
    return result.producers;
  }

  async closeUserResources(callId: string, userId: string): Promise<string[]> {
    const result = await this.request<{ closedProducerIds: string[] }>(
      'DELETE',
      `/rooms/${callId}/users/${userId}`,
    ).catch(() => ({ closedProducerIds: [] }));
    return result.closedProducerIds;
  }

  closeRoom(callId: string): void {
    this.request('DELETE', `/rooms/${callId}`).catch((err) =>
      this.logger.warn(`closeRoom failed: ${err.message}`),
    );
  }
}
