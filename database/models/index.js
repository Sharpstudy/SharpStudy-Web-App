import User from "./user";
import Category from "./category";
import Course from "./course";
import Video from "./video";
import Favourite from "./favourite";
import Enrolment from "./enrolment";
import Instructor_Earning from "./instructor_earning";
import Course_Progress from "./course_progress";
import Course_Asset from "./course_asset";
import Quiz from "./quiz";
import Question from "./question";
import Answer_Option from "./answer_option";
import User_Response from "./user_response"

User.hasMany(Course, { foreignKey: "userId", as: "courses" });
Course.belongsTo(User, { foreignKey: "userId", as: "user" });

Category.hasMany(Course, { foreignKey: "catId", as: "courses" });
Course.belongsTo(Category, { foreignKey: "catId", as: "category" });

Course.hasMany(Video, { foreignKey: "courseId", as: "videos" });
Video.belongsTo(Course, { foreignKey: "courseId", as: "course" });

User.hasMany(Video, { foreignKey: "userId", as: "videos" });
Video.belongsTo(User, { foreignKey: "userId", as: "user" });

User.hasMany(Favourite, { foreignKey: "userId", as: "favourites" });
Favourite.belongsTo(User, { foreignKey: "userId", as: "user" });

Course.hasMany(Favourite, { foreignKey: "courseId", as: "favourites" });
Favourite.belongsTo(Course, { foreignKey: "courseId", as: "course" });

User.hasMany(Enrolment, { foreignKey: "userId", as: "enrolments" });
Enrolment.belongsTo(User, { foreignKey: "userId", as: "user" });

Course.hasMany(Enrolment, { foreignKey: "courseId", as: "enrolments" });
Enrolment.belongsTo(Course, { foreignKey: "courseId", as: "course" });

Course.hasMany(Course_Asset, { foreignKey: "courseId", as: "assets" });
Course_Asset.belongsTo(Course, { foreignKey: "courseId", as: "course" });

User.hasMany(Instructor_Earning, {
  foreignKey: "userId",
  as: "instructor_earnings",
});
Instructor_Earning.belongsTo(User, { foreignKey: "userId", as: "user" });

Course.hasMany(Instructor_Earning, {
  foreignKey: "courseId",
  as: "instructor_earnings",
});
Instructor_Earning.belongsTo(Course, { foreignKey: "courseId", as: "course" });

User.hasMany(Course_Progress, {
  foreignKey: "userId",
  as: "course_progresses",
});
Course_Progress.belongsTo(User, { foreignKey: "userId", as: "user" });

Course.hasMany(Course_Progress, {
  foreignKey: "courseId",
  as: "course_progresses",
});
Course_Progress.belongsTo(Course, { foreignKey: "courseId", as: "course" });

Video.hasMany(Course_Progress, {
  foreignKey: "videoId",
  as: "course_progresses",
});
Course_Progress.belongsTo(Video, { foreignKey: "videoId", as: "video" });

Course.hasMany(Quiz, { foreignKey: "courseId", as: "quizzes" });
Quiz.belongsTo(Course, { foreignKey: "courseId", as: "course" });

Quiz.hasMany(Question, { foreignKey: "quizId", as: "questions" });
Question.belongsTo(Quiz, { foreignKey: "quizId", as: "quiz" });

Question.hasMany(Answer_Option, { foreignKey: "questionId", as: "answer_options" });
Answer_Option.belongsTo(Question, { foreignKey: "questionId", as: "question" });

Question.hasMany(User_Response, { foreignKey: "questionId", as: "user_responses" });
User_Response.belongsTo(Question, { foreignKey: "questionId", as: "question" });

// Enrolment.hasMany(Quiz, { as: 'quizzes', foreignKey: 'courseId', sourceKey: 'courseId' });

// // Question and Quiz association
// // Question.belongsTo(Quiz, { as: 'quiz', foreignKey: 'quizId' });

// Question.belongsTo(Quiz, { as: 'quiz', foreignKey: 'quizId' });
// // Quiz.hasMany(Question, { as: 'quizQuestions', foreignKey: 'quizId' });

// Question.hasMany(Answer_Option, { as: 'questionAnswers', foreignKey: 'questionId' });
// Quiz.belongsTo(Enrolment, { as: 'enrolment_course_quiz', foreignKey: 'courseId', targetKey: 'courseId' });

// // Quiz and Enrolment association with a unique alias
// // Quiz.belongsTo(Enrolment, { as: 'enrolmentQuiz', foreignKey: 'courseId', targetKey: 'courseId' });

// Unique association alias for handling post requests
Enrolment.hasMany(Quiz, { as: 'enrolment_quizzes', foreignKey: 'courseId', sourceKey: 'courseId' });
Quiz.belongsTo(Enrolment, { as: 'enrolment_course_quiz', foreignKey: 'courseId', targetKey: 'courseId' });

export {
  User,
  Course,
  Category,
  Video,
  Favourite,
  Enrolment,
  Instructor_Earning,
  Course_Progress,
  Course_Asset,
  Quiz,
  Question,
  Answer_Option,
  User_Response,
};
