import { auditEntryFixture } from '../../testing/fixtures';
import { actorLabel, detailRows, productionLabel } from './audit-view';

describe('actorLabel', () => {
  it('names the admin and the system', () => {
    expect(actorLabel(auditEntryFixture(1, { actor: 'admin' }))).toBe('Admin');
    expect(actorLabel(auditEntryFixture(1, { actor: 'system' }))).toBe('System');
  });

  it('names a device by the slot codes and the name of the entry', () => {
    const entry = auditEntryFixture(1, {
      actor: 'device:dev_abc',
      details: { codes: 'S1, S2', device: 'Laptop Mia' },
    });
    expect(actorLabel(entry)).toBe('Device S1, S2 Laptop Mia');
    expect(actorLabel({ ...entry, details: { device: 'Phone' } })).toBe('Device Phone');
  });

  it('says "Device" when the entry does not name it', () => {
    expect(actorLabel(auditEntryFixture(1, { actor: 'device:dev_abc', details: {} }))).toBe(
      'Device',
    );
  });
});

describe('productionLabel', () => {
  it('prefers the name, then the id, then a dash', () => {
    expect(productionLabel({ productionId: 'prd_1', productionName: 'Webinar' })).toBe('Webinar');
    expect(productionLabel({ productionId: 'prd_1', productionName: null })).toBe('prd_1');
    expect(productionLabel({ productionId: null, productionName: null })).toBe('–');
  });
});

describe('detailRows', () => {
  it('lists every detail in order', () => {
    expect(detailRows({ details: { username: 'regie', ip: '203.0.113.5' } })).toEqual([
      { key: 'username', value: 'regie' },
      { key: 'ip', value: '203.0.113.5' },
    ]);
    expect(detailRows({ details: {} })).toEqual([]);
  });
});
