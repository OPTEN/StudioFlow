import { msg, type Msg } from '@studioflow/i18n';
import type { ApplyOutcome } from '../core/state/server-settings.service';

/** What to tell the operator when a service did not take over the saved settings: which one, or that time ran out. */
export function applyFailureMsg(outcome: ApplyOutcome): Msg {
  const failed = outcome.failed[0]?.target;
  switch (failed) {
    case 'caddy':
      return msg('regie.server.apply.caddy');
    case 'liveKit':
      return msg('regie.server.apply.liveKit');
    case 'backup':
      return msg('regie.server.apply.backup');
    default:
      return msg('regie.server.apply.timeout');
  }
}
