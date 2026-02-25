import test from "node:test";
import assert from "node:assert/strict";
import { chooseWorkspaceDirectory } from "./workspace";

test("chooseWorkspaceDirectory returns undefined without folders", () => {
  const result = chooseWorkspaceDirectory({ pick: "active", folders: [] });
  assert.equal(result, undefined);
});

test("chooseWorkspaceDirectory uses active folder", () => {
  const result = chooseWorkspaceDirectory({
    pick: "active",
    folders: ["/repo/a", "/repo/b"],
    active: "/repo/b",
  });
  assert.equal(result, "/repo/b");
});

test("chooseWorkspaceDirectory falls back to first when active missing", () => {
  const result = chooseWorkspaceDirectory({
    pick: "active",
    folders: ["/repo/a", "/repo/b"],
    active: "/repo/c",
  });
  assert.equal(result, "/repo/a");
});

test("chooseWorkspaceDirectory uses first for first mode", () => {
  const result = chooseWorkspaceDirectory({
    pick: "first",
    folders: ["/repo/a", "/repo/b"],
    active: "/repo/b",
  });
  assert.equal(result, "/repo/a");
});
