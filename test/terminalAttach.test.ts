import { describe, expect, test } from "bun:test";

import { keepConptyWrap } from "../src/ui/terminalAttach.ts";

describe("keepConptyWrap", () => {
  test("drops the erase between a full row and the next one's text", () => {
    expect(keepConptyWrap("~     \x1b[K~     \x1b[K~")).toBe("~     ~     ~");
  });

  test("sees past styling and cursor visibility", () => {
    expect(keepConptyWrap("~  \x1b[K\x1b[m\x1b[1m\x1b[7mstatus")).toBe("~  \x1b[m\x1b[1m\x1b[7mstatus");
    expect(keepConptyWrap("~  \x1b[K\x1b[?25l~")).toBe("~  \x1b[?25l~");
  });

  test("keeps an erase that ends a row", () => {
    for (const data of ["short\x1b[K", "short\x1b[K\r\nnext", "short\x1b[K\x1b[3;1Hnext", "short\x1b[K\x1b[?25l\x1b[14C"]) expect(keepConptyWrap(data)).toBe(data);
  });

  test("leaves other erases alone", () => {
    expect(keepConptyWrap("a\x1b[2Kb\x1b[1Kc")).toBe("a\x1b[2Kb\x1b[1Kc");
  });
});
