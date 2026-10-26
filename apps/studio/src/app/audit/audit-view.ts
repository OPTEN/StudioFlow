import { t, type PlainMessageKey } from '@studioflow/i18n';
import type { AuditCategory, AuditEntryDto } from '@studioflow/scene-model';

/** The message of each category (`regie.audit.category.<category>`); the compiler demands one per category of the API. */
export const AUDIT_CATEGORY_KEYS = {
  production: 'regie.audit.category.production',
  devices: 'regie.audit.category.devices',
  security: 'regie.audit.category.security',
  media: 'regie.audit.category.media',
  output: 'regie.audit.category.output',
  system: 'regie.audit.category.system',
} as const satisfies Record<AuditCategory, PlainMessageKey>;

/** Who did it: "Admin", "System", or "Device K1 Phone 1" (the name and slot codes the entry carries). */
export function actorLabel(entry: Pick<AuditEntryDto, 'actor' | 'details'>): string {
  if (entry.actor === 'admin') {
    return t('regie.audit.actor.admin');
  }
  if (entry.actor === 'system') {
    return t('regie.audit.actor.system');
  }
  const name = [entry.details['codes'], entry.details['device']].filter(Boolean).join(' ');
  return name === '' ? t('regie.audit.actor.device') : t('regie.audit.actor.deviceNamed', { name });
}

/** The production of an entry: its name, the id of one that is gone, or "–" for a sign-in or an account change. */
export function productionLabel(
  entry: Pick<AuditEntryDto, 'productionId' | 'productionName'>,
): string {
  return entry.productionName ?? entry.productionId ?? '–';
}

/** The details of an entry as rows, in the order the server wrote them. */
export function detailRows(
  entry: Pick<AuditEntryDto, 'details'>,
): readonly { key: string; value: string }[] {
  return Object.entries(entry.details).map(([key, value]) => ({ key, value }));
}
