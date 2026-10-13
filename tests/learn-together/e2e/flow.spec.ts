// End-to-end with two browser contexts: a parent (phone) and a child device (iPad).
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "fs";
import path from "path";

const SNACK = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../content/learn-together/snack-budget.json"), "utf8"));
const latencies: { kind: string; ms: number }[] = [];

let parentCtx: BrowserContext;
let childCtx: BrowserContext;
let parent: Page;
let child: Page;

async function login(page: Page, email: string) {
  await page.goto("/auth/");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await page.getByRole("button", { name: "Login Now" }).waitFor();
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "password123");
  await page.getByRole("button", { name: "Login Now" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 60_000 });
}

/**
 * Axe on the Learn Together part of the page (#main in the parent shell, #lt-kid on child screens).
 * The site's existing Navbar, Footer and progress bar are out of scope for this module.
 */
async function axe(page: Page, label: string) {
  await page.waitForTimeout(700); // let entrance animations finish so contrast is measured at rest
  if (process.env.LT_SCREENSHOTS) await page.screenshot({ path: path.resolve(__dirname, `../../../test-results/screens/${label.replace(/[^a-z0-9]+/gi, "-")}.png`), fullPage: true });
  const scope = (await page.locator("#lt-kid").count()) ? "#lt-kid" : "#main";
  const results = await new AxeBuilder({ page }).include(scope).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

async function timed<T>(kind: string, act: () => Promise<unknown>, until: () => Promise<T>) {
  const t0 = Date.now();
  await act();
  const r = await until();
  latencies.push({ kind, ms: Date.now() - t0 });
  return r;
}

async function childSees(text: string | RegExp) {
  await expect(child.getByRole("heading", { name: text }).first()).toBeVisible();
}

async function nextStep() {
  await parent.getByRole("button", { name: "Next →" }).click();
}

test.describe.serial("Learn Together", () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    parentCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    childCtx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
    parent = await parentCtx.newPage();
    child = await childCtx.newPage();
    parent.on("dialog", (d) => d.accept());
  });

  test.afterAll(async () => {
    const by = (k: string) => latencies.filter((l) => l.kind === k).map((l) => l.ms).sort((a, b) => a - b);
    const pct = (xs: number[], p: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)] : null);
    const summary = ["launch", "step"].map((k) => ({ kind: k, n: by(k).length, p50: pct(by(k), 50), p95: pct(by(k), 95) }));
    fs.writeFileSync(path.resolve(__dirname, "../../../test-results/lt-latency.json"), JSON.stringify({ summary, samples: latencies }, null, 2));
    console.log("[latency]", JSON.stringify(summary));
    await parentCtx.close();
    await childCtx.close();
  });

  test("parent onboarding: family, child, PIN", async () => {
    await login(parent, "parent@lt-e2e.test");
    await parent.goto("/learn/");
    await parent.waitForURL(/\/learn\/onboarding/);
    await axe(parent, "onboarding");
    await parent.getByRole("button", { name: "Let's set up" }).click();
    await parent.getByLabel("Nickname").fill("Maya");
    await parent.getByRole("button", { name: "Add child" }).click();
    await expect(parent.getByText("Maya", { exact: true })).toBeVisible();
    await parent.getByRole("button", { name: "Next: family PIN" }).click();
    await parent.getByLabel("Family PIN").fill("2468");
    await parent.getByLabel("Type it again").fill("2468");
    await parent.getByRole("button", { name: "Finish" }).click();
    await parent.waitForURL(/\/learn\/$/);
    await expect(parent.getByRole("heading", { name: /Learn together, Pat/ })).toBeVisible();
    await expect(parent.getByText("No device paired")).toBeVisible();
    await axe(parent, "home");
  });

  test("pair a child device by typed code with parent approval", async () => {
    await child.goto("/learn/kid/");
    await child.waitForURL(/\/learn\/join/); // unpaired device can't reach the lobby
    await axe(child, "join");

    await parent.goto("/learn/family/");
    await parent.getByRole("button", { name: "Pair a device" }).click();
    await parent.getByRole("button", { name: "Show pairing code" }).click();
    const code = (await parent.locator("[aria-label^='Code:']").innerText()).trim();
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    await axe(parent, "pairing dialog");

    await child.getByLabel("Pairing code").fill(code);
    await child.getByRole("button", { name: "Join" }).click();
    await expect(child.getByRole("heading", { name: "Ask your grown-up to approve." })).toBeVisible();
    // Unapproved: still no lobby.
    expect((await child.request.get("/api/learn/kid/me/")).status()).toBe(401);

    await expect(parent.getByRole("heading", { name: /A new device wants to join as Maya/ })).toBeVisible();
    await parent.getByLabel("Device name").fill("Maya's iPad");
    await parent.getByRole("button", { name: "Approve" }).click();

    await child.waitForURL(/\/learn\/kid\/$/);
    await childSees("Hi Maya!");
    await expect(child.getByText("Waiting for your grown-up to start")).toBeVisible();
    await axe(child, "child lobby");

    const cookies = await childCtx.cookies();
    const dev = cookies.find((c) => c.name === "lt_device")!;
    expect(dev.httpOnly).toBe(true);
    expect(dev.sameSite).toBe("Strict");
  });

  let groupUrl = "";

  test("connected lesson: launch opens on the child, steps sync, answers, help, check, reflect", async () => {
    await parent.goto("/learn/explore/");
    await axe(parent, "explore");
    await parent.getByRole("link", { name: "Preview" }).first().waitFor();
    await parent.goto("/learn/activity/snack-budget/");
    await expect(parent.getByRole("heading", { name: "Snack Budget Mission" })).toBeVisible();
    await axe(parent, "preview");
    await parent.getByRole("button", { name: "Start this activity" }).click();
    await expect(parent.getByText("Device online")).toBeVisible();

    await timed(
      "launch",
      () => parent.getByRole("button", { name: "Send to Maya's device" }).click(),
      () => child.waitForURL(/\/learn\/kid\/session\//, { timeout: 30_000 })
    );
    await parent.waitForURL(/\/learn\/session\//);
    groupUrl = parent.url();
    await childSees("Snack Budget Mission");
    await axe(child, "child follower (lobby)");

    await child.getByRole("button", { name: "I'm ready!" }).click();
    await expect(parent.getByText("Ready ✓")).toBeVisible();
    await axe(parent, "controller");
    await parent.getByRole("button", { name: "Start" }).click();

    await childSees(SNACK.scriptSteps[0].child.screen);
    // DOM-level: nothing parent-only on the child device.
    const html = await child.content();
    for (const st of SNACK.scriptSteps) {
      expect(html).not.toContain(st.parent.parentSays);
      if (st.parent.whyThisWorks) expect(html).not.toContain(st.parent.whyThisWorks);
    }
    for (const m of SNACK.misconceptions) expect(html).not.toContain(m.signal);
    await axe(child, "child follower (step)");

    for (const i of [1, 2]) await timed("step", nextStep, () => childSees(SNACK.scriptSteps[i].child.screen));

    // Child answers the number question on their device.
    await child.getByRole("button", { name: "9", exact: true }).click();
    await child.getByRole("button", { name: "Send" }).click();
    await expect(child.getByText("Nice thinking! Tell your grown-up your answer.")).toBeVisible();
    await expect(parent.getByRole("list", { name: "Answers on this step" })).toContainText("9 dollars");

    // Help signal reaches the parent and can be acknowledged.
    await child.getByRole("button", { name: /I need help/ }).click();
    await expect(child.getByRole("button", { name: /Your grown-up is coming/ })).toBeVisible();
    await expect(parent.getByRole("alert").filter({ hasText: "Maya needs help" })).toBeVisible();
    await parent.getByRole("button", { name: "Acknowledge" }).click();
    await expect(child.getByRole("button", { name: /I need help/ })).toBeVisible();

    // Watch-for: "I saw this".
    await parent.getByRole("button", { name: "I saw this" }).first().click();
    await expect(parent.getByRole("button", { name: "Noted" }).first()).toBeVisible();

    for (const i of [3, 4, 5]) await timed("step", nextStep, () => childSees(SNACK.scriptSteps[i].child.screen));

    // Check step: both questions appear on the child device.
    await childSees(SNACK.checkQuestions[0].child.screen);
    const transfer = child.locator("section", { has: child.getByRole("heading", { name: SNACK.checkQuestions[1].child.screen }) });
    await transfer.getByRole("button", { name: "6", exact: true }).click();
    await transfer.getByRole("button", { name: "Send" }).click();
    await expect(parent.getByText("answered: 6 dollars")).toBeVisible();
    await parent.getByRole("group", { name: "Maya: near question" }).getByRole("button", { name: "Clear" }).click();
    await parent.getByRole("group", { name: "Maya: transfer question" }).getByRole("button", { name: "Clear" }).click();

    await timed("step", nextStep, () => childSees(SNACK.scriptSteps[6].child.screen));
    await parent.getByRole("group", { name: "Outcome" }).getByRole("button", { name: "Understood" }).click();
    await parent.getByRole("button", { name: "4 of 5" }).click();
    await parent.getByRole("button", { name: "Save reflection" }).click();
    await expect(parent.getByText("Saved ✓")).toBeVisible();
    await parent.getByRole("button", { name: "Finish" }).click();

    await childSees(/You explored Money/);
    await expect(parent.getByRole("heading", { name: "Nice work together!" })).toBeVisible();
    await expect(parent.getByText("Next:").first()).toBeVisible();

    await child.getByRole("button", { name: "OK" }).click();
    await child.waitForURL(/\/learn\/kid\/$/);
    await expect(child.getByRole("list").filter({ hasText: "Money" })).toBeVisible();

    await parent.getByRole("link", { name: /See Maya's progress/ }).click();
    await expect(parent.getByRole("heading", { name: "Maya's learning" })).toBeVisible();
    await expect(parent.getByText("Introduced").first()).toBeVisible();
    await expect(parent.getByText("tried 9", { exact: false }).or(parent.getByText("answered 9", { exact: false })).first()).toBeVisible();
    await axe(parent, "progress");
  });

  test("reconnect recovery: a dropped child device resyncs to the right step", async () => {
    await parent.goto("/learn/activity/snack-budget/");
    await parent.getByRole("button", { name: "Start this activity" }).click();
    await parent.getByRole("button", { name: "Send to Maya's device" }).click();
    await child.waitForURL(/\/learn\/kid\/session\//, { timeout: 30_000 });
    await child.getByRole("button", { name: "I'm ready!" }).click();
    await parent.getByRole("button", { name: "Start" }).click();
    await childSees(SNACK.scriptSteps[0].child.screen);

    await childCtx.setOffline(true);
    await nextStep();
    await nextStep();
    await nextStep();
    await child.waitForTimeout(2500);
    await childCtx.setOffline(false);
    await childSees(SNACK.scriptSteps[3].child.screen);
    await parent.getByRole("button", { name: "End" }).click();
    await childSees(/You explored/);
  });

  test("single-device fallback and multi-child launch", async () => {
    await parent.goto("/learn/family/");
    await parent.getByRole("button", { name: "Add a child" }).click();
    await parent.getByLabel("Nickname").fill("Leo");
    await parent.getByRole("button", { name: "Add child" }).click();
    await expect(parent.getByText("Leo", { exact: true })).toBeVisible();

    await parent.goto("/learn/activity/paper-shape-coin-lab/");
    await expect(parent.getByRole("heading", { name: "Safety" })).toBeVisible();
    await parent.getByRole("button", { name: "Start this activity" }).click();
    await parent.getByRole("checkbox").nth(0).check();
    await parent.getByRole("checkbox").nth(1).check();
    await expect(parent.getByRole("button", { name: /Send to/ })).toBeDisabled(); // Leo has no device
    await parent.getByRole("button", { name: "Use this device" }).click();
    await parent.waitForURL(/\/learn\/session\//);

    const childView = parent.getByRole("region", { name: "Child view on this device" });
    await expect(childView).toBeVisible();
    await childView.getByRole("button", { name: /Maya: I'm ready!/ }).click();
    await childView.getByRole("button", { name: /Leo: I'm ready!/ }).click();
    await parent.getByRole("button", { name: "Start" }).click();
    await nextStep();
    await expect(childView.getByRole("heading", { name: "Who's answering?" })).toBeVisible();
    await childView.getByRole("button", { name: "Leo" }).click();
    await childView.getByRole("button", { name: "Tube" }).click();
    await expect(parent.getByRole("region", { name: "Leo" }).getByRole("list", { name: "Answers on this step" })).toContainText("Tube");

    // Child mode on the parent's device needs the family PIN to exit.
    await childView.getByRole("button", { name: "Hand device to child" }).click();
    await parent.getByRole("button", { name: /Grown-up/ }).click();
    for (const d of "2468") await parent.getByRole("button", { name: d, exact: true }).click();
    await parent.getByRole("button", { name: "Enter PIN" }).click();
    await expect(parent.getByRole("button", { name: "Next →" })).toBeVisible();
    await parent.getByRole("button", { name: "End" }).click();
  });

  test("admin pages are role-gated and accessible", async ({ browser }) => {
    const res = await parent.request.get("/learn/admin/");
    expect(res.status()).toBe(404);
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    await login(admin, "admin@lt-e2e.test");
    await admin.goto("/learn/admin/");
    await expect(admin.getByRole("heading", { name: "Activities" })).toBeVisible();
    await axe(admin, "admin list");
    await admin.getByRole("link", { name: "Shape Hunt at Home" }).click();
    await expect(admin.getByText("Schema valid.")).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Child device preview" })).toBeVisible();
    await axe(admin, "admin editor");
    await admin.goto("/learn/admin/metrics/");
    await expect(admin.getByRole("heading", { name: "Product metrics" })).toBeVisible();
    await axe(admin, "admin metrics");
    await ctx.close();
  });

  test("revoking a device kicks it out", async () => {
    await parent.goto("/learn/family/");
    await parent.getByRole("button", { name: "Revoke" }).click();
    await expect(parent.getByText(/was revoked/)).toBeVisible();
    // The open lobby notices on its next poll, without any navigation by the child.
    await child.waitForURL(/\/learn\/join/, { timeout: 30_000 });
  });
});
