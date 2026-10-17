export const LogEvent = {
  WORKER_READY: 'worker_ready',
  WORKFLOW_QUEUED: 'workflow_queued',
  WORKFLOW_STARTED: 'workflow_started',
  WORKFLOW_SUCCEEDED: 'workflow_succeeded',
  WORKFLOW_FAILED: 'workflow_failed',
  WORKER_TICK_FAILED: 'worker_tick_failed',
  RESEARCH_STARTED: 'research_started',
  RESEARCH_COMPLETED: 'research_completed',
  RESEARCH_FAILED: 'research_failed',
  RESEARCH_UNAVAILABLE: 'research_unavailable',
  PROVIDER_REQUEST_STARTED: 'provider_request_started',
  PROVIDER_REQUEST_COMPLETED: 'provider_request_completed',
  SEARCH_RESULTS_RECEIVED: 'search_results_received',
  SOURCE_ACCEPTED: 'source_accepted',
  SOURCE_REJECTED: 'source_rejected',
  INVESTOR_CHECK_SAVED: 'investor_check_saved',
  DISCOVERY_SAVED: 'discovery_saved',
  DISCOVERY_SKIPPED: 'discovery_skipped',
} as const;

export const LogReason = {
  CONFIGURATION_MISSING: 'configuration_missing',
  NO_TEXT: 'no_text',
  EMPTY_COMPLETION: 'empty_completion',
  IDENTITY_MISMATCH: 'identity_mismatch',
  QUOTE_NOT_FOUND: 'quote_not_found',
  COMPARABLE_EVIDENCE_MISSING: 'comparable_evidence_missing',
  NON_HTTPS: 'non_https',
  HTTP_ERROR: 'http_error',
  INVALID_RESPONSE: 'invalid_response',
  TIMEOUT: 'timeout',
  NETWORK_ERROR: 'network_error',
  STALE_CONTEXT: 'stale_context',
  UNKNOWN: 'unknown_error',
  FULL_TRAY: 'suggestions_full',
} as const;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** Deliberately excludes prompts, URLs, source bodies, credentials and financial records. */
export interface LogFields {
  jobId?: string;
  jobKind?: string;
  attempt?: number;
  mode?: 'demo' | 'live';
  provider?: 'exa' | 'openai';
  sourceIndex?: number;
  count?: number;
  addedCount?: number;
  changedCount?: number;
  durationMs?: number;
  statusCode?: number;
  reason?: (typeof LogReason)[keyof typeof LogReason];
}

export interface WorkflowLog {
  write(
    event: (typeof LogEvent)[keyof typeof LogEvent],
    fields?: LogFields,
    level?: LogLevel,
  ): void;
  run<T>(fields: LogFields, operation: () => Promise<T>): Promise<T>;
}

export const silentWorkflowLog: WorkflowLog = {
  write: () => undefined,
  run: (_fields, operation) => operation(),
};
