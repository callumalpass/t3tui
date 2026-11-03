import { expect, test } from "bun:test";

import { isWindowsAbsolute, tildify } from "../src/model/paths.ts";

test("shortens the home folder, on either kind of slash", () => {
  expect(tildify("/home/me/projects", "/home/me")).toBe("~/projects");
  expect(tildify("/home/me", "/home/me")).toBe("~");
  expect(tildify("/home/mean/projects", "/home/me")).toBe("/home/mean/projects");
  expect(tildify("C:\\Users\\me\\projects", "C:\\Users\\me")).toBe("~\\projects");
  expect(tildify("C:\\Users\\mean", "C:\\Users\\me")).toBe("C:\\Users\\mean");
});

test("knows a Windows absolute path", () => {
  expect(isWindowsAbsolute("C:\\a.png")).toBe(true);
  expect(isWindowsAbsolute("c:/a.png")).toBe(true);
  expect(isWindowsAbsolute("\\\\server\\share\\a.png")).toBe(true);
  expect(isWindowsAbsolute("/a.png")).toBe(false);
  expect(isWindowsAbsolute("a.png")).toBe(false);
});
