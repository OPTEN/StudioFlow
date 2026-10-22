import { AccessDeniedError, createOutputApi, HttpError, withOutputKey } from './api';
import { KEY } from './testing/fixtures';

function respond(status: number, body: unknown = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('output API', () => {
  it('requests a LiveKit token with the key in the header only', async () => {
    const token = {
      url: 'wss://host',
      token: 'jwt',
      identity: 'output_webinar_x',
      room: 'prd_x',
      expiresAt: '',
    };
    const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(respond(200, token)),
    );
    const api = createOutputApi({ slug: 'webinar', key: KEY, fetch });
    await expect(api.liveKitToken()).resolves.toEqual(token);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/output/webinar/livekit-token');
    expect(String(url)).not.toContain(KEY);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
    expect((init?.headers as Record<string, string>)['X-Output-Key']).toBe(KEY);
  });

  it.each([401, 403, 404])(
    'maps HTTP %d to «Kein Zugang» with status 403 for MediaSession',
    async (status) => {
      const api = createOutputApi({
        slug: 'webinar',
        key: KEY,
        fetch: () => Promise.resolve(respond(status)),
      });
      const error = await api.liveKitToken().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AccessDeniedError);
      expect(error).toMatchObject({ status: 403, httpStatus: status });
      expect(String((error as Error).message)).not.toContain(KEY);
    },
  );

  it.each([429, 500, 502, 503])('keeps HTTP %d retryable', async (status) => {
    const api = createOutputApi({
      slug: 'webinar',
      key: KEY,
      fetch: () => Promise.resolve(respond(status)),
    });
    await expect(api.liveKitToken()).rejects.toBeInstanceOf(HttpError);
  });

  it('posts reports as JSON', async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(respond(204)),
    );
    const api = createOutputApi({ slug: 'q4-2026', key: KEY, fetch });
    const report = { rendering: true, latencyMs: 62, fps: 60, programSceneId: 'scn_a' };
    await api.report(report);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/output/q4-2026/report');
    expect(JSON.parse(String(init?.body))).toEqual(report);
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('appends the key to asset URLs', () => {
    expect(withOutputKey('/api/productions/p/assets/a/content', 'a-b_c')).toBe(
      '/api/productions/p/assets/a/content?k=a-b_c',
    );
    expect(withOutputKey('/content?v=2', 'x')).toBe('/content?v=2&k=x');
  });
});
