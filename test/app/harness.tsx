import { testRender } from "@opentui/react/test-utils";
import { createMockKeys, type KeyInput } from "@opentui/core/testing";
import type { OrchestrationV2ShellSnapshot, OrchestrationV2ThreadProjection, ThreadId } from "@t3tools/contracts";

import type { T3Session } from "../../src/client/session.ts";
import { DEFAULT_CONFIG, type Tui3Config } from "../../src/config.ts";
import { App } from "../../src/ui/App.tsx";
import { v2Projection, v2ShellSnapshot, v2ThreadId } from "../../vendor/t3code/packages/client-runtime/src/state/orchestrationV2TestFixtures.ts";

export { v2Projection, v2ShellSnapshot, v2ThreadId };

// Updates from the app's own timers land outside act(); the warnings say nothing useful here.
const consoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) return;
  consoleError(...args);
};

export interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

/**
 * A session that serves fixed state and records every other call. Watchers get one live
 * value straight away; anything not listed resolves to undefined.
 */
export function fakeSession(state: { readonly snapshot?: OrchestrationV2ShellSnapshot; readonly projection?: OrchestrationV2ThreadProjection; readonly results?: Record<string, unknown> } = {}) {
  const calls: Call[] = [];
  const snapshot = state.snapshot ?? v2ShellSnapshot;
  const projection = state.projection ?? v2Projection;
  const live = <T,>(value: T) => (listener: (value: T) => void) => {
    listener(value);
    return () => {};
  };
  const known: Record<string, unknown> = {
    getShell: () => ({ status: { type: "live" }, snapshot, serverUrl: "ws://test" }),
    onShell: () => () => {},
    watchThread: (_id: ThreadId, listener: (value: unknown) => void) => live({ status: "live", projection, history: { cursor: null, hasMore: false, loading: false } })(listener),
    watchServerConfig: live({ status: "loading", config: null }),
    watchServers: live({ status: "live", items: [] }),
    watchAutomations: live({ status: "live", items: [] }),
    watchTerminals: live({ status: "live", items: [] }),
    watchVcs: (_cwd: string, listener: (value: unknown) => void) => live({ status: "loading", local: null, remote: null })(listener),
  };
  const session = new Proxy(known, {
    get(target, name) {
      if (typeof name !== "string") return undefined;
      if (name in target) return target[name];
      if (name === "then") return undefined;
      return (...args: unknown[]) => {
        calls.push({ method: name, args });
        if (name.startsWith("watch") || name.startsWith("on")) return () => {};
        return Promise.resolve(state.results?.[name]);
      };
    },
  }) as unknown as T3Session;
  return { session, calls };
}

/** Renders the whole app against a fake session, with helpers to drive it by key and mouse. */
export async function renderApp(options: { readonly session?: ReturnType<typeof fakeSession>; readonly config?: Partial<Tui3Config>; readonly width?: number; readonly height?: number } = {}) {
  const fake = options.session ?? fakeSession();
  const config = { ...DEFAULT_CONFIG, ...options.config };
  const rig = await testRender(<App session={fake.session} config={config} />, { width: options.width ?? 140, height: options.height ?? 40 });
  // The app runs on timers and subscriptions, as it does live: tests wait for frames rather than wrap each update in act().
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  const keys = createMockKeys(rig.renderer);
  /** Lets effects, timers and React updates land, then draws a frame. */
  const settle = async (ms = 20) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await rig.renderOnce();
  };
  await settle(150);
  const named: Record<string, KeyInput> = { escape: "ESCAPE", return: "RETURN", tab: "TAB", up: "ARROW_UP", down: "ARROW_DOWN", left: "ARROW_LEFT", right: "ARROW_RIGHT", backspace: "BACKSPACE" };
  /** Presses a key by its OpenTUI name: "j", "Y", "escape", "return". */
  const press = async (key: string, modifiers?: Parameters<typeof keys.pressKey>[1]) => {
    keys.pressKey(named[key] ?? key, modifiers);
    // A lone esc waits 20ms in case it starts a longer sequence.
    await settle(key === "escape" ? 60 : 20);
  };
  const type = async (text: string) => {
    await keys.typeText(text);
    await settle();
  };
  const click = async (x: number, y: number, button: 0 | 2 = 0) => {
    await rig.mockMouse.click(x, y, button);
    await settle();
  };
  const frame = () => rig.captureCharFrame();
  /** The line the hint bar is on: the last one on screen. */
  const hints = () => frame().trimEnd().split("\n").at(-1)?.trim() ?? "";
  /** Where some text first appears on screen, for clicking it. */
  const find = (text: string) => {
    const lines = frame().split("\n");
    for (let y = 0; y < lines.length; y++) {
      const x = lines[y]!.indexOf(text);
      if (x >= 0) return { x, y };
    }
    throw new Error(`"${text}" is not on screen:\n${frame()}`);
  };
  const calls = (method: string) => fake.calls.filter((call) => call.method === method);
  const destroy = () => rig.renderer.destroy();
  return { ...rig, session: fake.session, press, type, click, settle, frame, hints, find, calls, destroy };
}
