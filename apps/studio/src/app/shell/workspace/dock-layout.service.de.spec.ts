import { TestBed } from '@angular/core/testing';
import { resetLocaleForTests } from '@studioflow/i18n';
import { MemoryStorage } from '../../../testing/store-harness';
import { BROWSER_STORAGE } from '../../core/ui/preferences.service';
import { ToastService } from '../../core/ui/toast.service';
import { DockLayoutService } from './dock-layout.service';

describe('DockLayoutService in German', () => {
  beforeEach(() => {
    resetLocaleForTests('de-CH');
    TestBed.configureTestingModule({
      providers: [{ provide: BROWSER_STORAGE, useValue: () => new MemoryStorage() }],
    });
  });

  it('says where a dock is docked and offers to reset the layout', () => {
    const layout = TestBed.inject(DockLayoutService);
    const toasts = TestBed.inject(ToastService);
    layout.moveDock('st', 'right', 0);
    expect(toasts.current()).toMatchObject({
      message: 'Stationen ist rechts angedockt',
      action: { label: 'Layout zurücksetzen' },
    });
    layout.moveDock('scenes', 'left', 0);
    expect(toasts.current()?.message).toBe('Szenen ist links angedockt');
    layout.moveDock('st', 'bottom', 0);
    expect(toasts.current()?.message).toBe('Stationen ist unten angedockt');
  });
});
