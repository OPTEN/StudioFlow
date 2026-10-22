import { test, expect } from '@playwright/test';
import { SERVICES, inspectService } from '../../support/stack';

test('H-STACK-01 all four containers of fs-e2e are healthy @smoke @harness', async () => {
  for (const service of SERVICES) {
    const state = await inspectService(service);
    expect(state?.running, `${service} running`).toBe(true);
    expect(state?.health, `${service} health`).toBe('healthy');
  }
});
