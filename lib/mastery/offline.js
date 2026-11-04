// Offline support: the in-progress worksheet and a queue of finished
// attempts live in local storage until the server confirms them.
//
// Pure logic with an injected storage + transport so it can be unit-tested:
//   storage: { getJSON(key, fallback), setJSON(key, value), remove(key) }
//   send(item) -> Promise<result>; rejects with { status, code } on failure
//
// Sync is safe to repeat: every queued attempt carries a client-generated
// clientAttemptId and the server stores at most one attempt per id.

const QUEUE_KEY = "ss.ml.queue";
const progressKey = (learnerId) => `ss.ml.inprogress.${learnerId}`;

export const MAX_SYNC_TRIES = 8;

// Errors that will never succeed on retry: drop (but remember) the item.
const isPermanent = (err) => err && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 408 && err.status !== 429;

export function createOfflineStore(storage) {
	return {
		// ---- in-progress worksheet ----
		saveInProgress(learnerId, state) {
			storage.setJSON(progressKey(learnerId), { ...state, savedAt: Date.now() });
		},
		loadInProgress(learnerId) {
			return storage.getJSON(progressKey(learnerId), null);
		},
		clearInProgress(learnerId) {
			storage.remove(progressKey(learnerId));
		},

		// ---- completed-attempt queue ----
		queue() {
			return storage.getJSON(QUEUE_KEY, []);
		},
		enqueue(item) {
			const q = storage.getJSON(QUEUE_KEY, []);
			if (q.some((x) => x.clientAttemptId === item.clientAttemptId)) return q;
			q.push({ ...item, tries: 0, queuedAt: Date.now() });
			storage.setJSON(QUEUE_KEY, q);
			return q;
		},
		remove(clientAttemptId) {
			const q = storage.getJSON(QUEUE_KEY, []).filter((x) => x.clientAttemptId !== clientAttemptId);
			storage.setJSON(QUEUE_KEY, q);
		},
		pending(learnerId) {
			return storage.getJSON(QUEUE_KEY, []).filter((x) => !learnerId || x.learnerId === learnerId);
		},

		// Sends queued attempts oldest-first. Stops at the first network
		// failure (still offline) so order is preserved for the server.
		// With { learnerId } only that learner's attempts are sent. Another learner's finished
		// worksheets stay queued until that learner is active (sending them under the wrong
		// learner session is refused by the server, which used to drop them for good).
		async sync(send, { onResult, learnerId } = {}) {
			let q = storage.getJSON(QUEUE_KEY, []);
			const done = [];
			const failed = [];
			for (const item of [...q]) {
				if (learnerId && item.learnerId !== learnerId) continue;
				try {
					const result = await send(item);
					done.push({ item, result });
					q = q.filter((x) => x.clientAttemptId !== item.clientAttemptId);
					storage.setJSON(QUEUE_KEY, q);
					if (onResult) onResult(item, result);
				} catch (err) {
					if (isPermanent(err)) {
						failed.push({ item, error: err });
						q = q.filter((x) => x.clientAttemptId !== item.clientAttemptId);
						storage.setJSON(QUEUE_KEY, q);
						continue;
					}
					const tries = (item.tries || 0) + 1;
					q = q.map((x) => (x.clientAttemptId === item.clientAttemptId ? { ...x, tries, lastError: err && err.code } : x));
					if (tries >= MAX_SYNC_TRIES && err && err.status && err.status !== 401) {
						failed.push({ item, error: err });
						q = q.filter((x) => x.clientAttemptId !== item.clientAttemptId);
					}
					storage.setJSON(QUEUE_KEY, q);
					break;
				}
			}
			return { sent: done.length, failed, remaining: q.length, results: done };
		},
	};
}

// RFC 4122 v4 id from crypto.getRandomValues when available.
export function newClientAttemptId() {
	const c = typeof globalThis !== "undefined" && globalThis.crypto;
	if (c && typeof c.randomUUID === "function") return c.randomUUID();
	const b = new Uint8Array(16);
	if (c && c.getRandomValues) c.getRandomValues(b);
	else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
