import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("/family/ tells staff, child accounts and parents apart, in that order", () => {
	const page = src("pages/family/index.js");
	const staff = page.indexOf('user.role === "instructor" || user.role === "admin"');
	const child = page.indexOf("user.is_learner_account");
	const parent = page.indexOf("<ParentDashboard />", page.indexOf("const FamilyPage"));
	assert.ok(staff > 0 && child > staff && parent > child, "staff, then student, then parent");
	assert.match(page, /<StudentFamily user=\{user\} \/>/);
});

test("the child-account flag is computed on the server from the learner link, never read from the request", () => {
	const api = src("pages/api/users/update.js");
	assert.match(api, /is_learner_account = studentLinks > 0/);
	assert.match(api, /ML_Learner\.count\(\{ where: \{ student_user_id: userId \} \}\)/);
	const put = api.slice(api.indexOf("const userUpdate"));
	assert.doesNotMatch(put, /is_learner_account|is_parent/, "no profile update can set either flag");
});

test("the student Family page shows only the child's own link UI: no parent dashboard, no progress data", () => {
	const page = src("components/Family/StudentFamily.js");
	assert.match(page, /<ParentLinkCode \/>/);
	assert.doesNotMatch(page, /ParentDashboard|overview|\/api\/mastery|LinkChild/);
	const c = src("components/Family/ParentLinkCode.js");
	assert.match(c, /Linked parents/);
	assert.match(c, /No parent or guardian is linked yet/);
	assert.match(c, /72 hours/);
});

test("the Mastery Ladder no longer offers any parent-link UI, and the APIs are untouched", () => {
	const study = src("pages/study/index.js");
	assert.doesNotMatch(study, /ParentLinkCode|Link my parent|Show parent link code/);
	for (const f of ["components/Mastery/MasteryShell.js", "components/Mastery/TutorPanel.js"]) {
		assert.doesNotMatch(src(f), /ParentLinkCode|Link my parent|parent link code/i, f);
	}
	assert.match(src("pages/api/family/link/code.js"), /issueLinkCodeForChild/);
	assert.match(src("pages/api/family/link/index.js"), /redeemParentLink|link/i);
});

test("parent-only accounts and the parent page gate are unchanged", () => {
	const mode = src("lib/family/parentMode.js");
	assert.match(mode, /f\.studentLinks === 0/, "a child account is never parent-only");
	assert.match(src("lib/auth/pageAccess.js"), /parentMayOpen\(p\) \? null : PARENT_HOME/);
});
