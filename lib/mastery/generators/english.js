// English generators. Content comes from small curated word lists so every
// question and answer is known to be correct; nothing is invented at runtime.

import { textProblem, choiceProblem, distinct } from "../problem.js";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");

// Picture words with an unambiguous first letter and emoji.
const PICTURE_WORDS = [
	["apple", "🍎"], ["ball", "⚽"], ["cat", "🐱"], ["dog", "🐶"], ["egg", "🥚"],
	["fish", "🐟"], ["goat", "🐐"], ["hat", "🎩"], 
	["kite", "🪁"], ["lion", "🦁"], ["moon", "🌙"], ["owl", "🦉"],
	["pig", "🐷"], ["rabbit", "🐰"], ["sun", "☀️"], ["tree", "🌳"],
	["umbrella", "☂️"], ["van", "🚐"], ["web", "🕸️"], ["yo-yo", "🪀"], ["zebra", "🦓"],
];

const RHYME_FAMILIES = [
	["cat", "hat", "bat", "mat", "rat", "sat"],
	["dog", "log", "frog", "fog", "jog"],
	["sun", "run", "bun", "fun"],
	["pig", "big", "dig", "wig", "fig"],
	["hen", "pen", "ten", "men"],
	["top", "hop", "mop", "pop", "shop"],
	["bug", "hug", "mug", "rug", "jug"],
	["cake", "lake", "bake", "rake"],
	["bell", "well", "shell", "smell"],
];

// [singular, plural] — includes common irregular plurals.
const PLURALS = [
	["cat", "cats"], ["dog", "dogs"], ["book", "books"], ["box", "boxes"], ["fox", "foxes"],
	["bus", "buses"], ["dish", "dishes"], ["church", "churches"], ["baby", "babies"],
	["city", "cities"], ["party", "parties"], ["leaf", "leaves"], ["knife", "knives"],
	["child", "children"], ["mouse", "mice"], ["tooth", "teeth"], ["foot", "feet"],
	["man", "men"], ["woman", "women"], ["sheep", "sheep"], ["toy", "toys"], ["day", "days"],
];

const OPPOSITES = [
	["hot", "cold", []], ["big", "small", ["little", "tiny"]], ["up", "down", []],
	["happy", "sad", ["unhappy"]], ["fast", "slow", []], ["open", "closed", ["shut"]],
	["day", "night", []], ["tall", "short", []], ["full", "empty", []], ["wet", "dry", []],
	["old", "new", ["young"]], ["light", "dark", ["heavy"]], ["push", "pull", []],
	["early", "late", []], ["loud", "quiet", ["soft"]], ["win", "lose", []],
];

// [base, past] — regular and irregular verbs.
const PAST_TENSE = [
	["walk", "walked"], ["jump", "jumped"], ["play", "played"], ["help", "helped"],
	["hop", "hopped"], ["stop", "stopped"], ["cry", "cried"], ["try", "tried"],
	["go", "went"], ["see", "saw"], ["eat", "ate"], ["run", "ran"], ["swim", "swam"],
	["write", "wrote"], ["take", "took"], ["make", "made"], ["sing", "sang"],
	["drink", "drank"], ["buy", "bought"], ["think", "thought"], ["catch", "caught"],
	["sleep", "slept"], ["find", "found"], ["tell", "told"],
];

// Words chosen so each belongs to only one of these classes in everyday use.
const NOUNS = ["teacher", "river", "mountain", "kitchen", "window", "village", "elephant", "castle", "banana", "library"];
const VERBS = ["write", "carry", "eat", "sing", "bring", "sit", "teach", "choose", "speak", "forget"];
const ADJECTIVES = ["happy", "tall", "noisy", "gentle", "tiny", "shiny", "careful", "hungry", "angry", "enormous"];

// [word, synonym] pairs; distractors are drawn from other pairs.
const SYNONYMS = [
	["big", "large"], ["small", "little"], ["quick", "fast"], ["happy", "glad"],
	["begin", "start"], ["end", "finish"], ["shout", "yell"], ["fix", "repair"],
	["unhappy", "sad"], ["easy", "simple"], ["scared", "afraid"], ["close", "shut"],
	["choose", "pick"], ["gift", "present"], ["rock", "stone"], ["wealthy", "rich"],
];

