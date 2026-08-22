export class DomainError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{retryable?: boolean, fieldErrors?: Record<string, string>}} [options]
   */
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.fieldErrors = options.fieldErrors;
  }
}

