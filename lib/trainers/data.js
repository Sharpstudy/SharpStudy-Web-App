// "Meet Our Expert Trainers" (About page): the single place to change this section.
//
// These are ILLUSTRATIVE profiles, not real employees. There are deliberately no names, qualifications, certifications, years of
// experience or employment history here. The "area" is only a topic label for the kind of educator pictured.
//
// PORTRAITS: the ten portraits are in public/images/team/trainers/ (trainer-01.webp ... trainer-10.webp, 800x1000, cropped from the supplied
// 5 x 2 collage) and are switched on below. They are AI-generated illustrations of FICTIONAL people; the section shows that notice while
// they are displayed. Set PORTRAITS_AVAILABLE to false to go back to the neutral silhouette placeholders (no image requests are made then).
// A test checks that all ten files exist, are 800x1000 and are all different from each other.
// When real trainers are announced later, replace `label` with their name, add a short `text`, set `fictional: false` for them and update
// the alt text; the AI-imagery notice is shown only while a fictional portrait is displayed.
export const PORTRAITS_AVAILABLE = true;

const AREAS = [
	"Education mentoring",
	"Communication skills",
	"Mathematics",
	"Personality development",
	"Leadership",
	"Public speaking",
	"Learning and technology",
	"Creative learning",
	"Student development",
	"Senior education mentoring",
];

export const TRAINERS = AREAS.map((area, i) => {
	const n = String(i + 1).padStart(2, "0");
	return {
		id: `trainer-${n}`,
		label: `Trainer ${n}`,
		area,
		text: "Illustrative profile. Details will be added when the team is announced.",
		image: `/images/team/trainers/trainer-${n}.webp`,
		width: 800,
		height: 1000,
		fictional: true,
		alt: `AI-generated illustrative portrait for ${`Trainer ${n}`} (a fictional person)`,
	};
});

export const trainerImagesShown = () => PORTRAITS_AVAILABLE && TRAINERS.some((t) => t.fictional);
