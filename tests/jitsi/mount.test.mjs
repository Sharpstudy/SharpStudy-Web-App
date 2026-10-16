import test from "node:test";
import assert from "node:assert/strict";
import { mountJitsi, waitForJitsiApi } from "../../lib/jitsi/mount.js";

// Minimal DOM-ish container and a fake JitsiMeetExternalAPI that, like the real one,
// appends an <iframe> to parentNode and removes it on dispose().
function fakeEnv() {
	const container = {
		children: [],
		get firstChild() {
			return this.children[0] || null;
		},
		removeChild(c) {
			this.children = this.children.filter((x) => x !== c);
		},
		appendChild(c) {
			this.children.push(c);
		},
	};
	const log = { created: [], disposed: 0, commands: [] };
	class FakeJitsi {
		constructor(domain, opts) {
			this.opts = opts;
			this.listeners = {};
			this.iframe = { tag: "iframe", room: opts.roomName, domain };
			opts.parentNode.appendChild(this.iframe);
			log.created.push(this);
		}
		addEventListener(name, fn) {
			this.listeners[name] = fn;
		}
		executeCommand(...a) {
			log.commands.push(a);
		}
		dispose() {
			log.disposed++;
			this.opts.parentNode.removeChild(this.iframe);
		}
	}
	return { container, log, FakeJitsi };
}
const base = (e) => ({ container: e.container, JitsiAPI: e.FakeJitsi, roomName: "course-slug", displayName: "Ann" });

test("one mount creates exactly one meeting with the same room and domain", () => {
	const e = fakeEnv();
	mountJitsi(base(e));
	assert.equal(e.container.children.length, 1);
	assert.deepEqual([e.log.created[0].iframe.room, e.log.created[0].iframe.domain], ["course-slug", "meet.jit.si"]);
});

test("React StrictMode (mount, cleanup, mount) leaves exactly one meeting", () => {
	const e = fakeEnv();
	const dispose1 = mountJitsi(base(e)); // first effect run
	dispose1(); // StrictMode cleanup
	const dispose2 = mountJitsi(base(e)); // second effect run
	assert.equal(e.container.children.length, 1);
	assert.equal(e.log.created.length, 2);
	assert.equal(e.log.disposed, 1);
	dispose2();
	assert.equal(e.container.children.length, 0, "unmount removes the meeting");
	assert.equal(e.log.disposed, 2);
});

test("even without a cleanup, a container never ends up with two meetings", () => {
	const e = fakeEnv();
	mountJitsi(base(e));
	mountJitsi(base(e));
	assert.equal(e.container.children.length, 1);
});

test("dispose is idempotent and leaves the container empty", () => {
	const e = fakeEnv();
	const d = mountJitsi(base(e));
	d();
	d();
	assert.equal(e.log.disposed, 1);
	assert.equal(e.container.children.length, 0);
});

test("display name is applied when the conference is joined; meeting end is forwarded", () => {
	const e = fakeEnv();
	let ended = 0;
	mountJitsi({ ...base(e), onMeetingEnd: () => ended++ });
	const client = e.log.created[0];
	client.listeners.videoConferenceJoined();
	assert.deepEqual(e.log.commands, [["displayName", "Ann"]]);
	client.listeners.readyToClose();
	assert.equal(ended, 1);
});

test("waitForJitsiApi resolves when the API exists, injects the script once, and times out", async () => {
	const scripts = [];
	const doc = {
		head: { appendChild: (s) => scripts.push(s) },
		querySelector: (sel) => scripts.find((s) => sel.includes(s.src)) || null,
		createElement: () => ({}),
	};
	const win = { document: doc };
	const API = function () {};
	setTimeout(() => (win.JitsiMeetExternalAPI = API), 60);
	assert.equal(await waitForJitsiApi({ win, intervalMs: 10, timeoutMs: 1000 }), API);
	assert.equal(scripts.length, 1, "script injected once, not per poll");

	const win2 = { document: { head: { appendChild() {} }, querySelector: () => ({}), createElement: () => ({}) } };
	await assert.rejects(waitForJitsiApi({ win: win2, intervalMs: 5, timeoutMs: 40 }), /could not be loaded/);
	const win3 = { JitsiMeetExternalAPI: API, document: doc };
	assert.equal(await waitForJitsiApi({ win: win3 }), API);
});
