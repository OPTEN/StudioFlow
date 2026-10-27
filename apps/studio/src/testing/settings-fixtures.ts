import type { ApplyStatusDto, BackupsDto, ServerSettingsDto } from '@studioflow/scene-model';

/** The providers of the server (the same list as `TlsModes` in the C# core). */
export const DNS_PROVIDERS: ServerSettingsDto['dnsProviders'] = [
  { id: 'dns-cloudflare', fields: ['token'] },
  { id: 'dns-hetzner', fields: ['token'] },
  { id: 'dns-route53', fields: ['accessKeyId', 'secretAccessKey', 'region'] },
];

/** Settings of a fresh installation: nothing is saved yet, the local certificate is selected. */
export function serverSettingsFixture(
  overrides: {
    configured?: boolean;
    baseUrl?: string;
    httpsPort?: number;
    media?: Partial<ServerSettingsDto['media']>;
    address?: Partial<ServerSettingsDto['address']>;
    embedding?: Partial<ServerSettingsDto['embedding']>;
    backup?: Partial<ServerSettingsDto['backup']>;
  } = {},
): ServerSettingsDto {
  return {
    configured: overrides.configured ?? false,
    baseUrl: overrides.baseUrl ?? 'https://localhost:8443',
    httpsPort: overrides.httpsPort ?? 8443,
    media: { address: null, ...overrides.media },
    address: {
      tlsMode: 'internal',
      domain: null,
      acmeEmail: null,
      dnsChallengeDomain: null,
      credentialFields: [],
      certificate: null,
      ...overrides.address,
    },
    embedding: { origins: [], ...overrides.embedding },
    backup: {
      schedule: null,
      timezone: null,
      keepDaily: 7,
      keepWeekly: 4,
      rcloneRemote: null,
      rcloneConfigured: false,
      ageRecipients: [],
      offsiteUnencrypted: false,
      ...overrides.backup,
    },
    dnsProviders: DNS_PROVIDERS,
  };
}

/** Settings of an installation that went through the wizard. */
export function configuredSettingsFixture(
  overrides: Parameters<typeof serverSettingsFixture>[0] = {},
): ServerSettingsDto {
  return serverSettingsFixture({
    configured: true,
    media: { address: '192.168.1.50' },
    ...overrides,
  });
}

/** All three services run the saved settings. */
export function appliedStatusFixture(overrides: Partial<ApplyStatusDto> = {}): ApplyStatusDto {
  return {
    caddy: { applied: true, error: null },
    liveKit: { applied: true, error: null },
    backup: { applied: true, error: null },
    ...overrides,
  };
}

/** The backup service has reported and there is no backup yet. */
export function backupsFixture(overrides: Partial<BackupsDto> = {}): BackupsDto {
  return {
    serviceSeen: true,
    running: false,
    postponed: false,
    lastError: null,
    backups: [],
    ...overrides,
  };
}
