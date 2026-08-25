export class WorkerMetrics {
  private readonly startedAt = new Date();
  private completedJobs = 0;
  private failedJobs = 0;
  private publishedOutboxEvents = 0;
  private deferredOutboxEvents = 0;
  private lastJobCompletedAt: Date | null = null;
  private lastOutboxPollAt: Date | null = null;

  recordJobCompleted() {
    this.completedJobs += 1;
    this.lastJobCompletedAt = new Date();
  }

  recordJobFailed() {
    this.failedJobs += 1;
  }

  recordOutboxPoll(published: number, deferred: number) {
    this.publishedOutboxEvents += published;
    this.deferredOutboxEvents += deferred;
    this.lastOutboxPollAt = new Date();
  }

  snapshot() {
    return {
      startedAt: this.startedAt.toISOString(),
      completedJobs: this.completedJobs,
      failedJobs: this.failedJobs,
      publishedOutboxEvents: this.publishedOutboxEvents,
      deferredOutboxEvents: this.deferredOutboxEvents,
      lastJobCompletedAt: this.lastJobCompletedAt?.toISOString() || null,
      lastOutboxPollAt: this.lastOutboxPollAt?.toISOString() || null,
    };
  }
}
