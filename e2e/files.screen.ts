import { expect, test } from "@playwright/test";
import { mockApi, session } from "./mock";

test("the Path box shows an instruction, not a path that reads like the current folder", async ({ page }) => {
  await mockApi(page, {
    "/api/session": session,
    "/api/files": { path: "/", entries: [{ id: "1", kind: "folder", name: "Customer POs", path: "/Customer POs" }] },
  });
  await page.goto("/#/files");
  const path = page.getByRole("textbox", { name: "Path", exact: true });
  await expect(path).toHaveValue("");
  await expect(path).toHaveAttribute("placeholder", "Type a folder or file path");
});
