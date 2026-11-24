// Deterministic random numbers for worksheet generation.
// The same seed string always yields the same sequence on server and client,
// so a worksheet can be regenerated anywhere from (level, set, worksheet, variant).
//
// Imports inside lib/mastery use explicit `.js` extensions so the modules run
// unchanged under Node's test runner as well as the Next.js bundler.

// 32-bit FNV-1a hash of a string (UTF-16 code units).
export function fnv1a(str) {
	let h = 0x811c9dc5;
	const s = String(str);
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

// mulberry32 PRNG: returns a function producing floats in [0, 1).
export function mulberry32(seed) {
	let a = seed >>> 0;
	return function next() {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function createRng(seed) {
	const next = mulberry32(typeof seed === "number" ? seed : fnv1a(seed));
	// Inclusive integer in [min, max].
	const int = (min, max) => {
		if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
			throw new RangeError(`int(${min}, ${max}) needs integers with min <= max`);
		}
		return min + Math.floor(next() * (max - min + 1));
	};
	const pick = (arr) => {
		if (!arr || arr.length === 0) throw new RangeError("pick() needs a non-empty array");
		return arr[Math.floor(next() * arr.length)];
	};
	// Fisher–Yates on a copy; the input is never mutated.
	const shuffle = (arr) => {
		const out = arr.slice();
		for (let i = out.length - 1; i > 0; i--) {
			const j = Math.floor(next() * (i + 1));
			[out[i], out[j]] = [out[j], out[i]];
		}
		return out;
	};
	return { next, int, pick, shuffle };
}

export function sheetSeed(levelId, setId, worksheetNo, variant) {
	return `ml|${levelId}|${setId}|${worksheetNo}|${variant}`;
}

// Short printable code for a seed (shown in print footers).
export function seedCode(seed) {
	return fnv1a(seed).toString(16).toUpperCase().padStart(8, "0");
}
