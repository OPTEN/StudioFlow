import { msg, type Msg } from '@studioflow/i18n';
import type { ApplyOutcome } from '../core/state/server-settings.service';

/**
 * A problem of a server form in the operator's words, with what the person who runs the server needs to look further:
 * the command that shows more and, when the service said why, its reason (English, from the API).
 */
export interface ServerProblem {
  readonly message: Msg;
  readonly command?: string | null;
  readonly detail?: string | null;
}

/** The command that shows more about each service of the stack. */
export const SERVICE_COMMANDS = {
  caddy: 'docker compose logs api caddy',
  liveKit: 'docker compose logs livekit',
  backup: 'docker compose logs backup',
  any: 'docker compose ps',
} as const;

/** What to tell the operator when a service did not take over the saved settings: which one, or that time ran out. */
export function applyProblem(outcome: ApplyOutcome): ServerProblem {
  const failed = outcome.failed[0];
  switch (failed?.target) {
    case 'caddy':
      return {
        message: msg('regie.server.apply.caddy'),
        command: SERVICE_COMMANDS.caddy,
        detail: failed.error,
      };
    case 'liveKit':
      return {
        message: msg('regie.server.apply.liveKit'),
        command: SERVICE_COMMANDS.liveKit,
        detail: failed.error,
      };
    case 'backup':
      return {
        message: msg('regie.server.apply.backup'),
        command: 'docker compose ps backup',
        detail: failed.error,
      };
    default:
      return { message: msg('regie.server.apply.timeout'), command: SERVICE_COMMANDS.any };
  }
}

/** A problem without anything for the server room (validation, a refusal the API explained). */
export function plainProblem(message: Msg): ServerProblem {
  return { message };
}
