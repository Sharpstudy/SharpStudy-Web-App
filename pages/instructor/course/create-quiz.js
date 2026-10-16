import React from "react";
import InstructorLayout from "@/components/Instructor/InstructorLayout";
import QuizCreateForm from "@/components/Instructor/QuizCreateForm";

const NewQuiz = ({ user }) => {
  return (
    <>
      <InstructorLayout
        user={user}
        title="Create a quiz"
        description="Add questions and answers for one of your courses."
      >
        <div className="ss-card ss-form-card">
          <div className="create-course-form">
            <QuizCreateForm />
          </div>
        </div>
      </InstructorLayout>
    </>
  );
};

export default NewQuiz;
