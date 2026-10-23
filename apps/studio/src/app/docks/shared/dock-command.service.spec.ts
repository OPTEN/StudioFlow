import { TestBed } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ApiError } from '../../core/api/api-error';
import { ToastService } from '../../core/ui/toast.service';
import { DockCommandService } from './dock-command.service';

describe('DockCommandService', () => {
  let hub: FakeStudioHub;
  let harness: StoreHarness;
  let commands: DockCommandService;
  let toasts: ToastService;

  beforeEach(async () => {
    hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(hub);
    commands = TestBed.inject(DockCommandService);
    toasts = TestBed.inject(ToastService);
  });

  afterEach(() => harness.http.verify());

  it('runs a command once while its key is busy (double-click protection)', async () => {
    let resolve: (value: string) => void = () => undefined;
    const action = vi.fn(
      (productionId: string) =>
        new Promise<string>((done) => {
          expect(productionId).toBe(PRODUCTION_ID);
          resolve = done;
        }),
    );
    const first = commands.run('knock:1', action);
    const second = commands.run('knock:1', action);
    expect(commands.busy('knock:1')).toBe(true);
    expect(commands.anyBusy()).toBe(true);
    expect(await second).toBeUndefined();
    resolve('ok');
    expect(await first).toBe('ok');
    expect(action).toHaveBeenCalledTimes(1);
    expect(commands.busy('knock:1')).toBe(false);
  });

  it('does not send while offline and says why', async () => {
    hub.drop();
    await flushMicrotasks();
    const action = vi.fn(() => Promise.resolve(1));
    expect(await commands.run('x', action)).toBeUndefined();
    expect(action).not.toHaveBeenCalled();
    expect(toasts.current()?.message).toBe(
      'No connection to the server. Please try again in a moment.',
    );
    expect(await commands.run('x', action, { allowOffline: true })).toBe(1);
  });

  it('turns errors into toasts, with overrides and inline handling', async () => {
    const fail = () => Promise.reject(new ApiError({ status: 409, code: 'asset_in_use' }));
    expect(await commands.run('a', fail)).toBeUndefined();
    expect(toasts.current()?.message).toBe('The file is still in use and cannot be deleted.');
    await commands.run('a', fail, { errors: { asset_in_use: 'Still in “Break”.' } });
    expect(toasts.current()?.message).toBe('Still in “Break”.');
    toasts.dismiss();
    const handled = vi.fn(() => true);
    await commands.run('a', fail, { onError: handled });
    expect(handled).toHaveBeenCalledOnce();
    expect(toasts.current()).toBeNull();
    expect(commands.busy('a')).toBe(false);
  });
});
