import type { DockSlotId } from './dock-layout';
import type { SplitterBehavior } from './splitter.directive';

/**
 * What a dock slot needs from the surrounding workspace (provided by `WorkspaceComponent`): the behaviour of the
 * hairline between two neighbouring docks. Separate token so the slot does not import the workspace component.
 */
export abstract class DockWorkspace {
  /** Behaviour of the splitter between dock `a` and dock `b`; `across` for side-by-side docks (bottom zone). */
  abstract splitBehavior(a: DockSlotId, b: DockSlotId, across: boolean): SplitterBehavior;
}