export const english = {
	upperToLower(rng) {
		const letter = rng.pick(ALPHABET);
		const others = distinct(rng, ALPHABET, 3, [letter]);
		return choiceProblem(rng, `Which small letter matches the capital letter ${letter.toUpperCase()}?`, letter, others, {
			solution: [`Capital ${letter.toUpperCase()} and small ${letter} are the same letter.`],
		});
	},
	nextLetter(rng) {
		const i = rng.int(0, 23);
		const shown = ALPHABET.slice(i, i + 2);
		return textProblem([`What letter comes next? ${shown.join(", ")}, `, { blank: true }], ALPHABET[i + 2], {
			accept: [ALPHABET[i + 2].toUpperCase()],
			solution: [`In the alphabet, after ${shown[1]} comes ${ALPHABET[i + 2]}.`],
		});
	},
	firstLetter(rng) {
		const [word, emoji] = rng.pick(PICTURE_WORDS);
		// The word is only in the picture's spoken label, so the task is hearing
		// the first sound rather than copying a written letter.
		return textProblem("Say the word for this picture. What letter does it start with?", word[0], {
			text: `Say the word for this picture (${word}). What letter does it start with?`,
			accept: [word[0].toUpperCase()],
			scene: { kind: "objects", emoji, count: 1, label: `Picture of ${/^[aeiou]/.test(word) ? "an" : "a"} ${word}` },
			solution: [`Say it slowly: "${word}" starts with the sound of ${word[0]}.`],
		});
	},
	rhyme(rng) {
		const fams = rng.shuffle(RHYME_FAMILIES);
		const fam = fams[0];
		const [target, answer] = rng.shuffle(fam);
		const distractors = [fams[1], fams[2], fams[3]].map((f) => rng.pick(f));
		return choiceProblem(rng, `Which word rhymes with "${target}"?`, answer, distractors, {
			solution: [`"${target}" and "${answer}" end with the same sound.`],
		});
	},
	plural(rng) {
		const [one, many] = rng.pick(PLURALS);
		return textProblem(`Write the plural: one ${one}, two ${"_".repeat(3)}`, many, {
			solution: [`The plural of "${one}" is "${many}".`],
		});
	},
	opposite(rng) {
		// Always ask in the listed direction: reversed pairs can be ambiguous
		// (the opposite of "short" could be "tall" or "long").
		const [ask, ans, alt] = rng.pick(OPPOSITES);
		return textProblem(`What is the opposite of "${ask}"?`, ans, {
			accept: alt,
			solution: [`The opposite of "${ask}" is "${ans}".`],
		});
	},
	alphabeticalFirst(rng) {
		const pool = PICTURE_WORDS.map((w) => w[0]).filter((w) => /^[a-z]+$/.test(w));
		const words = rng.shuffle(pool).slice(0, 4);
		const first = words.slice().sort()[0];
		return choiceProblem(rng, "Which word comes first in alphabetical order?", first, words.filter((w) => w !== first), {
			solution: [`Look at the first letters. "${first}" starts with the earliest letter in the alphabet.`],
		});
	},
	pastTense(rng) {
		const [base, past] = rng.pick(PAST_TENSE);
		return textProblem(`Today I ${base}. Yesterday I ${"_".repeat(3)}.`, past, {
			solution: [`The past tense of "${base}" is "${past}".`],
		});
	},
	wordClass(rng) {
		const kind = rng.pick(["noun", "verb", "adjective"]);
		const lists = { noun: NOUNS, verb: VERBS, adjective: ADJECTIVES };
		const answer = rng.pick(lists[kind]);
		const others = Object.keys(lists).filter((k) => k !== kind);
		const distractors = [rng.pick(lists[others[0]]), rng.pick(lists[others[1]]), rng.pick(lists[others[rng.int(0, 1)]])];
		const uniq = [...new Set(distractors)].filter((d) => d !== answer);
		while (uniq.length < 3) {
			const d = rng.pick(lists[rng.pick(others)]);
			if (!uniq.includes(d)) uniq.push(d);
		}
		const hint = { noun: "a person, place or thing", verb: "an action word", adjective: "a describing word" }[kind];
		return choiceProblem(rng, `Which word is ${kind === "adjective" ? "an" : "a"} ${kind}?`, answer, uniq, {
			solution: [`A ${kind} is ${hint}. "${answer}" is ${hint}.`],
		});
	},
	synonym(rng) {
		const pairs = rng.shuffle(SYNONYMS);
		const [word, syn] = pairs[0];
		const distractors = pairs.slice(1, 4).map((p) => p[1]);
		return choiceProblem(rng, `Which word means the same as "${word}"?`, syn, distractors, {
			solution: [`"${word}" and "${syn}" have the same meaning.`],
		});
	},
};
