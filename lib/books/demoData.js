// Twenty-one FICTIONAL demo books (three per age group) for development and demonstrations.
// Titles, authors, descriptions and the sample text inside the PDFs were written for SharpStudy: they are not
// real publications, and prices are placeholder demo prices (INR). Nothing here is copied from any book.
// Every record is flagged is_demo and shows a "Demo" label in the store and the admin dashboard.
//
// Stable slugs are the identity used by the seeder, so re-running it never creates duplicates.

export const DEMO_PUBLISHER = "SharpStudy Demo Press";
export const DEMO_YEAR = 2026;
export const OPEN = 120; // an open-ended maximum age ("18+")

// [slug, title, author, group, minAge, maxAge, gradeMin, gradeMax, category, subject, level, priceRupees, tags, featured, description, sampleLines, hue]
const rows = [
	// ---- Ages 0-3 : Baby & Toddler
	["demo-my-first-colors-and-shapes", "My First Colors and Shapes", "Rina Alvarez", "baby-toddler", 0, 3, null, null, "childrens-books", "arts", "pre-reader", 149, ["colors", "shapes", "board book"], true,
		"A bright read-aloud about red apples, blue boats and yellow suns. Each page pairs one colour with one simple shape for little hands to point at.",
		["Red is round like an apple.", "Blue is a boat on a wavy sea.", "Yellow is a sun with a smiling face.", "Can you find a triangle? Point to it!"], 350],
	["demo-little-animals-around-me", "Little Animals Around Me", "Tomas Beck", "baby-toddler", 0, 3, null, null, "childrens-books", "science", "pre-reader", 169, ["animals", "sounds", "read aloud"], false,
		"Meet a duck, a cat and a tiny frog. Short rhyming lines invite toddlers to copy each animal sound.",
		["The duck says quack, quack, quack.", "The cat says meow, meow, meow.", "The little frog goes hop, hop, hop.", "What does the dog say?"], 140],
	["demo-tiny-hands-big-discoveries", "Tiny Hands, Big Discoveries", "Naomi Ledger", "baby-toddler", 1, 3, null, null, "childrens-books", "life-skills", "pre-reader", 199, ["touch", "play", "first words"], false,
		"Wave, clap, stack and splash. A gentle picture book about the everyday things small hands can do.",
		["Hands can clap: clap, clap, clap!", "Hands can stack one block, two blocks, three.", "Hands can wave hello and goodbye.", "Hands can hug someone you love."], 30],

	// ---- Ages 4-6 : Preschool & Kindergarten
	["demo-abc-adventures", "ABC Adventures", "Priya Menon", "preschool", 4, 6, -1, 1, "english", "english", "beginner", 229, ["alphabet", "phonics", "letters"], false,
		"Twenty-six letters, twenty-six tiny adventures. Each letter visits a place and meets a friend whose name begins with its sound.",
		["A is for ant, who climbs up high.", "B is for bear, who waves goodbye.", "C is for cat on a cosy mat.", "Say each sound slowly: aaa, b, k."], 205],
	["demo-counting-with-friendly-animals", "Counting with Friendly Animals", "Samuel Okafor", "preschool", 3, 6, -1, 1, "mathematics", "math", "beginner", 249, ["counting", "numbers", "early maths"], true,
		"One owl, two otters, three tortoises... Count from one to ten with a parade of friendly animals and gentle number games.",
		["1 owl sits on a branch.", "2 otters slide into the river.", "3 tortoises walk along slowly.", "How many animals are there altogether? Count with your finger."], 120],
	["demo-my-first-science-activity-book", "My First Science Activity Book", "Dr. Leena Rao (fictional)", "preschool", 4, 7, -1, 2, "science", "science", "beginner", 299, ["experiments", "activities", "nature"], false,
		"Safe, simple things to try with a grown-up: sink and float, grow a bean, make a rainbow with a glass of water.",
		["Float or sink? Drop a leaf and a coin in water.", "Plant a bean in a cup and watch it grow.", "Look for shapes in the clouds.", "Ask a grown-up to help with every activity."], 160],

	// ---- Ages 7-9 : Young Readers
	["demo-the-curious-math-explorer", "The Curious Math Explorer", "Arjun Pillai", "young-readers", 7, 9, 2, 4, "mathematics", "math", "intermediate", 349, ["maths", "puzzles", "multiplication"], true,
		"Follow Mira the explorer through caves of multiplication and bridges of fractions. Each chapter ends with a puzzle to solve.",
		["Mira finds 3 treasure chests with 4 gems in each.", "3 x 4 = 12 gems in all.", "A bridge is cut into 4 equal planks. One plank is 1/4.", "Puzzle: what is 5 x 6? Draw it as 5 rows of 6."], 215],
	["demo-amazing-science-for-young-minds", "Amazing Science for Young Minds", "Helena Voss", "young-readers", 7, 10, 2, 5, "science", "science", "intermediate", 379, ["science", "plants", "water cycle"], false,
		"Why do plants need light? Where does rain come from? Clear explanations, simple diagrams in words, and questions to wonder about.",
		["Plants make their food using sunlight, water and air.", "Water rises as vapour, cools into clouds and falls as rain.", "A magnet attracts some metals but not wood or plastic.", "Wonder: what would happen to a plant kept in the dark?"], 160],
	["demo-english-stories-and-word-adventures", "English Stories and Word Adventures", "Callum Reid", "young-readers", 7, 9, 2, 4, "english", "english", "intermediate", 329, ["stories", "vocabulary", "reading"], false,
		"Six short stories and word games about a town where every sign hides a riddle. Build vocabulary while you read.",
		["The baker's sign read: I rise, but I am not a sun.", "Answer: bread dough!", "Word of the day: gigantic means very, very big.", "Write one sentence using gigantic."], 280],

	// ---- Ages 10-12 : Independent Readers
	["demo-the-young-inventors-handbook", "The Young Inventor's Handbook", "Isabel Okonkwo", "independent-readers", 10, 13, 5, 8, "science", "science", "intermediate", 449, ["inventing", "design", "STEM"], true,
		"How do inventors think? Learn to notice a problem, sketch ideas, build a simple prototype and test it fairly.",
		["Step 1: notice a small problem in your day.", "Step 2: sketch three different ideas.", "Step 3: build the simplest version from household materials.", "Step 4: test it and change one thing at a time."], 45],
	["demo-mysteries-of-space-and-earth", "Mysteries of Space and Earth", "Kavya Nair", "independent-readers", 10, 12, 5, 7, "science", "science", "intermediate", 429, ["space", "earth science", "planets"], false,
		"Why does the Moon change shape? How do mountains form? Explore planets, tides and the layers beneath your feet.",
		["The Earth spins once about every 24 hours, giving day and night.", "The Moon seems to change shape as we see different parts of its lit side.", "Earth has layers: crust, mantle and core.", "Try: model the Moon's phases with a ball and a lamp."], 235],
	["demo-coding-adventures-for-beginners", "Coding Adventures for Beginners", "Marcus Bell", "independent-readers", 10, 14, 5, 9, "computer-science", "computer-science", "intermediate", 499, ["coding", "scratch-style", "logic"], false,
		"Learn sequences, loops and decisions by guiding a robot through mazes on paper first, then through simple block-style programs.",
		["A program is a list of steps in order.", "A loop repeats steps: repeat 3 times: move forward.", "A decision asks a question: if the path is blocked, turn right.", "Debugging means finding and fixing a mistake in a program."], 195],

	// ---- Ages 13-15 : Middle & Secondary School
	["demo-mathematics-made-clear", "Mathematics Made Clear", "Dev Malhotra", "middle-secondary", 13, 15, 8, 10, "mathematics", "math", "intermediate", 549, ["algebra", "geometry", "practice"], true,
		"Algebra, ratios and geometry explained in plain steps, with worked examples and practice questions at the end of each chapter.",
		["Solve 3x + 5 = 20: subtract 5 to get 3x = 15, then divide by 3: x = 5.", "A ratio of 2:3 means 2 parts to 3 parts.", "The angles in a triangle add up to 180 degrees.", "Practice: solve 4x - 7 = 21."], 215],
	["demo-foundations-of-physics-and-chemistry", "Foundations of Physics and Chemistry", "Dr. Anita Joshi (fictional)", "middle-secondary", 13, 16, 8, 11, "science", "science", "intermediate", 599, ["physics", "chemistry", "experiments"], false,
		"Forces, energy, atoms and reactions: the core ideas of secondary science with safe classroom-style investigations.",
		["Speed = distance divided by time.", "Atoms combine to form molecules; a chemical reaction rearranges atoms.", "Energy is never created or destroyed, only transferred.", "Investigate: how does ramp height change a toy car's speed?"], 190],
	["demo-english-grammar-and-creative-writing", "English Grammar and Creative Writing", "Fiona Hartley", "middle-secondary", 13, 15, 8, 10, "english", "english", "intermediate", 499, ["grammar", "writing", "essays"], false,
		"Master clauses, punctuation and paragraphs, then use them to write vivid descriptions, stories and short essays.",
		["A clause has a subject and a verb.", "Use a semicolon to join two closely related clauses.", "Show, do not tell: replace 'she was scared' with what her hands and breath did.", "Write a 100-word description of a rainy street."], 280],

	// ---- Ages 16-18 : Senior Secondary
	["demo-advanced-mathematics-practice", "Advanced Mathematics Practice", "Prof. Rohan Iyer (fictional)", "senior-secondary", 16, 18, 11, 12, "mathematics", "math", "advanced", 699, ["calculus", "trigonometry", "exam practice"], false,
		"Graded practice in functions, trigonometry and an introduction to differentiation, with full worked solutions.",
		["The derivative of x squared is 2x.", "sin squared x + cos squared x = 1.", "The slope of a tangent line is the derivative at that point.", "Practice: differentiate 3x cubed - 2x."], 215],
	["demo-biology-life-and-systems", "Biology: Life and Systems", "Dr. Meera Kapoor (fictional)", "senior-secondary", 16, 18, 11, 12, "science", "science", "advanced", 749, ["biology", "cells", "genetics"], true,
		"Cells, organ systems, inheritance and ecosystems, linked together with diagrams described in words and revision questions.",
		["The cell membrane controls what enters and leaves a cell.", "DNA carries instructions for building proteins.", "An ecosystem includes living things and their physical surroundings.", "Revision: name three organ systems and one job of each."], 120],
	["demo-computer-science-and-programming-fundamentals", "Computer Science and Programming Fundamentals", "Nikhil Sharma", "senior-secondary", 16, 19, 11, 13, "computer-science", "computer-science", "advanced", 799, ["programming", "algorithms", "python"], false,
		"Variables, control flow, functions and simple data structures, taught with short Python-style examples and exercises.",
		["A variable stores a value: total = 5 + 3.", "A function groups steps: def area(w, h): return w * h.", "Use a loop to process every item in a list.", "Exercise: write a function that returns the largest of three numbers."], 195],

	// ---- Ages 18+ : College & Lifelong Learning (open-ended maximum age)
	["demo-practical-web-development", "Practical Web Development", "Zoe Chandler", "adult", 18, OPEN, 13, 13, "computer-science", "computer-science", "advanced", 899, ["html", "css", "javascript"], true,
		"Build and publish a small website: HTML structure, CSS layout, JavaScript interaction and how browsers talk to servers.",
		["HTML describes the structure of a page: headings, paragraphs, links.", "CSS controls how it looks: colour, spacing and layout.", "JavaScript reacts to clicks and updates the page.", "Project: build a one-page portfolio with three sections."], 205],
	["demo-data-structures-and-algorithms-a-beginners-guide", "Data Structures and Algorithms: A Beginner's Guide", "Karthik Subramanian", "adult", 18, OPEN, 13, 13, "computer-science", "computer-science", "advanced", 949, ["algorithms", "data structures", "interview prep"], false,
		"Arrays, lists, stacks, queues, trees and the sorting and searching ideas that make programs fast, explained step by step.",
		["An array stores items in order and gives quick access by position.", "A stack is last-in, first-out; a queue is first-in, first-out.", "Binary search halves the search range each step: it needs sorted data.", "Practice: describe how to reverse a list using a stack."], 260],
	["demo-engineering-mathematics-essentials", "Engineering Mathematics Essentials", "Dr. Lakshmi Prasad (fictional)", "adult", 18, OPEN, 13, 13, "mathematics", "math", "advanced", 999, ["linear algebra", "calculus", "engineering"], false,
		"Matrices, differential equations and numerical methods for first-year engineering students and returning learners.",
		["A matrix is a rectangular array of numbers used to describe linear relationships.", "Solving a system of equations can be done by row reduction.", "A differential equation relates a function to its rate of change.", "Practice: multiply a 2x2 matrix by a 2x1 vector."], 15],
];

export const DEMO_BOOKS = rows.map(([slug, title, author, ageGroup, minAge, maxAge, gradeMin, gradeMax, category, subject, readingLevel, price, tags, featured, description, sample, hue]) => ({
	slug, title, author, ageGroup, minAge, maxAge, gradeMin, gradeMax, category, subject, readingLevel, language: "en", priceRupees: price, tags, featured, description, sample, hue,
}));
