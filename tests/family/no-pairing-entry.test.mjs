// The parent sign-in / registration screens no longer offer device pairing. /learn/join/ stays for child devices.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("neither parent registration nor login links to /learn/join/ or offers pairing", () => {
	for (const f of ["components/Family/ParentAuth.js", "pages/auth.js", "components/Authentication/LoginForm.js", "components/Authentication/RegisterForm.js"]) {
		const t = src(f);
		assert.doesNotMatch(t, /learn\/join/, `${f} must not link to /learn/join/`);
		assert.doesNotMatch(t, /Pair it with a code/i, f);
		assert.doesNotMatch(t, /pair (their|the)\b/i, f);
	}
	assert.doesNotMatch(src("components/Family/ParentAuth.js"), /ChildDeviceBanner|fm-banner/);
});

test("parent registration and login still land on /family/ (Progress), never on pairing", () => {
	assert.match(src("components/Authentication/RegisterForm.js"), /asParent \? "\/family\/"/);
	assert.match(src("components/Authentication/LoginForm.js"), /asParent \? "\/family\/"/);
});

test("linking a child with a parent-link code still goes straight to /family/", () => {
	assert.match(src("components/Family/Setup.js"), /onLinked=\{async \(\) => \{ setLinking\(false\); router\.push\(PARENT_HOME\)/);
	assert.match(src("lib/family/parentMode.js"), /PARENT_HOME = "\/family\/"/);
});

test("the child-device pairing page and its callers are retained", () => {
	assert.ok(existsSync(new URL("../../pages/learn/join.js", import.meta.url)));
	assert.match(src("pages/learn/index.js"), /\/learn\/join\//);
	assert.match(src("pages/learn/pin.js"), /\/learn\/join\//);
	assert.ok(existsSync(new URL("../../pages/api/family/device/join.js", import.meta.url)));
});
