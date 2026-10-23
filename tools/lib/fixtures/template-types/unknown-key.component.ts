import { Component } from '@angular/core';
import { t } from '@studioflow/i18n';

/** An unknown key. */
@Component({ selector: 'sf-unknown-key', templateUrl: './unknown-key.component.html' })
export class UnknownKeyComponent {
  protected readonly t = t;
  protected readonly name = 'Break';
  protected readonly failure = 'in-use' as 'in-use';
}
