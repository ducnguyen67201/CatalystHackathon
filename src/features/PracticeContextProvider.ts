import { createEmptyPracticeContext, type PracticeContext } from '../contracts/PracticeContext.js';

/** Future adapters assemble company data here; the voice transport has no data-source dependencies. */
export interface PracticeContextProvider {
  loadContext(): Promise<PracticeContext>;
}

export class NoopPracticeContextProvider implements PracticeContextProvider {
  loadContext(): Promise<PracticeContext> {
    return Promise.resolve(createEmptyPracticeContext());
  }
}
