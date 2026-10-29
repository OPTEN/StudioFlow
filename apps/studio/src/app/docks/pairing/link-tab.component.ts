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
import { msg, t } from '@studioflow/i18n';
import type { InviteDto } from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ClipboardService } from '../../core/ui/clipboard.service';
import { ClockService } from '../../core/ui/clock.service';
import { ContextMenuDirective, type ContextMenuEntry } from '../../core/ui/context-menu';
import { IconComponent } from '../../core/ui/icon.component';
import { ToastService } from '../../core/ui/toast.service';
import { DockCommandService } from '../shared/dock-command.service';
import { displayUrl } from './public-url.service';

/** "expires in 28 minutes" / "expires in 1 minute" / "expires shortly" for a remaining time. */
export function expiryText(remainingMs: number): string {
  const minutes = Math.round(remainingMs / 60_000);
  if (remainingMs <= 0) {
    return t('regie.pairing.expiry.expired');
  }
  if (minutes <= 1) {
    return remainingMs < 30_000
      ? t('regie.pairing.expiry.soon')
      : t('regie.pairing.expiry.minutes', { count: 1 });
  }
  return t('regie.pairing.expiry.minutes', { count: minutes });
}

/**
 * The invite link with its secret part hidden: "studioflow.example.com/j/••••••••". A link pairs whoever opens it, so it
 * is not shown in the clear on a screen that may be shared or seen on site, until the operator asks for it.
 */
export function maskedUrl(display: string): string {
  const slash = display.lastIndexOf('/');
  return slash < 0 ? '••••••••' : `${display.slice(0, slash + 1)}••••••••`;
}

/** An open laptop invite with its texts. */
interface InviteRow {
  readonly invite: InviteDto;
  readonly url: string;
  readonly expiry: string;
}

/**
 * "Link" tab of the pairing dock (prototype `renderPair` link): "Create link" creates a one-time invite for a
 * laptop (30 minutes), shows it large with "Show link" and "Copy", its validity and "Revoke link"; below, every open
 * invite of the production with its expiry, "Copy" and "Revoke". The links are masked until "Show link" is pressed;
 * copying works either way. Revoking is a quiet action: a revoked link is replaced with one click. A right click on an
 * open invite offers Copy and Revoke, like its buttons.
 */
@Component({
  selector: 'sf-link-tab',
  imports: [ContextMenuDirective, IconComponent],
  template: `
    <h3 class="c-pair__title">{{ t('regie.pairing.link.title') }}</h3>
    <p class="c-pair__text">{{ t('regie.pairing.link.text') }}</p>
    @if (current(); as row) {
      <div class="c-pair__big-url">
        <span class="c-pair__url c-pair__url--wrap" #url>{{ shown(row.url) }}</span>
        <button
          class="c-ibtn"
          type="button"
          [attr.aria-pressed]="revealed()"
          [attr.aria-label]="t('regie.pairing.link.show')"
          [title]="t('regie.pairing.link.showHint')"
          (click)="revealed.set(!revealed())"
        >
          <svg [sfIcon]="revealed() ? 'eye-off' : 'eye'"></svg>
        </button>
        <button class="c-btn c-btn--sm" type="button" (click)="copy(row.invite)">
          <svg sfIcon="copy" [size]="14"></svg>{{ t('common.copy') }}
        </button>
      </div>
      <p class="c-hint">{{ t('regie.pairing.link.validity', { expiry: row.expiry }) }}</p>
      <div class="c-pair__actions">
        <button
          class="c-btn c-btn--sm"
          type="button"
          [disabled]="commands.blocked('invite:create')"
          (click)="create()"
        >
          <svg sfIcon="link" [size]="14"></svg>{{ t('regie.pairing.link.createAnother') }}
        </button>
        <button
          class="c-btn c-btn--sm c-pair__danger"
          type="button"
          [disabled]="commands.blocked('invite:' + row.invite.id)"
          (click)="revoke(row.invite)"
        >
          {{ t('regie.pairing.link.revoke') }}
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
          <svg sfIcon="link" [size]="15"></svg>{{ t('regie.pairing.link.create') }}
        </button>
      </div>
    }
    @if (others().length > 0) {
      <h4 class="c-pair__label">{{ t('regie.pairing.link.open') }}</h4>
      <ul class="c-pair__invites">
        @for (row of others(); track row.invite.id) {
          <li
            class="c-pair__invite"
            [sfContextMenu]="inviteMenu(row)"
            [sfContextMenuLabel]="shown(row.url)"
          >
            <span class="c-pair__invite-url">{{ shown(row.url) }}</span>
            <span class="c-hint">{{ row.expiry }}</span>
            <span class="c-pair__invite-actions">
              <button
                class="c-ibtn"
                type="button"
                [attr.aria-label]="t('common.copy')"
                [title]="t('common.copy')"
                (click)="copy(row.invite)"
              >
                <svg sfIcon="copy" [size]="15"></svg>
              </button>
              <button
                class="c-btn c-btn--sm"
                type="button"
                [attr.aria-label]="t('regie.pairing.link.revokeInvite', { url: shown(row.url) })"
                [disabled]="commands.blocked('invite:' + row.invite.id)"
                (click)="revoke(row.invite)"
              >
                {{ t('regie.pairing.link.revokeShort') }}
              </button>
            </span>
          </li>
        }
      </ul>
    }
  `,
  styleUrl: './pairing-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkTabComponent {
  protected readonly t = t;
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
  /** The links are shown in the clear ("Show link"). */
  protected readonly revealed = signal(false);

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

  /** The right-click menu of an open invite: the same commands as its buttons. */
  protected inviteMenu(row: InviteRow): () => readonly ContextMenuEntry[] {
    return () => [
      { label: t('common.copy'), icon: 'copy', run: () => this.copy(row.invite) },
      {
        label: t('regie.pairing.link.revokeShort'),
        danger: true,
        disabled: this.commands.blocked('invite:' + row.invite.id),
        run: () => void this.revoke(row.invite),
      },
    ];
  }

  /** "Create link". */
  protected async create(): Promise<void> {
    const invite = await this.commands.run('invite:create', (productionId) =>
      this.api.createInvite(productionId, { kind: 'laptopLink' }),
    );
    if (invite) {
      this.created.set(invite);
      this.createdId.set(invite.id);
      this.toasts.show(t('regie.pairing.link.toastCreated'));
    }
  }

  /** "Revoke link": the link stops working at once. */
  protected async revoke(invite: InviteDto): Promise<void> {
    const done = await this.commands.run(
      `invite:${invite.id}`,
      async (productionId) => {
        await this.api.revokeInvite(productionId, invite.id);
        return true;
      },
      { errors: { not_found: msg('regie.pairing.link.gone') } },
    );
    if (done) {
      if (this.createdId() === invite.id) {
        this.createdId.set(null);
        this.created.set(null);
      }
      this.toasts.show(t('regie.pairing.link.toastRevoked'));
    }
  }

  /** The link as it is shown: masked until "Show link". */
  protected shown(display: string): string {
    return this.revealed() ? display : maskedUrl(display);
  }

  /** Copies the full link; the toast names it the way it is shown. */
  protected copy(invite: InviteDto): void {
    const current = this.createdId() === invite.id;
    void this.clipboard.copy(invite.url, {
      label: this.shown(displayUrl(invite.url)),
      selectElement: current && this.revealed() ? (this.urlElement()?.nativeElement ?? null) : null,
    });
  }
}
