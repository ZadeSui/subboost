type CronEnvironment = {
  APP_URL?: string;
  CRON_SECRET?: string;
  WORKER_SELF_REFERENCE: { fetch(request: Request): Promise<Response> };
};

export async function runScheduledJobs(
  event: { cron: string },
  env: CronEnvironment,
): Promise<void> {
  if (!env.APP_URL || !env.CRON_SECRET) throw new Error("APP_URL and CRON_SECRET are required for cron");
  const path = event.cron === "3 * * * *"
    ? "/api/cron/update-rule-index"
    : "/api/cron/update-subscriptions";
  const response = await env.WORKER_SELF_REFERENCE.fetch(new Request(new URL(path, env.APP_URL), {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  }));
  // Consume the body so the self invocation completes before the cron ends.
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`Scheduled ${path} failed: HTTP ${response.status}`);
}
