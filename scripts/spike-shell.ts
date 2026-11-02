import { ORCHESTRATION_V2_WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { connect } from "../src/client/rpc.ts";

const program = Effect.gen(function* () {
  const { rpc, target } = yield* connect;
  console.log("connected to", target.httpBaseUrl);
  yield* rpc[ORCHESTRATION_V2_WS_METHODS.subscribeShell]({ omitIdleSubagents: true, omitOlderSettled: true }).pipe(
    Stream.take(3),
    Stream.runForEach((item) =>
      Effect.sync(() => {
        if (item.kind === "snapshot") {
          const s = item.snapshot as any;
          console.log("snapshot keys:", Object.keys(s));
          console.log("projects:", s.projects?.length, "threads:", s.threads?.length);
          for (const t of (s.threads ?? []).slice(0, 8)) console.log(" -", t.status, t.activityRunStatus, t.pendingRuntimeRequest ? "[NEEDS YOU]" : "", t.title);
        } else console.log("item:", item.kind);
      }),
    ),
    Effect.timeout("10 seconds"),
  );
});
await Effect.runPromise(Effect.scoped(program)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
process.exit(0);
