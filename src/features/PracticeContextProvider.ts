import { createEmptyPracticeContext, type PracticeContext } from '../contracts/PracticeContext.js';
import type { ScenarioSelection } from '../contracts/Scenario.js';

/** Future adapters assemble company data here; the voice transport has no data-source dependencies. */
export interface PracticeContextProvider {
  loadContext(selection?: ScenarioSelection): Promise<PracticeContext>;
}

export class NoopPracticeContextProvider implements PracticeContextProvider {
  loadContext(): Promise<PracticeContext> {
    return Promise.resolve(createEmptyPracticeContext());
  }
}
