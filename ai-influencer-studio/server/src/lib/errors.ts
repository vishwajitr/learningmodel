export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public setupInstructions?: string[],
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Thrown when a provider/model is not installed or reachable. Never silently faked. */
export class ProviderUnavailableError extends HttpError {
  constructor(message: string, setupInstructions: string[] = [], public providerId?: string) {
    super(503, message, 'PROVIDER_UNAVAILABLE', setupInstructions);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`, 'NOT_FOUND');
