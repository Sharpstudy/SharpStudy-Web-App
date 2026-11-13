import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeNextPath } from "../../lib/books/redirect.js";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("the post-confirmation destination is same-site only", () => {
	assert.equal(safeNextPath("/become-an-instructor/"), "/become-an-instructor/");
	for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "/a\nb", "", null, undefined, 5]) {
		assert.equal(safeNextPath(bad), null, String(bad));
	}
});

test("signup and resend pass `next` on, the e-mail link validates it, and the confirmation page re-validates it", () => {
	assert.match(read("pages/api/users/signup.js"), /confirmEmailAddress\(newUser, next\)/);
	assert.match(read("pages/api/users/send-confirmation-email.js"), /confirmEmailAddress\(user, next\)/);
	const tpl = read("email-templates/account-confirmation.js");
	assert.match(tpl, /safeNextPath\(next\)/);
	assert.match(tpl, /encodeURIComponent\(safeNext\)/);
	assert.match(read("pages/confirm-email.js"), /safeNextPath\(router\.query\.next\) \|\| "\/"/);
});

test("signup never reads a role or status from the request", () => {
	const src = read("pages/api/users/signup.js");
	assert.doesNotMatch(src, /req\.body\.(role|status|email_confirmed)/);
	assert.match(src, /let \{ first_name, last_name, email, password, next \} = req\.body \|\| \{\}/);
});
