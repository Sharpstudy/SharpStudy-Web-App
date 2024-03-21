import React, { useState } from "react";

const QuizCreateForm = () => {
  const [numSteps, setNumSteps] = useState(0);
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState([]);

  console.log(formData, "Form Data: ");

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log("Form Data:", formData);
    window.alert("Form submitted");
    setFormData([]);
    setNumSteps(0);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
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
    } else if (type === "checkbox") {
      if (!updatedFormData[index].correctAnswers) {
        updatedFormData[index].correctAnswers = [];
      }
      if (checked) {
        updatedFormData[index].correctAnswers.push(value);
      } else {
        const indexToRemove =
          updatedFormData[index].correctAnswers.indexOf(value);
        if (indexToRemove !== -1) {
          updatedFormData[index].correctAnswers.splice(indexToRemove, 1);
        }
      }
    } else if (name === "type") {
      // Handle type select input
      updatedFormData[index] = {
        ...updatedFormData[index],
        [name]: value,
      };
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
    const currentFormData = formData[step - 1];

    setFormData([]);
    const updatedFormData = new Array(numSteps).fill({}).map((_, index) => {
      if (index === step - 1) {
        return currentFormData || {};
      }
      return {};
    });
    setFormData(updatedFormData);
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

  const color = {
    color: " #286bad",
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
        <form onSubmit={step === numSteps ? handleSubmit : undefined}>
          <div className="d-flex align-items-center justify-content-center">
            <div style={qfrom}>
              <h2>
                You are about to add {numSteps} questions associated with the
                course
              </h2>
              <h3 style={color}>step: {step}</h3>
              <p>
                Note: fill in carefully (you should follow the exact case of
                answers)
              </p>
              <label htmlFor="question">Enter question:</label> <br />
              <input
                type="text"
                name="question"
                className="form-control"
                placeholder="Enter question"
                value={formData[step - 1]?.question || ""}
                onChange={handleChange}
              />
              <br />
              <hr></hr>
              <label htmlFor="answer1">Enter Answers:</label> <br />
              {[1, 2, 3, 4].map((num) => (
                <div key={num}>
                  <input
                    type="text"
                    name={`choices_${num}`}
                    className="form-control"
                    placeholder={`Enter answer${num}`}
                    value={
                      (formData[step - 1]?.choices &&
                        formData[step - 1]?.choices[num - 1]) ||
                      ""
                    }
                    onChange={handleChange}
                  />
                  <br />
                </div>
              ))}
              <div className="d-flex align-items-center justify-content-center">
                <div className="form-group">
                  <label className="form-label fw-semibold">Quiz Image</label>
                  <input
                    type="file"
                    className="form-control file-control"
                    name="image"
                  />
                </div>
              </div>
              <label htmlFor="type">Enter answers type:</label> <br />
              <select
                className="form-control"
                name="type"
                value={formData[step - 1]?.type || ""}
              >
                <option value="">Select</option>
                <option value="radio">Radio</option>
                <option value="checkbox">CheckBox</option>
                <option value="dropdown">Dropdown</option>
                <option value="multiselect">Multiselect</option>
              </select>
              <hr></hr>
              <label htmlFor="correctAnswer">Select correct answer(s):</label>
              <br />
              {formData[step - 1]?.choices &&
                formData[step - 1]?.choices.map((choice, index) => (
                  <div key={index}>
                    <input
                      type="checkbox"
                      name="correctAnswers"
                      className="form-check-input"
                      value={choice}
                      checked={
                        formData[step - 1]?.correctAnswers &&
                        formData[step - 1]?.correctAnswers.includes(choice)
                      }
                      onChange={handleChange}
                    />
                    <span
                      style={{
                        paddingLeft: "5px",
                      }}
                    >
                      {choice}
                    </span>
                    <br />
                  </div>
                ))}
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
                <button
                  className="default-btn"
                  type={step === numSteps ? "submit" : "button"}
                  onClick={step !== numSteps && handleNext}
                >
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
