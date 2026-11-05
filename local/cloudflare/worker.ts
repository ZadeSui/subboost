// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore OpenNext generates this module during build, so it may be absent.
import handler from "../.open-next/worker.js";
import { runScheduledJobs } from "./scheduled";

const worker = {
  fetch: handler.fetch,
  scheduled: runScheduledJobs,
};

export default worker;
