import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { IconComponent } from '../../core/ui/icon.component';
import { InspectorSectionsService, type InspectorSectionId } from './inspector-sections.service';

/**
 * A collapsible section of the Properties dock, like a disclosure group in an inspector of Apple's apps: the title with
 * a chevron (and an optional muted note on the right, such as the canvas size), then the fields. Native
 * `<details>`/`<summary>`, so it opens and closes with the mouse, Enter and Space and tells assistive technology whether
 * it is expanded. Whether it is open is remembered per browser ({@link InspectorSectionsService}).
 *
 * ```html
 * <sf-inspector-section section="geometry" [title]="t('regie.properties.section.geometry')">…fields…</sf-inspector-section>
 * ```
 */
@Component({
  selector: 'sf-inspector-section',
  imports: [IconComponent],
  template: `
    <details class="c-insp-sec" [open]="open()" (toggle)="onToggle($event)">
      <summary class="c-insp-sec__head">
        <svg class="c-insp-sec__chev" sfIcon="chev-right" [size]="12"></svg>
        <span class="c-insp-sec__title">{{ title() }}</span>
        @if (note()) {
          <span class="c-insp-sec__note">{{ note() }}</span>
        }
      </summary>
      <div class="c-insp-sec__body">
        <ng-content />
      </div>
    </details>
  `,
  styleUrl: './inspector-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorSectionComponent {
  /** Which section this is (the key of its remembered state). */
  readonly section = input.required<InspectorSectionId>();
  /** The section title. */
  readonly title = input.required<string>();
  /** A short muted note at the end of the title row, or null. */
  readonly note = input<string | null>(null);

  private readonly sections = inject(InspectorSectionsService);
  protected readonly open = computed(() => this.sections.isOpen(this.section()));

  protected onToggle(event: Event): void {
    this.sections.setOpen(this.section(), (event.target as HTMLDetailsElement).open);
  }
}
