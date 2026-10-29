import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { Mock } from 'vitest';
import type { ServerSettingsDto } from '@studioflow/scene-model';
import { flushMicrotasks } from '../../testing/fake-studio-hub';
import {
  appliedStatusFixture,
  configuredSettingsFixture,
  serverSettingsFixture,
} from '../../testing/settings-fixtures';
import { csrfInterceptor } from '../core/api/csrf.interceptor';
import { ServerSettingsService } from '../core/state/server-settings.service';
import { AddressSectionComponent } from './address-section.component';

describe('AddressSectionComponent', () => {
  let fixture: ComponentFixture<AddressSectionComponent>;
  let http: HttpTestingController;
  let element: HTMLElement;
  let saved: Mock<(baseUrl: string) => void>;

  async function setup(
    settings: ServerSettingsDto = serverSettingsFixture(),
    mode: 'save' | 'next' = 'save',
  ): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const loading = TestBed.inject(ServerSettingsService).load();
    http.expectOne('/api/settings').flush(settings);
    await loading;
    fixture = TestBed.createComponent(AddressSectionComponent);
    fixture.componentRef.setInput('mode', mode);
    saved = vi.fn<(baseUrl: string) => void>();
    fixture.componentInstance.saved.subscribe(saved);
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function input(id: string): HTMLInputElement {
    return element.querySelector<HTMLInputElement>(`#${id}`)!;
  }

  function type(id: string, value: string): void {
    input(id).value = value;
    input(id).dispatchEvent(new Event('input'));
  }

  /** Picks a certificate card, and for Let's Encrypt the provider in its select. */
  async function choose(mode: string): Promise<void> {
    const kind = mode === 'internal' || mode === 'custom' ? mode : 'dns';
    input(`address-kind-${kind}`).click();
    await render();
    if (kind === 'dns') {
      const select = element.querySelector<HTMLSelectElement>('#address-provider')!;
      select.value = mode;
      select.dispatchEvent(new Event('change'));
      await render();
    }
  }

  function credentialLabels(): string[] {
    return Array.from(
      element.querySelectorAll<HTMLLabelElement>('label[for^="address-credential-"]'),
    ).map((label) => label.textContent?.trim() ?? '');
  }

  async function attach(id: string, name: string, text: string, size = text.length): Promise<void> {
    Object.defineProperty(input(id), 'files', {
      configurable: true,
      value: [{ name, size, text: () => Promise.resolve(text) }],
    });
    input(id).dispatchEvent(new Event('change'));
    await render();
  }

  async function submit(): Promise<void> {
    element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  }

  /** Answers the save and the poll for Caddy. */
  async function accept(
    expectedBody: object,
    answer: ServerSettingsDto = configuredSettingsFixture(),
  ): Promise<void> {
    const request = http.expectOne('/api/settings/address');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual(expectedBody);
    request.flush(answer);
    await flushMicrotasks();
    http.expectOne('/api/settings/status').flush(appliedStatusFixture());
    await render();
  }

  function errorOf(id: string): string {
    return element.querySelector(`#${id}-error`)?.textContent?.trim() ?? '';
  }

  afterEach(() => http.verify());

  it('offers three kinds of certificate as radio cards, the local one recommended', async () => {
    await setup();
    const radios = Array.from(
      element.querySelectorAll<HTMLInputElement>('input[type="radio"][name="address-kind"]'),
    );
    expect(radios.map((radio) => radio.value)).toEqual(['internal', 'custom', 'dns']);
    expect(radios.map((radio) => radio.checked)).toEqual([true, false, false]);
    expect(
      radios.map((radio) =>
        element.querySelector(`label[for="${radio.id}"]`)?.textContent?.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual([
      'Local certificate Recommended on a LAN',
      'Own certificate',
      'Let’s Encrypt via DNS',
    ]);
    expect(element.querySelector('legend')?.textContent?.trim()).toBe('Certificate');
    expect(element.querySelector('#address-provider')).toBeNull();
  });

  it('asks for the provider only for Let’s Encrypt, with every provider of the server', async () => {
    await setup();
    await choose('dns-cloudflare');
    const options = Array.from(element.querySelectorAll('#address-provider option')).map((option) =>
      option.textContent?.trim(),
    );
    expect(options).toEqual(['Cloudflare', 'Hetzner', 'Amazon Route 53']);
    expect(input('address-kind-dns').checked).toBe(true);
    expect(element.querySelector('a[download]')).toBeNull();

    await choose('internal');
    expect(element.querySelector('#address-provider')).toBeNull();
    await choose('dns-hetzner');
    await choose('custom');
    input('address-kind-dns').click();
    await render();
    expect(element.querySelector<HTMLSelectElement>('#address-provider')?.value).toBe(
      'dns-hetzner',
    );
  });

  describe('local certificate', () => {
    it('offers the CA certificate to download and needs no domain', async () => {
      await setup();
      const link = element.querySelector<HTMLAnchorElement>('a[download]')!;
      expect(link.getAttribute('href')).toBe('/ca.crt');
      expect(link.textContent).toContain('Download the CA certificate');
      expect(element.querySelector('#address-domain-hint')?.textContent).toContain('Optional');
      expect(element.querySelector('#address-email')).toBeNull();
    });

    it('saves it without a domain', async () => {
      await setup(serverSettingsFixture(), 'next');
      await submit();
      await accept({
        tlsMode: 'internal',
        domain: null,
        acmeEmail: null,
        dnsChallengeDomain: null,
        dnsCredentials: null,
      });
      expect(saved).toHaveBeenCalledWith('https://localhost:8443');
    });

    it('saves the domain in the form the server stores', async () => {
      await setup();
      type('address-domain', ' StudioFlow.Example.com. ');
      await submit();
      await accept(
        {
          tlsMode: 'internal',
          domain: 'studioflow.example.com',
          acmeEmail: null,
          dnsChallengeDomain: null,
          dnsCredentials: null,
        },
        configuredSettingsFixture({ baseUrl: 'https://studioflow.example.com:8443' }),
      );
      expect(saved).toHaveBeenCalledWith('https://studioflow.example.com:8443');
    });

    it('refuses an IP address as the domain', async () => {
      await setup();
      type('address-domain', '192.168.1.50');
      await submit();
      expect(errorOf('address-domain')).toContain('studioflow.example.com');
      expect(input('address-domain').getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(input('address-domain'));
      http.expectNone('/api/settings/address');
    });

    it('links to the new address when it is not the one the page was opened at', async () => {
      await setup();
      type('address-domain', 'studioflow.example.com');
      await submit();
      await accept(
        {
          tlsMode: 'internal',
          domain: 'studioflow.example.com',
          acmeEmail: null,
          dnsChallengeDomain: null,
          dnsCredentials: null,
        },
        configuredSettingsFixture({ baseUrl: 'https://studioflow.example.com:8443' }),
      );
      const link = element.querySelector<HTMLAnchorElement>('.c-address__link')!;
      expect(link.getAttribute('href')).toBe('https://studioflow.example.com:8443');
      expect(link.textContent).toContain('Open https://studioflow.example.com:8443');
    });
  });

  describe('warning about paired devices', () => {
    it('appears on the settings page when the domain would change', async () => {
      await setup(configuredSettingsFixture({ address: { domain: 'old.example.com' } }));
      expect(element.querySelector('.c-address__warning')).toBeNull();
      type('address-domain', 'new.example.com');
      await render();
      const warning = element.querySelector('.c-address__warning')!;
      expect(warning.textContent).toContain('https://new.example.com:8443');
      expect(warning.getAttribute('role')).toBe('note');
    });

    it('appears when the kind of certificate would change', async () => {
      await setup(configuredSettingsFixture());
      await choose('custom');
      expect(element.querySelector('.c-address__warning')).not.toBeNull();
    });

    it('does not appear in the wizard, which only announces the address', async () => {
      await setup(serverSettingsFixture(), 'next');
      type('address-domain', 'new.example.com');
      await render();
      expect(element.querySelector('.c-address__warning')).toBeNull();
      expect(element.textContent).toContain(
        'The control room will then be at https://new.example.com:8443',
      );
    });
  });

  describe('Let’s Encrypt through DNS', () => {
    it('needs the domain and every credential of the provider', async () => {
      await setup();
      await choose('dns-cloudflare');
      expect(credentialLabels()).toEqual(['API token']);
      await submit();
      expect(errorOf('address-domain')).toBe('Enter the domain.');
      expect(errorOf('address-credential-token')).toBe('Enter this value.');
      http.expectNone('/api/settings/address');
    });

    it('shows the three credentials of Route 53 and keeps them secret', async () => {
      await setup();
      await choose('dns-route53');
      const fields = Array.from(
        element.querySelectorAll<HTMLInputElement>('input[id^="address-credential-"]'),
      );
      expect(fields.map((field) => field.id)).toEqual([
        'address-credential-accessKeyId',
        'address-credential-secretAccessKey',
        'address-credential-region',
      ]);
      expect(
        fields.every((field) => field.type === 'password' && field.autocomplete === 'new-password'),
      ).toBe(true);
    });

    it('sends the credentials and the optional values trimmed, then forgets the secrets', async () => {
      await setup();
      await choose('dns-cloudflare');
      expect(element.querySelector('#address-email')).toBeNull();
      const more = element.querySelector<HTMLButtonElement>('.c-address__toggle')!;
      expect(more.getAttribute('aria-expanded')).toBe('false');
      more.click();
      await render();
      expect(more.getAttribute('aria-expanded')).toBe('true');
      type('address-domain', 'studioflow.example.com');
      type('address-email', ' ops@example.ch ');
      type('address-challenge', '_acme-challenge.studioflow.dedyn.io');
      type('address-credential-token', ' secret-token ');
      await submit();
      await accept({
        tlsMode: 'dns-cloudflare',
        domain: 'studioflow.example.com',
        acmeEmail: 'ops@example.ch',
        dnsChallengeDomain: '_acme-challenge.studioflow.dedyn.io',
        dnsCredentials: { token: 'secret-token' },
      });
      expect(input('address-credential-token').value).toBe('');
      expect(saved).toHaveBeenCalled();
    });

    it('checks the e-mail address and the challenge domain', async () => {
      await setup();
      await choose('dns-cloudflare');
      element.querySelector<HTMLButtonElement>('.c-address__toggle')!.click();
      await render();
      type('address-domain', 'studioflow.example.com');
      type('address-email', 'nobody');
      type('address-challenge', 'not valid');
      type('address-credential-token', 'x');
      await submit();
      expect(errorOf('address-email')).toBe('Enter a valid e-mail address.');
      expect(errorOf('address-challenge')).toBe('Enter a host name.');
    });

    it('keeps stored credentials when the fields are left empty', async () => {
      await setup(
        configuredSettingsFixture({
          address: {
            tlsMode: 'dns-cloudflare',
            domain: 'studioflow.example.com',
            credentialFields: ['token'],
          },
        }),
      );
      expect(element.textContent).toContain('Saved. Leave empty to keep it.');
      expect(input('address-credential-token').placeholder).toBe('••••••••');
      await submit();
      await accept({
        tlsMode: 'dns-cloudflare',
        domain: 'studioflow.example.com',
        acmeEmail: null,
        dnsChallengeDomain: null,
        dnsCredentials: null,
      });
    });

    it('needs all credentials once one is replaced', async () => {
      await setup(
        configuredSettingsFixture({
          address: {
            tlsMode: 'dns-route53',
            domain: 'studioflow.example.com',
            credentialFields: ['accessKeyId', 'secretAccessKey', 'region'],
          },
        }),
      );
      type('address-credential-accessKeyId', 'AKIA…');
      await submit();
      expect(errorOf('address-credential-secretAccessKey')).toBe('Enter this value.');
      expect(errorOf('address-credential-accessKeyId')).toBe('');
      http.expectNone('/api/settings/address');
    });

    it('does not offer stored credentials of another provider', async () => {
      await setup(
        configuredSettingsFixture({
          address: {
            tlsMode: 'dns-cloudflare',
            domain: 'studioflow.example.com',
            credentialFields: ['token'],
          },
        }),
      );
      await choose('dns-hetzner');
      expect(element.textContent).not.toContain('Saved. Leave empty to keep it.');
      await submit();
      expect(errorOf('address-credential-token')).toBe('Enter this value.');
    });

    it('shows what the server found wrong with a credential', async () => {
      await setup();
      await choose('dns-cloudflare');
      type('address-domain', 'studioflow.example.com');
      type('address-credential-token', 'short');
      await submit();
      http
        .expectOne('/api/settings/address')
        .flush(
          { code: 'validation_failed', errors: { 'dnsCredentials.token': ['credential_invalid'] } },
          { status: 400, statusText: 'Bad Request' },
        );
      await render();
      expect(errorOf('address-credential-token')).toContain('characters or has a length');
      expect(document.activeElement).toBe(input('address-credential-token'));
    });
  });

  describe('own certificate', () => {
    const CERTIFICATE = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n';
    const KEY = '-----BEGIN PRIVATE KEY-----\nBBBB\n-----END PRIVATE KEY-----\n';

    it('needs both files when no certificate is stored', async () => {
      await setup();
      await choose('custom');
      type('address-domain', 'studioflow.example.com');
      await submit();
      expect(errorOf('address-certificate')).toBe('Choose the file.');
      expect(errorOf('address-key')).toBe('Choose the file.');
      http.expectNone('/api/settings/certificate');
    });

    it('uploads the certificate for the new domain first and then saves the address', async () => {
      await setup();
      await choose('custom');
      type('address-domain', 'studioflow.example.com');
      await attach('address-certificate', 'fullchain.pem', CERTIFICATE);
      await attach('address-key', 'privkey.pem', KEY);
      expect(element.querySelector('#address-certificate-name')?.textContent?.trim()).toBe(
        'fullchain.pem',
      );
      expect(element.querySelector('#address-key-name')?.textContent?.trim()).toBe('privkey.pem');
      await submit();
      const upload = http.expectOne('/api/settings/certificate');
      expect(upload.request.body).toEqual({
        certificatePem: CERTIFICATE,
        privateKeyPem: KEY,
        domain: 'studioflow.example.com',
      });
      upload.flush(serverSettingsFixture());
      await flushMicrotasks();
      await accept({
        tlsMode: 'custom',
        domain: 'studioflow.example.com',
        acmeEmail: null,
        dnsChallengeDomain: null,
        dnsCredentials: null,
      });
      expect(saved).toHaveBeenCalled();
    });

    it('shows the stored certificate and does not ask for files again', async () => {
      await setup(
        configuredSettingsFixture({
          address: {
            tlsMode: 'custom',
            domain: 'studioflow.example.com',
            certificate: {
              subject: 'CN=studioflow.example.com',
              names: ['studioflow.example.com'],
              notAfter: '2027-03-01T00:00:00Z',
              fingerprint: 'AB:CD',
            },
          },
        }),
      );
      const current = Array.from(element.querySelectorAll('.c-address__kv dt')).map((term) => [
        term.textContent?.trim(),
        term.nextElementSibling?.textContent?.trim(),
      ]);
      expect(current).toEqual([
        ['Issued to', 'CN=studioflow.example.com'],
        ['Names', 'studioflow.example.com'],
        ['Valid until', expect.any(String)],
        ['Fingerprint', 'AB:CD'],
      ]);
      expect(element.textContent).toContain('No file chosen');
      await submit();
      http.expectNone('/api/settings/certificate');
      await accept({
        tlsMode: 'custom',
        domain: 'studioflow.example.com',
        acmeEmail: null,
        dnsChallengeDomain: null,
        dnsCredentials: null,
      });
    });

    it('explains why the server refused the certificate and stops before saving the address', async () => {
      await setup();
      await choose('custom');
      type('address-domain', 'studioflow.example.com');
      await attach('address-certificate', 'fullchain.pem', CERTIFICATE);
      await attach('address-key', 'privkey.pem', KEY);
      await submit();
      http.expectOne('/api/settings/certificate').flush(
        {
          code: 'validation_failed',
          errors: {
            certificatePem: ['certificate_name_mismatch'],
            privateKeyPem: ['private_key_encrypted'],
          },
        },
        { status: 400, statusText: 'Bad Request' },
      );
      await render();
      expect(errorOf('address-certificate')).toBe('The certificate does not cover the domain.');
      expect(errorOf('address-key')).toContain('protected by a password');
      http.expectNone('/api/settings/address');
    });

    it('refuses a file that is too large to be a certificate', async () => {
      await setup();
      await choose('custom');
      await attach('address-certificate', 'huge.bin', 'x', 5_000_000);
      expect(errorOf('address-certificate')).toBe('The file could not be read.');
    });
  });

  it('reports a Caddy that refused the settings', async () => {
    await setup();
    await submit();
    http.expectOne('/api/settings/address').flush(configuredSettingsFixture());
    await flushMicrotasks();
    http
      .expectOne('/api/settings/status')
      .flush(appliedStatusFixture({ caddy: { applied: false, error: 'invalid' } }));
    await render();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'docker compose logs api caddy',
    );
    expect(saved).not.toHaveBeenCalled();
  });
});
