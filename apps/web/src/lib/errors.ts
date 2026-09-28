/**
 * Error types shared by the mock service and the HTTP adapter, so UI code can branch on
 * `code` without caring which data mode is active.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  constructor(
    code: string,
    message: string,
    options: { status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = options.status ?? 400;
    this.retryable = options.retryable ?? false;
  }
}

/** A wizard step or submit was rejected because required fields are missing. */
export class ValidationError extends Error {
  readonly missing: string[];
  readonly step: number | undefined;
  constructor(missing: string[], step?: number) {
    super('Please complete the required fields.');
    this.name = 'ValidationError';
    this.missing = missing;
    this.step = step;
  }
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}
