import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  WorkflowLogger,
  describeResearchFailure,
  ProviderRequestError,
} from '../src/infrastructure/WorkflowLogger.js';
import { LogEvent, LogReason } from '../src/features/WorkflowLog.js';
import { LiveResearch } from '../src/infrastructure/Research.js';
import { profileSchema } from '../src/contracts/Workspace.js';

const profile = profileSchema.parse({
  name: 'Private company',
  stage: 'Seed',
  sector: 'B2B software',
  geography: 'Canada',
  raiseTarget: '1000000',
  currency: 'CAD',
  goal: 'private goal',
  version: 1,
  watchlist: [],
});

const logSchema = z.object({
  event: z.string(),
  jobId: z.string().optional(),
  reason: z.string().optional(),
  statusCode: z.number().optional(),
  provider: z.string().optional(),
});
const parseLines = (lines: string[]) =>
  lines.map((line) => {
    const raw: unknown = JSON.parse(line);
    return logSchema.parse(raw);
  });

describe('structured workflow diagnostics', () => {
  it('isolates concurrent job context and strips unexpected sensitive fields', async () => {
    const lines: string[] = [];
    const logger = new WorkflowLogger('debug', (line) => lines.push(line));
    const fields = { count: 0, apiKey: 'secret-value', prompt: 'private prompt' };
    await Promise.all(
      ['job-a', 'job-b'].map((jobId) =>
        logger.run({ jobId }, async () => {
          await Promise.resolve();
          logger.write(LogEvent.RESEARCH_COMPLETED, fields);
        }),
      ),
    );
    expect(
      parseLines(lines)
        .map((line) => line.jobId)
        .sort(),
    ).toEqual(['job-a', 'job-b']);
    expect(lines.join('')).not.toContain('secret-value');
    expect(lines.join('')).not.toContain('private prompt');
  });

  it('filters debug events and respects silent mode', () => {
    const lines: string[] = [];
    const logger = new WorkflowLogger('info', (line) => lines.push(line));
    logger.write(LogEvent.SOURCE_REJECTED, { reason: LogReason.NO_TEXT }, 'debug');
    logger.write(LogEvent.RESEARCH_STARTED);
    new WorkflowLogger('silent', (line) => lines.push(line)).write(
      LogEvent.WORKFLOW_FAILED,
      {},
      'error',
    );
    expect(parseLines(lines).map((line) => line.event)).toEqual(['research_started']);
  });

  it.each([undefined, '', '   '])(
    'fails explicitly when a live key is missing (%s)',
    async (missingKey) => {
      const lines: string[] = [];
      const logger = new WorkflowLogger('debug', (line) => lines.push(line));
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);
      try {
        await expect(
          logger.run({ jobId: 'missing-key-job' }, () =>
            new LiveResearch(missingKey, 'test-key', 'gpt-6.1-sol', logger).discover(profile),
          ),
        ).rejects.toThrow('Add EXA_API_KEY and OPENAI_API_KEY in Doppler');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(parseLines(lines).map((line) => line.event)).toEqual([
          'research_started',
          'research_failed',
        ]);
        expect(parseLines(lines)).toContainEqual(
          expect.objectContaining({
            jobId: 'missing-key-job',
            reason: 'configuration_missing',
          }),
        );
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('reports provider HTTP failures without logging response bodies or secrets', async () => {
    const lines: string[] = [];
    const logger = new WorkflowLogger('debug', (line) => lines.push(line));
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(Response.json({ secret: 'provider-body-secret' }, { status: 401 })),
      ),
    );
    try {
      await expect(
        new LiveResearch('exa-secret', 'openai-secret', 'gpt-6.1-sol', logger).discover(profile),
      ).rejects.toThrow('401');
      expect(parseLines(lines)).toContainEqual(
        expect.objectContaining({
          event: 'research_failed',
          provider: 'exa',
          statusCode: 401,
          reason: 'http_error',
        }),
      );
      expect(lines.join('')).not.toMatch(
        /provider-body-secret|exa-secret|openai-secret|private goal/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('distinguishes returned pages from rejected evidence', async () => {
    const lines: string[] = [];
    const logger = new WorkflowLogger('debug', (line) => lines.push(line));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          results: [
            { title: 'Empty source', url: 'https://example.com/no-text' },
            {
              title: 'Wrong identity',
              url: 'https://example.com/person',
              text: 'Other person invests.',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  investor: 'Other person',
                  matchesTarget: false,
                  stage: null,
                  sector: null,
                  geography: null,
                  checkMin: null,
                  checkMax: null,
                  currency: 'unspecified',
                  quote: 'Other person invests.',
                  explanation: 'Does not match.',
                  comparableDeal: null,
                }),
              },
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(
        await new LiveResearch('test', 'test', 'gpt-6.1-sol', logger).discover(profile),
      ).toEqual([]);
      expect(
        parseLines(lines)
          .filter((line) => line.event === 'source_rejected')
          .map((line) => line.reason),
      ).toEqual(['no_text', 'identity_mismatch']);
      expect(lines.join('')).not.toContain('Other person invests.');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('classifies exceptions without exposing arbitrary messages', () => {
    expect(describeResearchFailure(new Error('private database connection'))).toEqual({
      reason: 'unknown_error',
    });
    expect(describeResearchFailure(new DOMException('secret URL', 'TimeoutError'))).toEqual({
      reason: 'timeout',
    });
    expect(describeResearchFailure(new ProviderRequestError('openai', 429))).toEqual({
      provider: 'openai',
      statusCode: 429,
      reason: 'http_error',
    });
  });
});
