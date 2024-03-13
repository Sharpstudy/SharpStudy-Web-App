import React, { useState } from "react";
import Button from "@/utils/Button";

const QuizCreateForm = () => {
  const [numSteps, setNumSteps] = useState(0);
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState([]);

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log("Form Data:", formData);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    const index = step - 1;
    const updatedFormData = [...formData];

    if (!updatedFormData[index]) {
      updatedFormData[index] = { choices: [] };
    }

    if (name.startsWith("choices_")) {
      const choiceIndex = parseInt(name.split("_")[1], 10) - 1;
      if (!updatedFormData[index].choices) {
        updatedFormData[index].choices = [];
      }

      while (updatedFormData[index].choices.length < choiceIndex + 1) {
        updatedFormData[index].choices.push("");
      }

      updatedFormData[index].choices[choiceIndex] = value;
    } else {
      updatedFormData[index] = { ...updatedFormData[index], [name]: value };
    }

    setFormData(updatedFormData);
  };

  const handleNumStepsChange = (e) => {
    const value = e.target.value.trim();
    if (!value || isNaN(value)) {
      setNumSteps(0);
      setFormData([]);
    } else {
      const intValue = parseInt(value, 10);
      setNumSteps(intValue);
      setFormData(new Array(intValue).fill({}));
      if (step > intValue) {
        setStep(1);
      }
    }
  };

  const handleNext = (e) => {
    e.preventDefault();
    if (step < numSteps) {
      setStep(step + 1);
    }
  };

  const handlePrev = (e) => {
    e.preventDefault();
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const qfrom = {
    width: "60%",
    padding: "2vw",
  };

  return (
    <>
      <div className="d-flex align-items-center justify-content-center">
        <div style={qfrom}>
          <label htmlFor="numSteps question">Number of Questions:</label>
          <input
            type="number"
            id="numSteps"
            className="form-control"
            value={numSteps}
            onChange={handleNumStepsChange}
          />
        </div>
      </div>
      {step <= numSteps && (
        <form onSubmit={step === numSteps ? handleSubmit : handleNext}>
          <div className="d-flex align-items-center justify-content-center">
            <div style={qfrom}>
              <h2>
                You are about to add {numSteps} questions associated to the
                course
              </h2>
              <p>
                Note: fill in carefully (you should follow exact case of
                answers)
              </p>
              <label htmlFor="question">Enter question:</label> <br />
              <input
                type="text"
                name="question"
                className="form-control"
                placeholder="Enter question"
                onChange={handleChange}
              />
              <br />
              <hr></hr>
              <label htmlFor="answer1">Enter Answer:</label> <br />
              <input
                type="text"
                name="choices_1"
                className="form-control"
                placeholder="Enter answer1"
                onChange={handleChange}
              />{" "}
              <br />
              <input
                type="text"
                name="choices_2"
                className="form-control"
                placeholder="Enter answer2"
                onChange={handleChange}
              />{" "}
              <br />
              <input
                type="text"
                name="choices_3"
                className="form-control"
                placeholder="Enter answer3"
                onChange={handleChange}
              />{" "}
              <br />
              <input
                type="text"
                name="choices_4"
                className="form-control"
                placeholder="Enter answer4"
                onChange={handleChange}
              />
              <br />
              <hr></hr>
              <label htmlFor="correctAnswer">Enter correct answer:</label>{" "}
              <br />
              <input
                type="text"
                name="correctAnswer"
                className="form-control"
                placeholder="Enter correct answer"
                onChange={handleChange}
              />
              <div className="d-flex align-items-center justify-content-center mt-5">
                {step > 1 && (
                  <button
                    className="default-btn mr-15"
                    type="button"
                    onClick={handlePrev}
                  >
                    Previous
                  </button>
                )}
                <button className="default-btn" type="submit">
                  {step === numSteps ? "Submit" : "Next"}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}
    </>
  );
};

export default QuizCreateForm;
