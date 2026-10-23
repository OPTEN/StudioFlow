import { Component } from '@angular/core';
import { t } from '@studioflow/i18n';

/** A parameter that the message needs is missing. */
@Component({ selector: 'sf-missing-param', templateUrl: './missing-param.component.html' })
export class MissingParamComponent {
  protected readonly t = t;
  protected readonly name = 'Break';
  protected readonly failure = 'in-use' as 'in-use';
}
