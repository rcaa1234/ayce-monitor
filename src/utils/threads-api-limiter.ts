/**
 * Threads API Rate Limiter
 * Implements exponential backoff and rate limit tracking
 */

import logger from './logger';

export interface RateLimitConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  requestsPerWindow: number;
  windowMs: number;
}

class ThreadsAPILimiter {
  private config: RateLimitConfig;
  private requestTimestamps: number[] = [];
  private retryCount: Map<string, number> = new Map();

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = {
      maxRetries: config?.maxRetries ?? 3,
      initialDelayMs: config?.initialDelayMs ?? 1000, // 1 second
      maxDelayMs: config?.maxDelayMs ?? 16000, // 16 seconds (1s → 2s → 4s → 8s → 16s)
      requestsPerWindow: config?.requestsPerWindow ?? 200, // Threads API limit (approximate)
      windowMs: config?.windowMs ?? 3600000, // 1 hour
    };
  }

  /**
   * Calculate delay for exponential backoff
   * Returns: initialDelay * (2 ^ attemptNumber)
   * Example: 1s → 2s → 4s → 8s → 16s
   */
  private calculateBackoffDelay(attemptNumber: number): number {
    const delay = this.config.initialDelayMs * Math.pow(2, attemptNumber);
    return Math.min(delay, this.config.maxDelayMs);
  }

  /**
   * Wait for specified milliseconds
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Clean up old request timestamps outside the rate limit window
   */
  private cleanOldTimestamps(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    this.requestTimestamps = this.requestTimestamps.filter((ts) => ts > windowStart);
  }

  /**
   * Check if we're approaching rate limit
   */
  private isApproachingRateLimit(): boolean {
    this.cleanOldTimestamps();
    const remaining = this.config.requestsPerWindow - this.requestTimestamps.length;
    const threshold = this.config.requestsPerWindow * 0.1; // 10% threshold

    if (remaining < threshold) {
      logger.warn(
        `Approaching Threads API rate limit: ${remaining}/${this.config.requestsPerWindow} requests remaining`
      );
      return true;
    }

    return false;
  }

  /**
   * Check if we've exceeded rate limit
   */
  private hasExceededRateLimit(): boolean {
    this.cleanOldTimestamps();
    return this.requestTimestamps.length >= this.config.requestsPerWindow;
  }

  /**
   * Calculate time until rate limit window resets
   */
  private getTimeUntilReset(): number {
    if (this.requestTimestamps.length === 0) {
      return 0;
    }

    const oldestTimestamp = Math.min(...this.requestTimestamps);
    const windowEnd = oldestTimestamp + this.config.windowMs;
    const now = Date.now();

    return Math.max(0, windowEnd - now);
  }

  /**
   * Wait if necessary before making request
   */
  private async waitIfNeeded(): Promise<void> {
    // Check if we've exceeded rate limit
    if (this.hasExceededRateLimit()) {
      const waitTime = this.getTimeUntilReset();
      logger.warn(
        `Rate limit exceeded. Waiting ${Math.ceil(waitTime / 1000)}s until window resets...`
      );
      await this.sleep(waitTime + 1000); // Add 1s buffer
      this.cleanOldTimestamps();
    }

    // Add small delay if approaching rate limit
    if (this.isApproachingRateLimit()) {
      await this.sleep(500); // 500ms cooldown
    }
  }

  /**
   * Record a successful API request
   */
  private recordRequest(): void {
    this.requestTimestamps.push(Date.now());
    this.cleanOldTimestamps();
  }

  /**
   * Execute an API call with rate limiting and exponential backoff retry
   */
  async execute<T>(
    apiCall: () => Promise<T>,
    requestId?: string
  ): Promise<T> {
    const callId = requestId || `request-${Date.now()}`;
    const currentRetries = this.retryCount.get(callId) || 0;

    try {
      // Wait if we're at or near rate limit
      await this.waitIfNeeded();

      // Execute the API call
      const result = await apiCall();

      // Record successful request
      this.recordRequest();
      this.retryCount.delete(callId);

      return result;

    } catch (error: any) {
      // Check if it's a rate limit error (429)
      const is429Error =
        error.response?.status === 429 ||
        error.code === 'RATE_LIMIT_EXCEEDED' ||
        error.message?.includes('rate limit');

      if (is429Error) {
        logger.warn(`Received 429 Rate Limit error for ${callId}`);

        // Check if we can retry
        if (currentRetries >= this.config.maxRetries) {
          logger.error(
            `Max retries (${this.config.maxRetries}) exceeded for ${callId}`
          );
          throw new Error(
            `Rate limit exceeded and max retries reached: ${error.message}`
          );
        }

        // Calculate backoff delay
        const delay = this.calculateBackoffDelay(currentRetries);
        logger.info(
          `Retrying ${callId} in ${delay}ms (attempt ${currentRetries + 1}/${this.config.maxRetries})`
        );

        // Wait and retry
        await this.sleep(delay);
        this.retryCount.set(callId, currentRetries + 1);

        return this.execute(apiCall, callId);
      }

      // For non-429 errors, throw immediately
      throw error;
    }
  }

  /**
   * Get current rate limit status
   */
  getStatus() {
    this.cleanOldTimestamps();

    return {
      requestsInWindow: this.requestTimestamps.length,
      remainingRequests: this.config.requestsPerWindow - this.requestTimestamps.length,
      resetInMs: this.getTimeUntilReset(),
      isLimited: this.hasExceededRateLimit(),
    };
  }

  /**
   * Reset all tracking data (useful for testing)
   */
  reset(): void {
    this.requestTimestamps = [];
    this.retryCount.clear();
  }
}

// Export singleton instance
export const threadsAPILimiter = new ThreadsAPILimiter();

// Export class for custom instances
export default ThreadsAPILimiter;
