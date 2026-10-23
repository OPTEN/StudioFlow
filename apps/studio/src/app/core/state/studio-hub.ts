import { InjectionToken } from '@angular/core';
import { ResilientHub, type SyncHub } from '@studioflow/realtime-client';
import { HUB } from '@studioflow/scene-model';

/**
 * The part of `ResilientHub` the Regie uses for `/hubs/studio`: lifecycle, server → client handlers and invoke.
 * `ResilientHub` satisfies it; tests provide a fake through {@link STUDIO_HUB_FACTORY}.
 */
export interface StudioHub extends SyncHub {
  start(): void;
  restart(): void;
  stop(): Promise<void>;
  invoke<T>(method: string, ...args: unknown[]): Promise<T>;
}

/**
 * Creates the Regie hub connection (cookie authentication, no token). One hub per store run; replaced in tests.
 */
export const STUDIO_HUB_FACTORY = new InjectionToken<() => StudioHub>('STUDIO_HUB_FACTORY', {
  providedIn: 'root',
  factory: () => () => new ResilientHub({ url: HUB.studioPath }),
});
