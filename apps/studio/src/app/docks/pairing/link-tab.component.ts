import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { InviteDto } from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ClipboardService } from '../../core/ui/clipboard.service';
import { ClockService } from '../../core/ui/clock.service';
import { IconComponent } from '../../core/ui/icon.component';
import { ToastService } from '../../core/ui/toast.service';
import { DockCommandService } from '../shared/dock-command.service';
import { displayUrl } from './public-url.service';

/** «läuft in 28 Minuten ab» / «läuft in 1 Minute ab» / «läuft gleich ab» for a remaining time. */
export function expiryText(remainingMs: number): string {
  const minutes = Math.round(remainingMs / 60_000);
  if (remainingMs <= 0) {
    return 'abgelaufen';
  }
  if (minutes <= 1) {
    return remainingMs < 30_000 ? 'läuft gleich ab' : 'läuft in 1 Minute ab';
  }
  return `läuft in ${minutes} Minuten ab`;
}

/** An open laptop invite with its texts. */
interface InviteRow {
  readonly invite: InviteDto;
  readonly url: string;
  readonly expiry: string;
}

/**
 * «Link» tab of the pairing dock (prototype `renderPair` link): «Link erstellen» creates a one-time invite for a
 * laptop (30 minutes), shows it large with «Kopieren», its validity and «Link widerrufen»; below, every open invite
 * of the production with its expiry and «Widerrufen».
 */
@Component({
  selector: 'sf-link-tab',
  imports: [IconComponent],
  template: `
    <h3 class="c-pair__title">Einladungslink</h3>
    <p class="c-pair__text">
      Für Laptops, die schon vor dem Webinar gekoppelt werden sollen. Den Link per Teams oder Mail
      schicken.
    </p>
    @if (current(); as row) {
      <div class="c-pair__big-url">
        <span class="c-pair__url c-pair__url--wrap" #url>{{ row.url }}</span>
        <button class="c-btn c-btn--sm" type="button" (click)="copy(row.invite)">
          <svg sfIcon="copy" [size]="14"></svg>Kopieren
        </button>
      </div>
      <p class="c-hint">Gilt einmal und {{ row.expiry }}. Wer ihn öffnet, ist direkt gekoppelt.</p>
      <div class="c-pair__actions">
        <button
          class="c-btn c-btn--sm"
          type="button"
          [disabled]="commands.blocked('invite:create')"
          (click)="create()"
        >
          <svg sfIcon="link" [size]="14"></svg>Weiteren Link erstellen
        </button>
        <button
          class="c-btn c-btn--sm c-btn--danger c-pair__danger"
          type="button"
          [disabled]="commands.blocked('invite:' + row.invite.id)"
          (click)="revoke(row.invite)"
        >
          Link widerrufen
        </button>
      </div>
    } @else {
      <div>
        <button
          class="c-btn c-btn--fill"
          type="button"
          [disabled]="commands.blocked('invite:create')"
          (click)="create()"
        >
          <svg sfIcon="link" [size]="15"></svg>Link erstellen
        </button>
      </div>
    }
    @if (others().length > 0) {
      <span class="c-label">Offene Einladungen</span>
      <ul class="c-pair__invites">
        @for (row of others(); track row.invite.id) {
          <li class="c-pair__invite">
            <span class="c-pair__invite-url">{{ row.url }}</span>
            <span class="c-hint">{{ row.expiry }}</span>
            <button
              class="c-btn c-btn--sm c-btn--danger"
              type="button"
              [attr.aria-label]="'Einladung widerrufen: ' + row.url"
              [disabled]="commands.blocked('invite:' + row.invite.id)"
              (click)="revoke(row.invite)"
            >
              Widerrufen
            </button>
          </li>
        }
      </ul>
    }
  `,
  styleUrl: './pairing-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkTabComponent {
  protected readonly commands = inject(DockCommandService);
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly clock = inject(ClockService);
  private readonly clipboard = inject(ClipboardService);
  private readonly toasts = inject(ToastService);
  private readonly urlElement = viewChild<ElementRef<HTMLElement>>('url');

  /** The link created in this session (shown large while it is open). */
  private readonly createdId = signal<string | null>(null);
  /** Created invite until the store has it (the event may arrive after the answer). */
  private readonly created = signal<InviteDto | null>(null);

  private readonly rows = computed<readonly InviteRow[]>(() => {
    const now = this.store.serverNow(this.clock.now());
    const invites = this.store.invites().filter((invite) => invite.kind === 'laptopLink');
    const pending = this.created();
    const all =
      pending && !invites.some((invite) => invite.id === pending.id)
        ? [pending, ...invites]
        : invites;
    return all
      .filter((invite) => Date.parse(invite.expiresAt) > now)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((invite) => ({
        invite,
        url: displayUrl(invite.url),
        expiry: expiryText(Date.parse(invite.expiresAt) - now),
      }));
  });
  protected readonly current = computed(
    () => this.rows().find((row) => row.invite.id === this.createdId()) ?? null,
  );
  protected readonly others = computed(() =>
    this.rows().filter((row) => row.invite.id !== this.createdId()),
  );

  constructor() {
    // Once the store knows the created invite, it is the source of truth (a redeemed link disappears).
    effect(() => {
      const created = this.created();
      if (created && this.store.invites().some((invite) => invite.id === created.id)) {
        untracked(() => this.created.set(null));
      }
    });
  }

  /** «Link erstellen». */
  protected async create(): Promise<void> {
    const invite = await this.commands.run('invite:create', (productionId) =>
      this.api.createInvite(productionId, { kind: 'laptopLink' }),
    );
    if (invite) {
      this.created.set(invite);
      this.createdId.set(invite.id);
      this.toasts.show('Einladungslink erstellt');
    }
  }

  /** «Link widerrufen»: the link stops working at once. */
  protected async revoke(invite: InviteDto): Promise<void> {
    const done = await this.commands.run(
      `invite:${invite.id}`,
      async (productionId) => {
        await this.api.revokeInvite(productionId, invite.id);
        return true;
      },
      { errors: { not_found: 'Dieser Link gilt schon nicht mehr.' } },
    );
    if (done) {
      if (this.createdId() === invite.id) {
        this.createdId.set(null);
        this.created.set(null);
      }
      this.toasts.show('Einladungslink widerrufen');
    }
  }

  protected copy(invite: InviteDto): void {
    void this.clipboard.copy(invite.url, {
      label: displayUrl(invite.url),
      selectElement: this.urlElement()?.nativeElement ?? null,
    });
  }
}
