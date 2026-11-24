// The four SharpStudy learning programs: public curriculum content.
//
// This is a PROPOSED curriculum outline, not an officially approved syllabus. It deliberately contains no prices, durations,
// instructor credentials, statistics or guarantees. Learning delivery (lessons, quizzes, progress, enrolment) is NOT stored here:
// it reuses the existing course system. A program is linked to its published courses by CATEGORY SLUG: every approved course whose
// category slug equals the program slug is listed on that program's page and is enrolled in through the normal course page.
//
// Plain ES module, no framework imports, so it can be unit tested with `node --test`.

export const PROGRAMS = [
	{
		slug: "personality-enrichment",
		title: "Personality Enrichment",
		short: "Grow self-awareness, confidence and the people skills that last a lifetime.",
		icon: "ri-heart-pulse-line",
		tone: "pink",
		overview:
			"Personality Enrichment helps learners understand themselves, build healthy confidence and communicate and connect well with others, through guided reflection and practical, everyday activities.",
		objectives: [
			"Recognise personal strengths, values and areas for growth",
			"Build the confidence to express ideas and try new things",
			"Communicate clearly, listen well and respond with empathy",
			"Understand emotions and build positive relationships",
		],
		modules: [
			{ title: "Self-awareness and personal growth", text: "Understanding who you are, what matters to you and how you want to grow." },
			{ title: "Confidence building", text: "Small, repeatable habits that turn hesitation into steady self-belief." },
			{ title: "Communication skills", text: "Speaking, listening and body language for everyday conversations." },
			{ title: "Emotional intelligence", text: "Naming feelings, managing reactions and understanding others." },
			{ title: "Interpersonal relationships", text: "Friendship, teamwork, respect and resolving disagreements kindly." },
			{ title: "Personal development activities", text: "Journals, goal setting and challenges that put the lessons into practice." },
		],
		outcomes: [
			"A clearer picture of personal strengths and goals",
			"More confidence in everyday social and school situations",
			"Stronger listening and communication habits",
			"Better handling of emotions and relationships",
		],
		activities: ["Reflection journals and self-portraits", "Role-play and conversation practice", "Goal-setting worksheets", "Group challenges"],
		assessments: ["Reflection tasks reviewed by the instructor", "Module quizzes", "A personal development project"],
	},
	{
		slug: "mathx",
		title: "MathX",
		short: "Make numbers feel quick, logical and fun with mental maths, puzzles and real-life problems.",
		icon: "ri-calculator-line",
		tone: "sky",
		overview:
			"MathX builds strong number sense and flexible thinking. Learners practise mental mathematics, logical reasoning and problem-solving techniques, and see how mathematics shows up in everyday life.",
		objectives: [
			"Develop strong number sense and fluency",
			"Calculate quickly and accurately in the head",
			"Reason logically and explain how an answer was reached",
			"Apply problem-solving strategies to unfamiliar problems",
		],
		modules: [
			{ title: "Number sense", text: "How numbers work: place value, relationships and estimation." },
			{ title: "Mental mathematics", text: "Strategies for fast, confident calculation without a calculator." },
			{ title: "Logical reasoning", text: "Patterns, sequences and step-by-step deduction." },
			{ title: "Mathematical puzzles", text: "Games and puzzles that make practice enjoyable." },
			{ title: "Problem-solving techniques", text: "Break a problem down, try a strategy, check the result." },
			{ title: "Practical mathematics", text: "Money, measurement, time and data in everyday situations." },
		],
		outcomes: [
			"Greater speed and accuracy with numbers",
			"Confidence tackling unfamiliar problems",
			"Clearer logical reasoning and explanations",
			"An understanding of how mathematics is used in daily life",
		],
		activities: ["Daily mental-maths drills", "Puzzle and logic challenges", "Worked problem-solving sessions", "Real-life maths projects"],
		assessments: ["Practice quizzes with instant results", "Timed accuracy checks", "A practical maths project"],
	},
	{
		slug: "leadership",
		title: "Leadership",
		short: "Learn to lead yourself and others through teamwork, decisions and real projects.",
		icon: "ri-flag-2-line",
		tone: "orange",
		overview:
			"Leadership starts with self-leadership. Learners explore what makes a good leader, work in teams, practise making decisions and solving problems, and finish by leading a project of their own.",
		objectives: [
			"Understand what leadership means and what good leaders do",
			"Manage themselves: goals, responsibility and follow-through",
			"Collaborate and contribute effectively in a team",
			"Make decisions and solve problems with care",
		],
		modules: [
			{ title: "Introduction to leadership", text: "What leadership is, and the qualities and habits of good leaders." },
			{ title: "Self-leadership", text: "Setting goals, taking responsibility and staying motivated." },
			{ title: "Teamwork and collaboration", text: "Roles, trust and getting the best out of a group." },
			{ title: "Decision-making", text: "Weighing options, considering others and owning the outcome." },
			{ title: "Problem-solving", text: "Finding the real problem and working through it as a team." },
			{ title: "Leadership projects", text: "Planning and leading a small project from idea to result." },
		],
		outcomes: [
			"A personal view of what kind of leader they want to be",
			"Better teamwork and collaboration habits",
			"A clear process for making decisions",
			"Experience planning and leading a project",
		],
		activities: ["Team challenges and simulations", "Case discussions", "Decision-making exercises", "A group leadership project"],
		assessments: ["Reflection and peer feedback", "Module quizzes", "A leadership project presentation"],
	},
	{
		slug: "public-speaking",
		title: "Public Speaking",
		short: "Prepare, practise and deliver speeches with a clear voice and a confident presence.",
		icon: "ri-mic-line",
		tone: "green",
		overview:
			"Public Speaking takes learners from nervous first words to prepared, engaging talks. They learn how to plan a speech, use voice and body language, tell stories and practise through debate and live speaking.",
		objectives: [
			"Overcome nervousness and speak with confidence",
			"Plan and structure a clear speech",
			"Use voice, pace and body language effectively",
			"Engage an audience through storytelling and discussion",
		],
		modules: [
			{ title: "Introduction to public speaking", text: "Why speaking matters, and how to manage nerves." },
			{ title: "Speech preparation", text: "Choosing a topic, structuring ideas and writing a clear message." },
			{ title: "Presentation skills", text: "Slides, props and holding an audience's attention." },
			{ title: "Voice and body language", text: "Volume, pace, eye contact, posture and gesture." },
			{ title: "Storytelling", text: "Using stories to make a message memorable." },
			{ title: "Debate and speaking practice", text: "Thinking on your feet through debate and regular practice." },
		],
		outcomes: [
			"More comfort speaking in front of others",
			"Well-structured, clearly delivered speeches",
			"Better use of voice and body language",
			"Practice responding to questions and counter-arguments",
		],
		activities: ["Short impromptu talks", "Recorded practice speeches", "Storytelling circles", "Debates and live classes"],
		assessments: ["Prepared speech delivered to the instructor or class", "Peer and instructor feedback", "Module quizzes"],
	},
];

export const programBySlug = (slug) => PROGRAMS.find((p) => p.slug === String(slug || "").toLowerCase()) || null;

export const PROGRAM_SLUGS = PROGRAMS.map((p) => p.slug);

export const programHref = (slug) => `/programs/${slug}/`;

// Public navigation: the "Programs" dropdown entries.
export const programNavItems = () => PROGRAMS.map((p) => ({ href: programHref(p.slug), label: p.title }));
