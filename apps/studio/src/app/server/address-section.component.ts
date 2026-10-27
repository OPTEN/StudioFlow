import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { formatDate, msg, t, tm, type Msg } from '@studioflow/i18n';
import type { DnsProviderDto } from '@studioflow/scene-model';
import { SETTINGS_FIELD_ERROR_CODES as CODES } from '@studioflow/scene-model';
import { ApiError, toUserMsg } from '../core/api/api-error';
import { ServerSettingsService } from '../core/state/server-settings.service';
import { RefusedFields, focusFirstInvalid } from '../core/ui/form-feedback';
import { applyFailureMsg } from './apply-messages';
import {
  certificateErrorMsg,
  isChallengeDomain,
  isDomain,
  isEmail,
  normalizeDomain,
  providerName,
} from './server-rules';

/** The fields that can carry a message of their own. */
type Field = string;

/** The largest certificate or key file the form reads (the server accepts 64 KiB of text). */
const MAX_FILE_BYTES = 65_536;

const CREDENTIAL_KEYS = {
  token: 'regie.server.address.credentialToken',
  accessKeyId: 'regie.server.address.credentialAccessKeyId',
  secretAccessKey: 'regie.server.address.credentialSecretAccessKey',
  region: 'regie.server.address.credentialRegion',
  endpoint: 'regie.server.address.credentialEndpoint',
  applicationKey: 'regie.server.address.credentialApplicationKey',
  applicationSecret: 'regie.server.address.credentialApplicationSecret',
  consumerKey: 'regie.server.address.credentialConsumerKey',
} as const;

type CredentialName = keyof typeof CREDENTIAL_KEYS;

function isCredentialName(name: string): name is CredentialName {
  return name in CREDENTIAL_KEYS;
}

/**
 * Address and certificate (issue #27): how the server gets a certificate that browsers trust, and under which name it is
 * reached. Three kinds: the local certificate authority of the stack (`internal`, with an optional domain and the CA
 * certificate to download), the operator's own certificate (`custom`, uploaded as PEM text) and Let's Encrypt over a DNS
 * provider (`dns-*`, with the provider's API credentials, which are stored encrypted and never returned). The same
 * section is a step of the first-run wizard and a part of the "Server settings" page, where a change of the domain or
 * the certificate warns that paired devices must open the new address.
 */
