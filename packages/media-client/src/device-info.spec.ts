import { battery, canShareScreen, isLikelyPhone, networkType, platformLabel } from './device-info';

const UA = {
  iPhoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  iPhoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1',
  iPadSafari:
    'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0',
  samsung:
    'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.57',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  windowsFirefox:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
  windowsOpera:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/123.0.0.0',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
  chromeOs:
    'Mozilla/5.0 (X11; CrOS x86_64 16328.55.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  inAppIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0',
} as const;

describe('platformLabel', () => {
  it.each([
    [UA.iPhoneSafari, 'iPhone · Safari'],
    [UA.iPhoneChrome, 'iPhone · Chrome'],
    [UA.iPadSafari, 'iPad · Safari'],
    [UA.androidChrome, 'Android · Chrome'],
    [UA.androidFirefox, 'Android · Firefox'],
    [UA.samsung, 'Android · Samsung Internet'],
    [UA.windowsEdge, 'Windows · Edge'],
    [UA.windowsChrome, 'Windows · Chrome'],
    [UA.windowsFirefox, 'Windows · Firefox'],
    [UA.windowsOpera, 'Windows · Opera'],
    [UA.macChrome, 'macOS · Chrome'],
    [UA.macSafari, 'macOS · Safari'],
    [UA.linuxFirefox, 'Linux · Firefox'],
    [UA.chromeOs, 'ChromeOS · Chrome'],
    [UA.inAppIos, 'iPhone'],
    ['curl/8.0', 'Unknown platform'],
    ['', 'Unknown platform'],
  ])('%s → %s', (userAgent, label) => {
    expect(platformLabel(userAgent)).toBe(label);
  });

  it('stays within the 80 characters of DeviceDto.platform', () => {
    expect(platformLabel(`${UA.windowsChrome} ${'x'.repeat(500)}`).length).toBeLessThanOrEqual(80);
  });
});

describe('isLikelyPhone', () => {
  it.each([
    [UA.iPhoneSafari, true],
    [UA.androidChrome, true],
    [UA.androidFirefox, true],
    [UA.samsung, true],
    [UA.iPadSafari, false],
    [UA.androidTablet, false],
    [UA.windowsEdge, false],
    [UA.macSafari, false],
  ])('%s → %s', (userAgent, phone) => {
    expect(isLikelyPhone(userAgent)).toBe(phone);
  });

  it('reads the browser user agent by default', () => {
    expect(isLikelyPhone()).toBe(false);
  });
});

function fakeNavigator(overrides: Record<string, unknown>): Navigator {
  return { userAgent: UA.windowsChrome, ...overrides } as unknown as Navigator;
}

describe('canShareScreen', () => {
  it('needs getDisplayMedia and a non-phone', () => {
    const mediaDevices = { getDisplayMedia: () => Promise.resolve() };
    expect(canShareScreen(fakeNavigator({ mediaDevices }))).toBe(true);
    expect(canShareScreen(fakeNavigator({ mediaDevices, userAgent: UA.androidChrome }))).toBe(
      false,
    );
    expect(canShareScreen(fakeNavigator({ mediaDevices: {} }))).toBe(false);
    expect(canShareScreen(fakeNavigator({ mediaDevices: undefined }))).toBe(false);
    expect(canShareScreen(undefined)).toBe(false);
  });

  it('is false in happy-dom (no mediaDevices)', () => {
    expect(canShareScreen()).toBe(false);
  });
});

describe('battery', () => {
  it('reads level and charging state', async () => {
    const nav = fakeNavigator({ getBattery: async () => ({ level: 0.426, charging: true }) });
    await expect(battery(nav)).resolves.toEqual({ pct: 43, charging: true });
  });

  it('clamps and validates the level', async () => {
    await expect(
      battery(fakeNavigator({ getBattery: async () => ({ level: 1.2, charging: false }) })),
    ).resolves.toEqual({
      pct: 100,
      charging: false,
    });
    await expect(
      battery(fakeNavigator({ getBattery: async () => ({ level: Number.NaN, charging: false }) })),
    ).resolves.toBeNull();
  });

  it('is null without the API or when it fails', async () => {
    await expect(battery(fakeNavigator({}))).resolves.toBeNull();
    await expect(
      battery(fakeNavigator({ getBattery: async () => Promise.reject(new Error('denied')) })),
    ).resolves.toBeNull();
    await expect(battery(undefined)).resolves.toBeNull();
    await expect(battery()).resolves.toBeNull();
  });
});

describe('networkType', () => {
  it.each([
    [{ type: 'wifi', effectiveType: '4g' }, 'wifi'],
    [{ type: 'ethernet' }, 'ethernet'],
    [{ type: 'cellular', effectiveType: '3g' }, '3g'],
    [{ type: 'cellular' }, 'cellular'],
    [{ effectiveType: '4g' }, '4g'],
    [{ type: 'unknown', effectiveType: '2g' }, '2g'],
    [{ type: 'none' }, null],
    [{}, null],
  ])('%j → %s', (connection, expected) => {
    expect(networkType(fakeNavigator({ connection }))).toBe(expected);
  });

  it('is null without the API', () => {
    expect(networkType(fakeNavigator({}))).toBeNull();
    expect(networkType(undefined)).toBeNull();
  });
});
