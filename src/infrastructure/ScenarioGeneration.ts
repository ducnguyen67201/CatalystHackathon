import { z } from 'zod';
import {
  scenarioOutputSchema,
  scenarioGenerationOutputSchema,
  type ScenarioInput,
  type ScenarioOutput,
} from '../contracts/Scenario.js';
import type { ScenarioGenerator } from '../features/ScenarioService.js';
import { SCENARIO_SYSTEM_PROMPT, scenarioDataPrompt } from '../prompts/ScenarioPrompt.js';

/** Deterministic, explicitly labeled rehearsal examples; never invents investor facts. */
export class DemoScenarioGenerator implements ScenarioGenerator {
  readonly mode = 'demo';
  readonly model = 'local-template-v3';
  generate(input: ScenarioInput): Promise<ScenarioOutput> {
    const founder = input.sources.find((source) => source.kind === 'founder_initial');
    if (!founder) throw new Error('Founder context unavailable.');
    const research = input.sources.filter((source) => source.kind === 'investor_research');
    const financials = input.sources.find((source) => source.kind === 'financials');
    if (input.preparation) {
      const refs = [
        financials?.id ?? founder.id,
        ...research.slice(0, 1).map((source) => source.id),
      ];
      return Promise.resolve(
        scenarioOutputSchema.parse({
          investorProfile: {
            themes: research.slice(0, 3).map((source) => ({
              text: source.excerpt,
              kind: 'observation',
              sourceIds: [source.id],
            })),
            practiceApproach: [
              {
                text: 'Rehearse the founder-reviewed financial story while checking its claims against the saved statement. This template is a preparation exercise, not an investor prediction.',
                kind: 'hypothesis',
                sourceIds: refs,
              },
            ],
            unknowns: [
              'Current mandate, private investor priorities and cash runway remain unconfirmed.',
            ],
          },
          scenarios: [
            {
              id: 'approved-financial-story',
              title: 'Explain the approved financial story',
              situation:
                'Template rehearsal using the exact approved pitch and selected investor brief.',
              objective: input.objective,
              challenge:
                'Distinguish operating performance, credits and what remains unknown about cash.',
              rationale: [
                {
                  text: 'Practise the approved explanation against its frozen financial sources.',
                  kind: 'hypothesis',
                  sourceIds: refs,
                },
              ],
              openingQuestion:
                'Explain the operating result, credit and net income in your approved financial story. What does the statement establish, and what remains unknown about cash?',
              branches: [
                {
                  condition: 'The founder treats net income as operating profitability',
                  question:
                    'How does the reported credit change the net result without establishing operating profitability?',
                },
                {
                  condition: 'The founder makes a cash or runway claim',
                  question:
                    'What cash evidence supports that conclusion, and what remains unconfirmed?',
                },
              ],
              successCriteria: [
                'Use the exact period, figures and currency limitations from saved evidence.',
                'Separate operating performance from credits and acknowledge missing cash evidence.',
              ],
              unknowns: [
                'Credit recurrence and cash receipt timing are not established by an income statement.',
              ],
              clarificationQuestions: [
                'What is confirmed about this investor’s current participation criteria?',
              ],
              personalization: research.length ? 'research_grounded' : 'limited_context',
            },
          ],
        }),
      );
    }
    const sourceIds = [founder.id, ...research.slice(0, 1).map((source) => source.id)];
    const rationale = [
      {
        text: 'Practise connecting the saved company goal to a specific investor conversation. This is a suggested exercise.',
        kind: 'hypothesis',
        sourceIds,
      },
    ];
    const output = scenarioOutputSchema.parse({
      investorProfile: {
        themes: research.slice(0, 3).map((source) => ({
          text: source.excerpt,
          kind: 'observation',
          sourceIds: [source.id],
        })),
        practiceApproach: [
          {
            text: 'Ask the founder to explain the business and what they want to learn about investor fit. This rehearsal approach is not a personality prediction.',
            kind: 'hypothesis',
            sourceIds: [founder.id],
          },
        ],
        unknowns: [
          'The investor’s private intentions and likely questions are unknown.',
          ...(research.length
            ? ['Saved research may be incomplete or outdated; verify its identity and claims.']
            : ['No saved research is available for this investor.']),
        ],
      },
      scenarios: [
        {
          id: 'explain-the-business',
          title: 'Explain the business and test investor fit',
          situation: 'An introductory practice conversation using the saved company context.',
          objective:
            input.objective ||
            founder.company.goal ||
            'Explain the business clearly and identify what to verify about investor fit.',
          challenge:
            'Make the company’s purpose clear without claiming investor interest that has not been established.',
          rationale,
          openingQuestion:
            'What problem does your company solve, and what would you like to learn from this investor conversation?',
          branches: [
            {
              condition: 'The answer is vague',
              question: 'Who is the customer, and what specific problem are you solving for them?',
            },
            {
              condition: 'The answer is specific',
              question: 'What evidence would you bring to support that explanation?',
            },
            {
              condition: 'The answer assumes the investor is interested',
              question:
                'What have you confirmed about their investment focus, and what remains an assumption?',
            },
          ],
          successCriteria: [
            'Explain the customer and problem in plain language.',
            'Distinguish known investor evidence from assumptions.',
          ],
          unknowns: [
            financials
              ? 'The reasons behind the financial results remain unconfirmed.'
              : 'No financial CSV is available for this scenario.',
          ],
          clarificationQuestions: ['What is the intended outcome of this meeting?'],
          personalization: research.length ? 'research_grounded' : 'limited_context',
        },
        {
          id: 'explain-the-raise',
          title: 'Explain the purpose of the raise',
          situation: 'A practice discussion about the founder’s stated fundraising goal.',
          objective: 'Explain what funding would enable and what evidence you still need.',
          challenge: 'Describe the intended milestones without inventing financial projections.',
          rationale: [
            {
              text: 'The saved company goal is a starting point for discussing intended use of funding.',
              kind: 'hypothesis',
              sourceIds: [founder.id],
            },
          ],
          openingQuestion: 'What would raising capital let your company achieve next?',
          branches: [
            {
              condition: 'The answer names a milestone',
              question: 'What would demonstrate that you reached that milestone?',
            },
            {
              condition: 'The answer includes unsupported financial projections',
              question:
                'Which assumptions support those projections, and what information would you need to validate them?',
            },
          ],
          successCriteria: [
            'Connect funding to a concrete intended outcome.',
            'State what evidence is missing instead of inventing numbers.',
          ],
          unknowns: [
            financials
              ? 'Forecasts and pitch documents are not connected.'
              : 'No financial CSV, forecast or pitch document is available.',
          ],
          clarificationQuestions: ['What milestone matters most before your next raise?'],
          personalization: 'limited_context',
        },
      ],
    });
    const priorTitles = new Set(input.previousScenarios.map((item) => item.title));
    if (priorTitles.has(output.scenarios[0]?.title ?? '')) {
      const first = output.scenarios[0];
      if (first) {
        first.id = 'validate-the-customer';
        first.title = 'Defend your customer evidence';
        first.objective = 'Separate what customers have demonstrated from what you still assume.';
        first.openingQuestion =
          'Which customer evidence most strongly supports your business, and what has it not proved yet?';
      }
    }
    if (priorTitles.has(output.scenarios[1]?.title ?? '')) {
      const second = output.scenarios[1];
      if (second) {
        second.id = 'prioritize-the-milestone';
        second.title = 'Prioritize the next milestone';
        second.objective =
          'Explain the next milestone and what you would deprioritize to achieve it.';
        second.openingQuestion =
          'If you could fund only one next milestone, which would you choose and why?';
      }
    }
    const snapshot = financials?.snapshots[0];
    const row = snapshot?.periods.at(-1);
    if (financials && snapshot && row)
      output.scenarios.push({
        id: 'explain-financial-evidence',
        title: 'Explain the financial evidence',
        situation: `An investor asks you to explain saved figures from ${snapshot.fileName}, ${row.month}, CSV row ${row.sourceRow}.`,
        objective:
          'Explain reported performance while separating known figures from unconfirmed causes.',
        challenge: `The saved operating income is ${row.operatingIncome}, credit is ${row.credit}, and net income is ${row.netIncome} (${snapshot.currency ?? 'currency unknown'}). Explain what these figures establish and what they do not.`,
        rationale: [
          {
            text: 'The saved CSV provides financial figures that can anchor this practice question.',
            kind: 'observation',
            sourceIds: [financials.id],
          },
        ],
        openingQuestion: `In ${row.month}, the CSV reports operating income of ${row.operatingIncome} and net income of ${row.netIncome}. How would you explain these figures to an investor?`,
        branches: [
          {
            condition: 'The answer explains a cause',
            question: 'What evidence supports that explanation, and what remains an assumption?',
          },
          {
            condition: 'The answer quotes a figure',
            question: 'Which month and CSV row support it, and is the currency confirmed?',
          },
        ],
        successCriteria: [
          'Quote the saved figures and source month accurately.',
          'Separate income statement evidence from cash runway and forecasts.',
        ],
        unknowns: [
          'Cash runway and the causes of changes are not established by these saved income statement rows.',
        ],
        clarificationQuestions: ['What supporting information would help explain the figures?'],
        personalization: 'limited_context',
      });
    for (const scenario of output.scenarios) {
      const sourceIds = [...new Set(scenario.rationale.flatMap((item) => item.sourceIds))];
      scenario.openingWhy = {
        brief:
          'Practise the saved objective using the available sources, while keeping assumptions and missing evidence explicit.',
        explanation: scenario.rationale.map((item) => item.text).join(' '),
        answerObjective: scenario.successCriteria.join(' '),
        sourceIds,
        missingInputs: scenario.unknowns,
      };
      for (const branch of scenario.branches)
        branch.why = {
          brief: 'This follow-up applies when: ' + branch.condition.toLowerCase() + '.',
          explanation:
            'This template follow-up asks for a clearer explanation or supporting evidence; it does not predict what the investor will ask.',
          answerObjective: scenario.successCriteria.join(' '),
          sourceIds,
          missingInputs: scenario.unknowns,
        };
    }
    return Promise.resolve(scenarioGenerationOutputSchema.parse(output));
  }
}

const completionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().max(60000).nullable() }) }))
    .min(1),
});

export class LiveScenarioGenerator implements ScenarioGenerator {
  readonly mode = 'live';
  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}
  async generate(input: ScenarioInput): Promise<ScenarioOutput> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.apiKey },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SCENARIO_SYSTEM_PROMPT },
          { role: 'user', content: scenarioDataPrompt(input) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'practice_scenarios',
            strict: true,
            schema: z.toJSONSchema(scenarioGenerationOutputSchema),
          },
        },
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error('Scenario provider failed.');
    const raw: unknown = await response.json();
    const content = completionSchema.parse(raw).choices[0]?.message.content;
    if (!content) throw new Error('Scenario provider returned no structured output.');
    const output: unknown = JSON.parse(content);
    return scenarioGenerationOutputSchema.parse(output);
  }
}
