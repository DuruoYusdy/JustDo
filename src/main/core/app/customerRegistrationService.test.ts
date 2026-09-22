import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  buildCustomerApiBaseUrl,
  CustomerRegistrationService,
} from './customerRegistrationService';

const temporaryDirectories: string[] = [];

const writeUserInfo = (value: unknown): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-customer-registration-'));
  temporaryDirectories.push(directory);
  const userInfoPath = path.join(directory, 'user_info.json');
  fs.writeFileSync(userInfoPath, JSON.stringify(value));
  return userInfoPath;
};

const makeService = (
  request: ReturnType<typeof vi.fn>,
  userInfoPath = writeUserInfo({
    'X-User-Account': 'user-123',
    userName: 'Alice',
    loginTime: '2026-08-10T10:00:00+08:00',
  }),
) =>
  new CustomerRegistrationService({
    apiKey: 'sk-test',
    baseUrl: 'http://127.0.0.1:9108/v1',
    productName: 'JustDo',
    version: 'v2026.8.10',
    userInfoPath,
    fetch: request,
  });

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('CustomerRegistrationService', () => {
  test('retries transient activity failures with the same event and resumes daily reporting', async () => {
    vi.useFakeTimers();
    let failActivity = true;
    const request = vi.fn().mockImplementation((url: string) => Promise.resolve(
      url.endsWith('/customer/activity')
        ? new Response('{}', { status: failActivity ? 503 : 200 })
        : new Response(JSON.stringify({ alias: 'JustDo v2026.8.10' })),
    ));
    const service = makeService(request);
    service.start();
    await service.sync();
    const firstEvent = JSON.parse(request.mock.calls[1][1].body);

    await vi.advanceTimersByTimeAsync(60_000);
    await service.sync();
    expect(request).toHaveBeenCalledTimes(4);
    expect(JSON.parse(request.mock.calls[3][1].body).event_id).toBe(firstEvent.event_id);

    failActivity = false;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await service.sync();
    expect(request).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(request).toHaveBeenCalledTimes(6);
    service.stop();
  });

  test('bounds startup retries and recovers when the user info file is populated', async () => {
    vi.useFakeTimers();
    const userInfoPath = writeUserInfo({});
    const request = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ alias: 'JustDo v2026.8.10' })),
    ));
    const service = makeService(request, userInfoPath);
    service.start();
    await service.sync();

    for (const delay of [60_000, 5 * 60_000, 15 * 60_000]) {
      await vi.advanceTimersByTimeAsync(delay);
      await service.sync();
    }
    fs.writeFileSync(userInfoPath, JSON.stringify({ 'X-User-Account': 'user-123' }));
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(23 * 60 * 60_000);
    await service.sync();
    expect(request).toHaveBeenCalledTimes(2);
    service.stop();
  });

  test('reports after user info becomes available during startup retry', async () => {
    vi.useFakeTimers();
    const userInfoPath = writeUserInfo({});
    const request = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ alias: 'JustDo v2026.8.10' })),
    ));
    const service = makeService(request, userInfoPath);
    service.start();
    await service.sync();
    expect(request).not.toHaveBeenCalled();

    fs.writeFileSync(userInfoPath, JSON.stringify({ 'X-User-Account': 'user-123' }));
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(JSON.parse(request.mock.calls[1][1].body).event_type).toBe('startup');
    service.stop();
  });

  test('stopping during an in-flight request does not schedule a retry', async () => {
    vi.useFakeTimers();
    let respond: (response: Response) => void = () => undefined;
    const request = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => {
      respond = resolve;
    }));
    const service = makeService(request);
    service.start();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    service.stop();
    respond(new Response('{}', { status: 503 }));
    await service.sync();
    await vi.advanceTimersByTimeAsync(25 * 60 * 60_000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('retries the same startup event then reports heartbeat after acknowledgment', async () => {
    let failActivity = true;
    const request = vi.fn().mockImplementation((url: string) => Promise.resolve(
      url.endsWith('/customer/activity')
        ? new Response('{}', { status: failActivity ? 503 : 200 })
        : new Response(JSON.stringify({ alias: 'JustDo v2026.8.10' })),
    ));
    const service = makeService(request);
    const beforeReport = Date.now();
    await service.sync();
    failActivity = false;
    await service.sync();
    await service.sync();
    const events = request.mock.calls.filter(([url]) => url.endsWith('/customer/activity'))
      .map(([, init]) => JSON.parse(init.body));
    expect(events.map((event) => event.event_type)).toEqual(['startup', 'startup', 'heartbeat']);
    expect(events[0].event_id).toBe(events[1].event_id);
    expect(events[2].event_id).not.toBe(events[1].event_id);
    expect(events[0].metadata.userName).toBe('Alice');
    for (const event of events) {
      expect(event.metadata.loginTime).toBe('2026-08-10T10:00:00+08:00');
      expect(Date.parse(event.metadata.clientTime)).toBeGreaterThanOrEqual(beforeReport);
      expect(Date.parse(event.metadata.clientTime)).toBeLessThanOrEqual(Date.now());
    }
  });
  test('derives customer endpoints from the model v1 URL', () => {
    expect(buildCustomerApiBaseUrl('http://127.0.0.1:9108/v1/')).toBe(
      'http://127.0.0.1:9108',
    );
    expect(buildCustomerApiBaseUrl('https://example.com/gateway')).toBe(
      'https://example.com/gateway',
    );
  });

  test('skips an update when the existing customer alias already matches', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ alias: 'JustDo v2026.8.10' }), { status: 200 }),
      );
    const service = makeService(request);

    await service.sync();

    expect(request).toHaveBeenCalledTimes(2);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:9108/customer/info?end_user_id=user-123');
    expect(init.headers).toEqual({
      Authorization: 'Bearer sk-test',
    });
    expect(init.method).toBe('GET');
  });

  test('preserves metadata when updating a stale product alias', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ alias: 'JustDo v2026.8.9' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const service = makeService(request);

    await service.sync();

    expect(request).toHaveBeenCalledTimes(3);
    const [url, init] = request.mock.calls[1];
    expect(url).toBe('http://127.0.0.1:9108/customer/update');
    expect(JSON.parse(init.body)).toMatchObject({
      user_id: 'user-123',
      alias: 'JustDo v2026.8.10',
      metadata: {
        userName: 'Alice',
        loginTime: '2026-08-10T10:00:00+08:00',
        productName: 'JustDo',
        version: 'v2026.8.10',
      },
    });
  });

  test('creates the customer when lookup reports it does not exist', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const service = makeService(request);

    await service.sync();

    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[1][0]).toBe('http://127.0.0.1:9108/customer/new');
    expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({
      user_id: 'user-123',
      alias: 'JustDo v2026.8.10',
    });
  });

  test('confirms existence before updating after a concurrent create wins the race', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 400 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ alias: 'JustDo v2026.8.9' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const service = makeService(request);

    await service.sync();

    expect(request).toHaveBeenCalledTimes(5);
    expect(request.mock.calls[2][0]).toBe(
      'http://127.0.0.1:9108/customer/info?end_user_id=user-123',
    );
    expect(request.mock.calls[3][0]).toBe('http://127.0.0.1:9108/customer/update');
  });

  test('does not update when a failed create is followed by another missing lookup', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 400 }))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }));
    const service = makeService(request);

    await service.sync();

    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.map(([url]) => url)).not.toContain(
      'http://127.0.0.1:9108/customer/update',
    );
  });

  test('keeps the product version alias regardless of unsupported user info fields', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const service = makeService(
      request,
      writeUserInfo({
        'X-User-Account': 'user-123',
        userName: 'Alice',
        loginTime: '2026-08-10T10:00:00+08:00',
      }),
    );

    await service.sync();

    expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({
      user_id: 'user-123',
      alias: 'JustDo v2026.8.10',
    });
  });

  test('does not send a request when X-User-Account is missing', async () => {
    const request = vi.fn();
    const service = makeService(request, writeUserInfo({ userName: 'Alice' }));

    await service.sync();

    expect(request).not.toHaveBeenCalled();
  });

  test('reports at startup and every 24 hours, not hourly, with fresh client time', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ alias: 'JustDo v2026.8.10' }), { status: 200 }),
        ),
      );
    const service = new CustomerRegistrationService({
      apiKey: 'sk-test',
      baseUrl: 'http://127.0.0.1:9108/v1',
      productName: 'JustDo',
      version: 'v2026.8.10',
      userInfoPath: writeUserInfo({ 'X-User-Account': 'user-123' }),
      fetch: request,
    });

    service.start();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    const startup = JSON.parse(request.mock.calls[1][1].body);
    const heartbeat = JSON.parse(request.mock.calls[3][1].body);
    expect(Date.parse(heartbeat.metadata.clientTime) - Date.parse(startup.metadata.clientTime))
      .toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
    service.stop();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(request).toHaveBeenCalledTimes(4);
  });
});
