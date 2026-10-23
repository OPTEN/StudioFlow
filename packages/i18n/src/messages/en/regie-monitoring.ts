import type { Namespace } from '../../types';

/** The `/monitoring` page. The foundation seeds the route title; the Regie shell work continues here. */
export const regieMonitoring = {
  'regie.monitoring.title': 'Monitoring',
} as const satisfies Namespace<'regie.monitoring'>;
