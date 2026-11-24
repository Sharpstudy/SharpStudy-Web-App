// Job listings. Plain data: no job-vacancy table or API exists in SharpStudy, and none is invented here.
//
// The list ships EMPTY, so /careers/ shows an honest "no openings" message. To publish a vacancy, add an entry (it is shown only when
// it has every required field, see openJobs):
//   { id: "math-instructor-1", title: "...", type: "teaching" | "non-teaching", location: "...", summary: "...",
//     responsibilities: ["..."], qualifications: ["..."], experience: "...", applyHref: "/contact-us/" }
// Do not add salary, benefits or qualification claims that have not been confirmed by SharpStudy.

export const JOBS = [];

export const JOB_TYPES = [
	{ slug: "teaching", label: "Teaching and instructor opportunities" },
	{ slug: "non-teaching", label: "Non-teaching opportunities" },
];

const REQUIRED = ["id", "title", "type", "summary", "applyHref"];
export const openJobs = (jobs = JOBS) =>
	jobs.filter((j) => j && REQUIRED.every((k) => typeof j[k] === "string" && j[k].trim()) && JOB_TYPES.some((t) => t.slug === j.type) && /^\//.test(j.applyHref));
