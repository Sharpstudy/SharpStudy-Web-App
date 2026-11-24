import React from "react";
import InstructorLayout from "@/components/Instructor/InstructorLayout";
import CourseCreateForm from "@/components/Instructor/CourseCreateForm";

const Create = ({ user }) => {
  return (
    <>
      <InstructorLayout
        user={user}
        title="Create a class room"
        description="Set up a live class course that students join over video."
      >
        <div className="ss-card ss-form-card">
          <div className="create-course-form">
            <CourseCreateForm btnText="Create Class Room" is_class={true} />
          </div>
        </div>
      </InstructorLayout>
    </>
  );
};

export default Create;
