import { withoutPeerComparison } from '../contracts/RehearsalEvaluation.js';
import { createHash } from 'node:crypto';
import {
  liveGuidanceOutputSchema,
  liveGuidanceRequestSchema,
  liveGuidanceResponseSchema,
  type LiveGuidanceOutput,
  type LiveGuidanceRequest,
  type LiveGuidanceResponse,
} from '../contracts/LiveGuidance.js';
import type { EvaluationContext } from '../contracts/RehearsalEvaluation.js';
import type { Workspace } from '../contracts/Workspace.js';

export interface LiveGuidanceWorkspace {
  read(): Promise<Pick<Workspace, 'rehearsals'>>;
}

export interface LiveGuidanceInput extends LiveGuidanceRequest {
  context: EvaluationContext;
}
export interface LiveGuidanceProvider {
  generate(input: LiveGuidanceInput): Promise<LiveGuidanceOutput>;
}

/** Caption text is unverified. Only frozen, cited facts can supply numbers in guidance. */
export function validateLiveGuidance(raw: unknown, context: EvaluationContext): LiveGuidanceOutput {
  const output = liveGuidanceOutputSchema.parse(raw);
  for (const id of output.why.sourceIds) {
    if (!context.sources.some((source) => source.id === id))
      throw new Error('Unknown guidance source.');
  }
  const facts = output.factIds.map((id) => {
    const fact = context.facts.find((item) => item.id === id);
    if (!fact || fact.sourceIds.some((sourceId) => !output.why.sourceIds.includes(sourceId))) {
      throw new Error('Uncited guidance fact.');
    }
    return fact;
  });
  const render = (text: string) => {
    const placeholder = /\{\{fact:([^{}]+)\}\}/g;
    if (/\d/.test(text.replace(placeholder, ''))) throw new Error('Uncited guidance number.');
    const result = text.replace(placeholder, (_match: string, id: string) => {
      const fact = facts.find((item) => item.id === id);
      if (!fact) throw new Error('Unknown guidance fact.');
      return `${fact.value} (${fact.unit === 'unspecified' ? 'currency unconfirmed' : fact.unit}, ${fact.period})`;
    });
    if (/[{}]/.test(result)) throw new Error('Unresolved guidance placeholder.');
    return result;
  };
  return liveGuidanceOutputSchema.parse({
    ...output,
    why: {
      ...output.why,
      brief: render(output.why.brief),
      explanation: render(output.why.explanation),
      answerObjective: render(output.why.answerObjective),
      missingInputs: output.why.missingInputs.map(render),
    },
  });
}

/** Bounded, ephemeral sidecar; it never writes captions into authoritative session history. */
export class LiveGuidanceService {
  private readonly cache = new Map<
    string,
    { expires: number; result: Promise<LiveGuidanceResponse> }
  >();
  private pending = 0;
  constructor(
    private readonly workspace: LiveGuidanceWorkspace,
    private readonly provider: LiveGuidanceProvider,
  ) {}

  async explain(sessionId: string, raw: unknown): Promise<LiveGuidanceResponse> {
    const input = liveGuidanceRequestSchema.parse(raw);
    const session = (await this.workspace.read()).rehearsals.find((item) => item.id === sessionId);
    if (
      !session ||
      session.status !== 'active' ||
      !session.evaluationContext ||
      (session.mode !== 'elevenlabs' && session.mode !== 'liveavatar')
    ) {
      throw new Error('Session unavailable for live guidance.');
    }
    const context = session.evaluationContext;
    const question = input.turns.at(-1)?.text;
    if (!question) throw new Error('Session unavailable for live guidance.');
    const key = sessionId + ':' + createHash('sha256').update(JSON.stringify(input)).digest('hex');
    for (const [id, entry] of this.cache) if (entry.expires < Date.now()) this.cache.delete(id);
    const cached = this.cache.get(key);
    if (cached) return cached.result;
    if (this.pending >= 4) throw new Error('This practice guidance is busy. Retry shortly.');
    this.pending += 1;
    const result = Promise.resolve()
      .then(() => this.provider.generate({ ...input, context: withoutPeerComparison(context) }))
      .then((output) =>
        liveGuidanceResponseSchema.parse({
          ...validateLiveGuidance(output, context),
          question,
          context,
        }),
      )
      .catch((error: unknown) => {
        this.cache.delete(key);
        throw error;
      })
      .finally(() => {
        this.pending -= 1;
      });
    if (this.cache.size >= 200) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { expires: Date.now() + 10 * 60 * 1000, result });
    return result;
  }
}
