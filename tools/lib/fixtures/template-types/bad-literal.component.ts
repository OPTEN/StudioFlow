import { Component } from '@angular/core';
import { t } from '@studioflow/i18n';

/** A template literal with a member that has no key. */
@Component({ selector: 'sf-bad-literal', templateUrl: './bad-literal.component.html' })
export class BadLiteralComponent {
  protected readonly t = t;
  protected readonly name = 'Break';
  protected readonly failure = 'in-use' as 'in-use' | 'gone';
}
