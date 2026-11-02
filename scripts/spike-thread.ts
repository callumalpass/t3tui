import { T3Session } from "../src/client/session.ts";
const s = new T3Session();
await s.start();
await new Promise<void>((r) => { const off = s.onShell((st) => { if (st.status.type !== "connecting" && st.snapshot) { off(); r(); } }); });
const shell = s.getShell();
console.log("status", shell.status, "threads", shell.snapshot?.threads.length);
const counts: Record<string, number> = {};
for (const t of shell.snapshot!.threads) counts[t.status] = (counts[t.status] ?? 0) + 1;
console.log(counts);
const t = shell.snapshot!.threads.find((t) => t.status === "running") ?? shell.snapshot!.threads[0]!;
console.log("watching", t.title, t.status);
let events = 0;
const off = s.watchThread(t.id, (st) => {
  events++;
  if (st.projection && events < 4) {
    const items = st.projection.visibleTurnItems;
    console.log(st.status, "items", items.length, "types", [...new Set(items.map((i) => i.item.type))].join(","));
    const last = items.at(-1)?.item as any;
    console.log("last:", last?.type, String(last?.text ?? last?.input ?? "").slice(0, 120));
  }
  if (st.error) console.log("ERR", st.error);
});
await Bun.sleep(5000);
console.log("updates received", events);
off(); await s.stop(); process.exit(0);
