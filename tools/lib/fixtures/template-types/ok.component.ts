import { Component } from '@angular/core';
import { t } from '@studioflow/i18n';

/** Every call is valid: a plain key, parameters, a plural count and a template literal over valid members. */
@Component({ selector: 'sf-ok', templateUrl: './ok.component.html' })
export class OkComponent {
  protected readonly t = t;
  protected readonly name = 'Break';
  protected readonly failure = 'in-use' as 'in-use' | 'not-found';
}
