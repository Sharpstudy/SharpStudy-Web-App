// Wires the pure offline store to browser storage and the submit API, and
// re-syncs whenever the browser comes back online.
import { useEffect, useState, useCallback } from "react";
import { createOfflineStore } from "@/lib/mastery/offline";
import { safeStorage } from "./storage";
import { api, getActiveLearner, getLearnerToken } from "./api";

export const offline = createOfflineStore(safeStorage);

export const submitQueued = (item) =>
	api.post("/study/submit", {
		startToken: item.startToken,
		clientAttemptId: item.clientAttemptId,
		responses: item.responses,
		durationMs: item.durationMs,
		completedAt: item.completedAt,
	});

let syncing = null;
export function syncNow() {
	if (!syncing) {
		// With a learner session only that learner's worksheets are sent; with an adult account alone the server checks access per attempt.
		const active = getLearnerToken() ? getActiveLearner() : null;
		syncing = offline.sync(submitQueued, active ? { learnerId: active.id } : {}).finally(() => {
			syncing = null;
		});
	}
	return syncing;
}

// { pending, online, syncing, lastError, sync }
export function useOfflineSync(learnerId) {
	const [state, setState] = useState({ pending: 0, online: true, syncing: false, lastFailed: [] });

	const refresh = useCallback(() => {
		setState((s) => ({
			...s,
			pending: offline.pending(learnerId).length,
			online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
		}));
	}, [learnerId]);

	const sync = useCallback(async () => {
		if (offline.pending().length === 0) return refresh();
		setState((s) => ({ ...s, syncing: true }));
		try {
			const r = await syncNow();
			setState((s) => ({ ...s, lastFailed: r.failed }));
		} finally {
			setState((s) => ({ ...s, syncing: false }));
			refresh();
		}
	}, [refresh]);

	useEffect(() => {
		refresh();
		sync();
		const on = () => sync();
		const off = () => refresh();
		window.addEventListener("online", on);
		window.addEventListener("offline", off);
		const t = setInterval(sync, 60000);
		return () => {
			window.removeEventListener("online", on);
			window.removeEventListener("offline", off);
			clearInterval(t);
		};
	}, [sync, refresh]);

	return { ...state, sync, refresh };
}
