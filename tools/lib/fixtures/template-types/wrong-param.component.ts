import { Component } from '@angular/core';
import { t } from '@studioflow/i18n';

/** A parameter name the message does not have. */
@Component({ selector: 'sf-wrong-param', templateUrl: './wrong-param.component.html' })
export class WrongParamComponent {
  protected readonly t = t;
  protected readonly name = 'Break';
  protected readonly failure = 'in-use' as 'in-use';
}
