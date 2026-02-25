import { test, expect } from "../fixtures"
import { createTestProject, cleanupTestProject } from "../actions"
import { dirSlug, sessionPath } from "../utils"
import { projectSwitchSelector } from "../selectors"

test("right rail stays visible when file tree open on narrow width", async ({ page, gotoSession }) => {
  await gotoSession()
  await page.setViewportSize({ width: 900, height: 760 })

  const toggle = page.getByRole("button", { name: "Toggle file tree" }).first()
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()

  const rail = page.locator('[data-component="session-right-rail"]')
  await expect(rail).toBeVisible()
  await expect(rail).toHaveCSS("width", "30px")
})

test("vscode workspace bootstrap opens new session path", async ({ page, withProject }) => {
  await withProject(async ({ directory }) => {
    const slug = dirSlug(directory)
    await page.goto(`${sessionPath(directory)}?caller=vscode&layout=full&workspace=${encodeURIComponent(directory)}`)
    await expect(page).toHaveURL(new RegExp(`/${slug}/session(?:$|[?#])`))
  })
})

test("vscode workspace bootstrap moves project to top", async ({ page, withProject }) => {
  const other = await createTestProject()
  try {
    await withProject(
      async ({ directory }) => {
        await page.goto(sessionPath(directory))

        await page.goto(`${sessionPath(other)}?caller=vscode&layout=full&workspace=${encodeURIComponent(other)}`)

        const otherButton = page.locator(projectSwitchSelector(dirSlug(other))).first()
        await expect(otherButton).toBeVisible()

        const firstProject = page
          .locator('[data-component="sidebar-nav-desktop"] [data-action="project-switch"]')
          .first()
        await expect(firstProject).toHaveAttribute("data-project", dirSlug(other))
      },
      { extra: [other] },
    )
  } finally {
    await cleanupTestProject(other)
  }
})

test("right rail stays visible with review and file tree open on narrow width", async ({ page, gotoSession }) => {
  await gotoSession()
  await page.setViewportSize({ width: 900, height: 760 })

  const fileTree = page.getByRole("button", { name: "Toggle file tree" }).first()
  const review = page.getByRole("button", { name: "Toggle review" }).first()

  if ((await fileTree.getAttribute("aria-expanded")) !== "true") await fileTree.click()
  if ((await review.getAttribute("aria-expanded")) !== "true") await review.click()

  const rail = page.locator('[data-component="session-right-rail"]')
  await expect(rail).toBeVisible()
  await expect(rail).toHaveCSS("width", "30px")
})

test("titlebar path order and visibility threshold", async ({ page, withProject }) => {
  await withProject(async ({ directory }) => {
    await page.setViewportSize({ width: 1400, height: 800 })
    await page.goto(`${sessionPath(directory)}?layout=full`)

    const path = page.locator('[data-component="session-titlebar-path"]').first()
    await expect(path).toBeVisible()

    const expected = directory
      .split(/[\\/]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" › ")

    await expect(path).toHaveText(expected)

    await page.setViewportSize({ width: 340, height: 800 })
    await expect(path).toBeHidden()
  })
})
