import React from "react";
import InstructorLayout from "@/components/Instructor/InstructorLayout";
import CourseCreateForm from "@/components/Instructor/CourseCreateForm";

const Create = ({ user }) => {
  return (
    <>
      <InstructorLayout
        user={user}
        title="Create a course"
        description="Fill in the details below. You can upload videos and assets once the course is created."
      >
        <div className="ss-card ss-form-card">
          <div className="create-course-form">
            <CourseCreateForm />
          </div>
        </div>
      </InstructorLayout>
    </>
  );
};

export default Create;