@Component({
  selector: 'sf-address-section',
  imports: [ReactiveFormsModule],
  templateUrl: './address-section.component.html',
  styleUrl: './server-section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddressSectionComponent {
  private readonly settings = inject(ServerSettingsService);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly refused = new RefusedFields<Field>();
  private readonly current = this.settings.settings();

  /** `next`: the step of the wizard; `save`: the settings page (which warns about paired devices). */
  readonly mode = input<'save' | 'next'>('save');
  /** Emitted after the address is saved and Caddy runs it, with the address devices open from now on. */
  readonly saved = output<string>();

  protected readonly t = t;
  protected readonly modeControl = new FormControl(this.current?.address.tlsMode ?? 'internal', {
    nonNullable: true,
  });
  protected readonly domain = new FormControl(this.current?.address.domain ?? '', {
    nonNullable: true,
  });
  protected readonly email = new FormControl(this.current?.address.acmeEmail ?? '', {
    nonNullable: true,
  });
  protected readonly challenge = new FormControl(this.current?.address.dnsChallengeDomain ?? '', {
    nonNullable: true,
  });
  private readonly credentials = new Map<string, FormControl<string>>();
  protected readonly certificateFile = signal<{ name: string; text: string } | null>(null);
  protected readonly keyFile = signal<{ name: string; text: string } | null>(null);

  protected readonly saving = signal(false);
  protected readonly error = signal<Msg | null>(null);
  protected readonly errorText = computed(() => tm(this.error()) || null);
  /** The address devices open after the last save, when it differs from the one this page was opened at. */
  protected readonly newAddress = signal<string | null>(null);

  private readonly selected = toSignal(this.modeControl.valueChanges, {
    initialValue: this.modeControl.value,
  });
  private readonly typedDomain = toSignal(this.domain.valueChanges, {
    initialValue: this.domain.value,
  });
  protected readonly providers = computed(() => this.settings.settings()?.dnsProviders ?? []);
  protected readonly isInternal = computed(() => this.selected() === 'internal');
  protected readonly isCustom = computed(() => this.selected() === 'custom');
  protected readonly provider = computed<DnsProviderDto | null>(
    () => this.providers().find((candidate) => candidate.id === this.selected()) ?? null,
  );
  protected readonly credentialFields = computed(() =>
    (this.provider()?.fields ?? []).map((name) => ({
      name,
      label: isCredentialName(name) ? t(CREDENTIAL_KEYS[name]) : name,
    })),
  );
  protected readonly providerLabel = computed(() => providerName(this.provider()?.id ?? ''));
  protected readonly certificate = computed(
    () => this.settings.settings()?.address.certificate ?? null,
  );
  protected readonly certificateDate = computed(() => {
    const certificate = this.certificate();
    return certificate ? formatDate(new Date(certificate.notAfter)) : '';
  });
  /** True when the credentials of the selected provider are stored (they stay when the fields are left empty). */
  protected readonly credentialsStored = computed(() => {
    const address = this.settings.settings()?.address;
    return address?.tlsMode === this.selected() && (address?.credentialFields.length ?? 0) > 0;
  });
  /** The address devices open if the form were saved now. */
  protected readonly futureAddress = computed(() => {
    const settings = this.settings.settings();
    const host =
      normalizeDomain(this.typedDomain()) ||
      settings?.media.address ||
      this.document.location.hostname;
    const port = settings?.httpsPort ?? 443;
    return `https://${host}${port === 443 ? '' : `:${port}`}`;
  });
  /** A change of the domain or the certificate kind sends paired devices to another address. */
  protected readonly addressWillChange = computed(() => {
    const saved = this.settings.settings();
    if (!saved?.configured) {
      return false;
    }
    return (
      this.selected() !== saved.address.tlsMode ||
      normalizeDomain(this.typedDomain()) !== (saved.address.domain ?? '')
    );
  });

  constructor() {
    this.syncCredentialControls();
    this.modeControl.valueChanges.subscribe(() => {
      this.syncCredentialControls();
      this.error.set(null);
      this.refused.clear('mode');
    });
    this.domain.valueChanges.subscribe(() => this.refused.clear('domain'));
    this.email.valueChanges.subscribe(() => this.refused.clear('email'));
    this.challenge.valueChanges.subscribe(() => this.refused.clear('challenge'));
  }

  protected modeLabel(provider: DnsProviderDto): string {
    return t('regie.server.address.modeDns', { provider: providerName(provider.id) });
  }

  protected credentialControl(name: string): FormControl<string> {
    return this.credentials.get(name) as FormControl<string>;
  }

  /** The text under a field: the server's verdict first, then the browser's own check once a save was tried. */
  protected fieldError(field: Field): string | null {
    const fromServer = this.refused.get(field);
    return fromServer ? tm(fromServer) : null;
  }

  protected async pick(which: 'certificate' | 'key', event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const target = which === 'certificate' ? this.certificateFile : this.keyFile;
    this.refused.clear(which);
    if (!file) {
      target.set(null);
      return;
    }
    try {
      if (file.size > MAX_FILE_BYTES) {
        throw new Error('too large');
      }
      target.set({ name: file.name, text: await file.text() });
    } catch {
      target.set(null);
      input.value = '';
      this.refused.set({
        ...this.allRefused(),
        [which]: msg('regie.server.address.customReadError'),
      });
    }
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving()) {
      return;
    }
    const problems = this.check();
    this.refused.set(problems);
    if (Object.keys(problems).length > 0) {
      focusFirstInvalid(this.host, this.injector);
      return;
    }
    this.error.set(null);
    this.saving.set(true);
    try {
      const domain = normalizeDomain(this.domain.value) || null;
      const certificate = this.certificateFile();
      const key = this.keyFile();
      if (this.isCustom() && certificate && key) {
        await this.settings.uploadCertificate({
          certificatePem: certificate.text,
          privateKeyPem: key.text,
          domain,
        });
      }
      const saved = await this.settings.saveAddress({
        tlsMode: this.modeControl.value,
        domain,
        acmeEmail: this.provider() ? this.email.value.trim() || null : null,
        dnsChallengeDomain: this.provider() ? normalizeDomain(this.challenge.value) || null : null,
        dnsCredentials: this.typedCredentials(),
      });
      const outcome = await this.settings.waitUntilApplied(['caddy']);
      if (!outcome.applied) {
        this.error.set(applyFailureMsg(outcome));
        return;
      }
      this.resetSecrets();
      const here = this.document.location.origin;
      this.newAddress.set(new URL(saved.baseUrl).origin === here ? null : saved.baseUrl);
      this.saved.emit(saved.baseUrl);
    } catch (error) {
      this.showFailure(ApiError.from(error));
    } finally {
      this.saving.set(false);
    }
  }

  /** The problems the browser can see without asking the server, per field. */
  private check(): Partial<Record<Field, Msg>> {
    const problems: Partial<Record<Field, Msg>> = {};
    const domain = this.domain.value.trim();
    if (this.isInternal()) {
      if (domain && !isDomain(domain, false)) {
        problems['domain'] = msg('regie.server.address.domainInvalid');
      }
    } else if (!domain) {
      problems['domain'] = msg('regie.server.address.domainRequired');
    } else if (!isDomain(domain, true)) {
      problems['domain'] = msg('regie.server.address.domainInvalid');
    }
    if (this.provider()) {
      if (this.email.value.trim() && !isEmail(this.email.value)) {
        problems['email'] = msg('regie.server.address.dnsEmailInvalid');
      }
      if (this.challenge.value.trim() && !isChallengeDomain(this.challenge.value)) {
        problems['challenge'] = msg('regie.server.address.dnsChallengeInvalid');
      }
      const typed = this.typedCredentials();
      if (typed !== null || !this.credentialsStored()) {
        for (const { name } of this.credentialFields()) {
          if (!(typed?.[name] ?? '').trim()) {
            problems[`credential:${name}`] = msg('regie.server.address.credentialsRequired');
          }
        }
      }
    }
    if (this.isCustom()) {
      const hasFiles = this.certificateFile() !== null || this.keyFile() !== null;
      if (hasFiles || this.certificate() === null) {
        if (!this.certificateFile()) {
          problems['certificate'] = msg('regie.server.address.customFileRequired');
        }
        if (!this.keyFile()) {
          problems['key'] = msg('regie.server.address.customFileRequired');
        }
      }
    }
    return problems;
  }

  /** The credentials the operator typed, or null when no field has text (stored credentials then stay). */
  private typedCredentials(): Record<string, string> | null {
    if (!this.provider()) {
      return null;
    }
    const values: Record<string, string> = {};
    let any = false;
    for (const { name } of this.credentialFields()) {
      const value = this.credentials.get(name)?.value.trim() ?? '';
      values[name] = value;
      any ||= value.length > 0;
    }
    return any ? values : null;
  }

  private allRefused(): Partial<Record<Field, Msg>> {
    const result: Partial<Record<Field, Msg>> = {};
    for (const field of ['domain', 'email', 'challenge', 'certificate', 'key', 'mode'] as const) {
      const message = this.refused.get(field);
      if (message) {
        result[field] = message;
      }
    }
    return result;
  }

  /** One control per credential field of the selected provider; the values of another provider are dropped. */
  private syncCredentialControls(): void {
    this.credentials.clear();
    for (const field of this.provider()?.fields ?? []) {
      const control = new FormControl('', { nonNullable: true });
      control.valueChanges.subscribe(() => this.refused.clear(`credential:${field}`));
      this.credentials.set(field, control);
    }
  }

  /** Secrets and files are kept only until they are saved. */
  private resetSecrets(): void {
    for (const control of this.credentials.values()) {
      control.reset('');
    }
    this.certificateFile.set(null);
    this.keyFile.set(null);
    for (const input of this.host.nativeElement.querySelectorAll<HTMLInputElement>(
      'input[type=file]',
    )) {
      input.value = '';
    }
  }

  private showFailure(error: ApiError): void {
    const refused: Partial<Record<Field, Msg>> = {};
    for (const [key, codes] of Object.entries(error.fieldErrors)) {
      const code = codes[0];
      if (!code) {
        continue;
      }
      const certificate = certificateErrorMsg(code);
      if (key === 'certificatePem') {
        refused['certificate'] = certificate ?? msg('regie.server.address.errorCertificateInvalid');
      } else if (key === 'privateKeyPem') {
        refused['key'] = certificate ?? msg('regie.server.address.errorPrivateKeyInvalid');
      } else if (key === 'domain') {
        refused['domain'] =
          certificate ??
          msg(
            code === CODES.domainRequired
              ? 'regie.server.address.domainRequired'
              : 'regie.server.address.domainInvalid',
          );
      } else if (key === 'acmeEmail') {
        refused['email'] = msg('regie.server.address.dnsEmailInvalid');
      } else if (key === 'dnsChallengeDomain') {
        refused['challenge'] = msg('regie.server.address.dnsChallengeInvalid');
      } else if (key.startsWith('dnsCredentials.')) {
        refused[`credential:${key.slice('dnsCredentials.'.length)}`] = msg(
          code === CODES.credentialRequired
            ? 'regie.server.address.credentialsRequired'
            : 'regie.server.address.credentialsInvalid',
        );
      } else if (key === 'tlsMode') {
        refused['mode'] = certificate ?? msg('regie.server.address.errorTlsMode');
      }
    }
    if (Object.keys(refused).length === 0) {
      this.error.set(toUserMsg(error));
      return;
    }
    this.refused.set(refused);
    focusFirstInvalid(this.host, this.injector);
  }
}
