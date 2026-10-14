"use strict";
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const passwordHash = await bcrypt.hash("password123", 10);

    // ---------- Users ----------
    const adminId = uuidv4();
    const instructor1Id = uuidv4();
    const instructor2Id = uuidv4();
    const student1Id = uuidv4();
    const student2Id = uuidv4();
    const student3Id = uuidv4();

    await queryInterface.bulkInsert("users", [
      {
        id: adminId,
        first_name: "Ada",
        last_name: "Admin",
        email: "admin@sharpstudy.test",
        password: passwordHash,
        role: "admin",
        email_confirmed: true,
        email_confirmed_at: now,
        status: true,
        is_profile_public: true,
        bio: "Site administrator.",
        created_at: now,
        updated_at: now,
      },
      {
        id: instructor1Id,
        first_name: "Isaac",
        last_name: "Instructor",
        email: "isaac@sharpstudy.test",
        password: passwordHash,
        role: "instructor",
        designation: "Senior Mathematics Instructor",
        bio: "Loves teaching algebra and calculus.",
        email_confirmed: true,
        email_confirmed_at: now,
        instructor_request: true,
        instructor_request_confirmed: true,
        instructor_request_confirmed_at: now,
        instructor_status: true,
        instructor_subject: "Mathematics",
        instructor_description: "10+ years teaching experience.",
        status: true,
        is_profile_public: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: instructor2Id,
        first_name: "Isabella",
        last_name: "Instructor",
        email: "isabella@sharpstudy.test",
        password: passwordHash,
        role: "instructor",
        designation: "Science Instructor",
        bio: "Passionate about physics and chemistry.",
        email_confirmed: true,
        email_confirmed_at: now,
        instructor_request: true,
        instructor_request_confirmed: true,
        instructor_request_confirmed_at: now,
        instructor_status: true,
        instructor_subject: "Science",
        instructor_description: "Former high school science teacher.",
        status: true,
        is_profile_public: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: student1Id,
        first_name: "Sam",
        last_name: "Student",
        email: "sam@sharpstudy.test",
        password: passwordHash,
        role: "student",
        email_confirmed: true,
        email_confirmed_at: now,
        status: true,
        is_profile_public: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: student2Id,
        first_name: "Sara",
        last_name: "Student",
        email: "sara@sharpstudy.test",
        password: passwordHash,
        role: "student",
        email_confirmed: true,
        email_confirmed_at: now,
        status: true,
        is_profile_public: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: student3Id,
        first_name: "Sean",
        last_name: "Student",
        email: "sean@sharpstudy.test",
        password: passwordHash,
        role: "student",
        email_confirmed: true,
        email_confirmed_at: now,
        status: true,
        is_profile_public: true,
        created_at: now,
        updated_at: now,
      },
    ]);

    // ---------- Categories ----------
    const catMathId = uuidv4();
    const catScienceId = uuidv4();
    const catCsId = uuidv4();
    const catLangId = uuidv4();

    await queryInterface.bulkInsert("categories", [
      { id: catMathId, name: "Mathematics", slug: "mathematics", created_at: now, updated_at: now },
      { id: catScienceId, name: "Science", slug: "science", created_at: now, updated_at: now },
      { id: catCsId, name: "Computer Science", slug: "computer-science", created_at: now, updated_at: now },
      { id: catLangId, name: "Languages", slug: "languages", created_at: now, updated_at: now },
    ]);

    // ---------- Courses ----------
    const course1Id = uuidv4(); // Algebra - instructor1 - math
    const course2Id = uuidv4(); // Calculus - instructor1 - math
    const course3Id = uuidv4(); // Physics - instructor2 - science
    const course4Id = uuidv4(); // Web Dev - instructor2 - cs

    await queryInterface.bulkInsert("courses", [
      {
        id: course1Id,
        title: "Algebra Fundamentals",
        slug: "algebra-fundamentals",
        short_desc: "Master the basics of algebra from the ground up.",
        overview: "A complete introduction to algebraic concepts, equations, and problem solving.",
        latest_price: 49.99,
        before_price: 79.99,
        lessons: "12",
        duration: "6h 30m",
        image: "course-1.jpg",
        access_time: "Lifetime",
        requirements: "No prior knowledge required.",
        what_you_will_learn: "Linear equations, inequalities, polynomials, factoring.",
        who_is_this_course_for: "High school and college students.",
        userId: instructor1Id,
        catId: catMathId,
        approved: true,
        in_home_page: true,
        in_home_page_set_at: now,
        is_class: false,
        created_at: now,
        updated_at: now,
      },
      {
        id: course2Id,
        title: "Calculus I: Limits & Derivatives",
        slug: "calculus-i-limits-derivatives",
        short_desc: "A deep dive into limits, derivatives, and their applications.",
        overview: "Build a strong foundation in differential calculus.",
        latest_price: 59.99,
        before_price: 99.99,
        lessons: "15",
        duration: "8h 15m",
        image: "course-2.jpg",
        access_time: "1 Year",
        requirements: "Completion of Algebra Fundamentals recommended.",
        what_you_will_learn: "Limits, continuity, derivatives, optimization.",
        who_is_this_course_for: "College students and self-learners.",
        userId: instructor1Id,
        catId: catMathId,
        approved: true,
        in_home_page: false,
        is_class: false,
        created_at: now,
        updated_at: now,
      },
      {
        id: course3Id,
        title: "Physics 101: Mechanics",
        slug: "physics-101-mechanics",
        short_desc: "Understand the fundamental laws of motion and energy.",
        overview: "An introductory course covering classical mechanics.",
        latest_price: 54.99,
        before_price: 89.99,
        lessons: "10",
        duration: "5h 45m",
        image: "course-3.jpg",
        access_time: "Six Months",
        requirements: "Basic algebra knowledge.",
        what_you_will_learn: "Newton's laws, kinematics, energy, momentum.",
        who_is_this_course_for: "High school and early college students.",
        userId: instructor2Id,
        catId: catScienceId,
        approved: true,
        in_home_page: true,
        in_home_page_set_at: now,
        is_class: false,
        created_at: now,
        updated_at: now,
      },
      {
        id: course4Id,
        title: "Intro to Web Development",
        slug: "intro-to-web-development",
        short_desc: "Learn HTML, CSS, and JavaScript from scratch.",
        overview: "A beginner-friendly path into building websites.",
        latest_price: 39.99,
        before_price: 69.99,
        lessons: "20",
        duration: "10h 00m",
        image: "course-4.jpg",
        access_time: "Lifetime",
        requirements: "A computer and curiosity.",
        what_you_will_learn: "HTML5, CSS3, modern JavaScript basics.",
        who_is_this_course_for: "Absolute beginners.",
        userId: instructor2Id,
        catId: catCsId,
        approved: true,
        in_home_page: false,
        is_class: false,
        created_at: now,
        updated_at: now,
      },
    ]);

    // ---------- Videos ----------
    const video1Id = uuidv4();
    const video2Id = uuidv4();
    const video3Id = uuidv4();
    const video4Id = uuidv4();

    await queryInterface.bulkInsert("videos", [
      {
        id: video1Id,
        group_name: "Getting Started",
        title: "Welcome to Algebra Fundamentals",
        thumb: "video-thumb-1.jpg",
        video: "video-1.mp4",
        video_length: 300,
        is_preview: true,
        short_id: 1,
        userId: instructor1Id,
        courseId: course1Id,
        created_at: now,
        updated_at: now,
      },
      {
        id: video2Id,
        group_name: "Linear Equations",
        title: "Solving Linear Equations",
        thumb: "video-thumb-2.jpg",
        video: "video-2.mp4",
        video_length: 720,
        is_preview: false,
        short_id: 2,
        userId: instructor1Id,
        courseId: course1Id,
        created_at: now,
        updated_at: now,
      },
      {
        id: video3Id,
        group_name: "Getting Started",
        title: "Welcome to Physics 101",
        thumb: "video-thumb-3.jpg",
        video: "video-3.mp4",
        video_length: 280,
        is_preview: true,
        short_id: 1,
        userId: instructor2Id,
        courseId: course3Id,
        created_at: now,
        updated_at: now,
      },
      {
        id: video4Id,
        group_name: "HTML Basics",
        title: "Your First HTML Page",
        thumb: "video-thumb-4.jpg",
        video: "video-4.mp4",
        video_length: 540,
        is_preview: true,
        short_id: 1,
        userId: instructor2Id,
        courseId: course4Id,
        created_at: now,
        updated_at: now,
      },
    ]);

    // ---------- Course assets ----------
    await queryInterface.bulkInsert("course_assets", [
      {
        id: uuidv4(),
        lecture_name: "Algebra Cheat Sheet",
        lecture_file: "algebra-cheat-sheet.pdf",
        courseId: course1Id,
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv4(),
        lecture_name: "Physics Formula Sheet",
        lecture_file: "physics-formula-sheet.pdf",
        courseId: course3Id,
        created_at: now,
        updated_at: now,
      },
    ]);

    // ---------- Enrolments ----------
    const enrolment1Id = uuidv4();
    const enrolment2Id = uuidv4();
    const enrolment3Id = uuidv4();

    await queryInterface.bulkInsert("enrolments", [
      {
        id: enrolment1Id,
        bought_price: 49.99,
        payment_method: "stripe",
        buyer_name: "Sam Student",
        buyer_email: "sam@sharpstudy.test",
        userId: student1Id,
        courseId: course1Id,
        status: "paid",
        created_at: now,
        updated_at: now,
      },
      {
        id: enrolment2Id,
        bought_price: 54.99,
        payment_method: "stripe",
        buyer_name: "Sara Student",
        buyer_email: "sara@sharpstudy.test",
        userId: student2Id,
        courseId: course3Id,
        status: "paid",
        created_at: now,
        updated_at: now,
      },
      {
        id: enrolment3Id,
        bought_price: 39.99,
        payment_method: "stripe",
        buyer_name: "Sean Student",
        buyer_email: "sean@sharpstudy.test",
        userId: student3Id,
        courseId: course4Id,
        status: "unpaid",
        created_at: now,
        updated_at: now,
      },
    ]);

    // ---------- Favourites ----------
    await queryInterface.bulkInsert("favourites", [
      { id: uuidv4(), userId: student1Id, courseId: course2Id, created_at: now, updated_at: now },
      { id: uuidv4(), userId: student2Id, courseId: course1Id, created_at: now, updated_at: now },
      { id: uuidv4(), userId: student3Id, courseId: course3Id, created_at: now, updated_at: now },
    ]);

    // ---------- Instructor earnings ----------
    await queryInterface.bulkInsert("instructor_earnings", [
      {
        id: uuidv4(),
        earnings: 39.99,
        userId: instructor1Id,
        courseId: course1Id,
        status: "paid",
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv4(),
        earnings: 43.99,
        userId: instructor2Id,
        courseId: course3Id,
        status: "due",
        created_at: now,
        updated_at: now,
      },
    ]);

    // ---------- Course progress ----------
    await queryInterface.bulkInsert("course_progresses", [
      {
        id: uuidv4(),
        finished: true,
        userId: student1Id,
        courseId: course1Id,
        videoId: video1Id,
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv4(),
        finished: false,
        userId: student1Id,
        courseId: course1Id,
        videoId: video2Id,
        created_at: now,
        updated_at: now,
      },
    ]);

    // ---------- Quiz / Questions / Answer options ----------
    const quiz1Id = uuidv4();
    await queryInterface.bulkInsert("quizzes", [
      {
        id: quiz1Id,
        title: "Algebra Basics Quiz",
        description: "Test your understanding of algebra fundamentals.",
        slug: "algebra-basics-quiz",
        courseId: course1Id,
        userId: instructor1Id,
        created_at: now,
        updated_at: now,
      },
    ]);

    const question1Id = uuidv4();
    const question2Id = uuidv4();
    await queryInterface.bulkInsert("questions", [
      {
        id: question1Id,
        question_text: "What is the value of x in 2x + 4 = 10?",
        quizId: quiz1Id,
        created_at: now,
        updated_at: now,
      },
      {
        id: question2Id,
        question_text: "Which of the following is a linear equation?",
        quizId: quiz1Id,
        created_at: now,
        updated_at: now,
      },
    ]);

    await queryInterface.bulkInsert("answer_options", [
      { id: uuidv4(), option_text: "2", is_correct: false, questionId: question1Id, created_at: now, updated_at: now },
      { id: uuidv4(), option_text: "3", is_correct: true, questionId: question1Id, created_at: now, updated_at: now },
      { id: uuidv4(), option_text: "4", is_correct: false, questionId: question1Id, created_at: now, updated_at: now },
      { id: uuidv4(), option_text: "5", is_correct: false, questionId: question1Id, created_at: now, updated_at: now },
      { id: uuidv4(), option_text: "y = x^2 + 1", is_correct: false, questionId: question2Id, created_at: now, updated_at: now },
      { id: uuidv4(), option_text: "y = 2x + 3", is_correct: true, questionId: question2Id, created_at: now, updated_at: now },
      { id: uuidv4(), option_text: "y = 1/x", is_correct: false, questionId: question2Id, created_at: now, updated_at: now },
    ]);

    await queryInterface.bulkInsert("user_responses", [
      { id: uuidv4(), is_answered_correctly: true, enrolmentId: enrolment1Id, questionId: question1Id, created_at: now, updated_at: now },
    ]);

    // ---------- Testimonials ----------
    await queryInterface.bulkInsert("testimonials", [
      {
        id: uuidv4(),
        image_url: "testimonial-1.jpg",
        name: "Sam Student",
        designation: "College Freshman",
        description: "SharpStudy helped me finally understand algebra!",
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv4(),
        image_url: "testimonial-2.jpg",
        name: "Sara Student",
        designation: "High School Senior",
        description: "The physics course made mechanics click for me.",
        created_at: now,
        updated_at: now,
      },
    ]);

    // ---------- Partners ----------
    await queryInterface.bulkInsert("partners", [
      { id: uuidv4(), name: "EduPartner Inc.", partner_image: "partner-1.png", created_at: now, updated_at: now },
      { id: uuidv4(), name: "LearnCo", partner_image: "partner-2.png", created_at: now, updated_at: now },
    ]);

    // ---------- Subscriptions ----------
    await queryInterface.bulkInsert("subscriptions", [
      { id: uuidv4(), email: "newsletter1@sharpstudy.test", active: true, created_at: now, updated_at: now },
      { id: uuidv4(), email: "newsletter2@sharpstudy.test", active: true, created_at: now, updated_at: now },
    ]);

    // ---------- Coupons ----------
    const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    await queryInterface.bulkInsert("coupons", [
      {
        id: uuidv4(),
        code: "WELCOME10",
        discount: 10,
        exp_date: oneYearFromNow,
        status: true,
        active_for_full_site: true,
        created_at: now,
        updated_at: now,
      },
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete("coupons", null, {});
    await queryInterface.bulkDelete("subscriptions", null, {});
    await queryInterface.bulkDelete("partners", null, {});
    await queryInterface.bulkDelete("testimonials", null, {});
    await queryInterface.bulkDelete("user_responses", null, {});
    await queryInterface.bulkDelete("answer_options", null, {});
    await queryInterface.bulkDelete("questions", null, {});
    await queryInterface.bulkDelete("quizzes", null, {});
    await queryInterface.bulkDelete("course_progresses", null, {});
    await queryInterface.bulkDelete("instructor_earnings", null, {});
    await queryInterface.bulkDelete("favourites", null, {});
    await queryInterface.bulkDelete("enrolments", null, {});
    await queryInterface.bulkDelete("course_assets", null, {});
    await queryInterface.bulkDelete("videos", null, {});
    await queryInterface.bulkDelete("courses", null, {});
    await queryInterface.bulkDelete("categories", null, {});
    await queryInterface.bulkDelete("users", null, {});
  },
};
