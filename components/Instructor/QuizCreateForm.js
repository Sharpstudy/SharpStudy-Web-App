import React, { useState } from "react";
import toast from "react-hot-toast";
import Button from "@/utils/Button";
import axios from "axios";

const QuizCreateForm = () => {
  const [question, setQuestion] = useState("");
  const [correct_answer, setCorrectAnsw] = useState("");
  const [answer1, setAnswer1] = useState("");
  const [answer2, setAnswer2] = useState("");
  const [answer3, setAnswer3] = useState("");
  const [answer4, setAnswer4] = useState("");

  const submitQuestion = () => {
    alert("question is successfully added to database");
  };

  const qfrom = {
    width: "60%",
    padding: "2vw",
  };
  return (
    <div className="d-flex align-items-center justify-content-center">
      <div style={qfrom}>
        <h2>Add question associated to the course</h2>
        <p>Note: fill in carefully (you should follow exact case of answers)</p>
        <label htmlFor="question">Enter question:</label> <br />
        <input
          type="text"
          name="question"
          className="form-control"
          placeholder="Enter question"
          onChange={(e) => {
            setQuestion(e.target.value);
          }}
        />
        <br />
        <hr></hr>
        <label htmlFor="question">Enter Answer:</label> <br />
        <input
          type="text"
          name="answers"
          className="form-control"
          placeholder="Enter  answer1"
          onChange={(e) => {
            setAnswer1(e.target.value);
          }}
        />{" "}
        <br />
        <input
          type="text"
          name="answers"
          className="form-control"
          placeholder="Enter answer2"
          onChange={(e) => {
            setAnswer2(e.target.value);
          }}
        />{" "}
        <br />
        <input
          type="text"
          name="answers"
          className="form-control"
          placeholder="Enter answer3"
          onChange={(e) => {
            setAnswer3(e.target.value);
          }}
        />{" "}
        <br />
        <input
          type="text"
          name="answers"
          className="form-control"
          placeholder="Enter  answer4"
          onChange={(e) => {
            setAnswer4(e.target.value);
          }}
        />
        <br />
        <hr></hr>
        <label htmlFor="correct_answer">Enter correct answer:</label> <br />
        <input
          type="text"
          name="correct_answer"
          className="form-control"
          placeholder="Enter correct answer"
          onChange={(e) => {
            setCorrectAnsw(e.target.value);
          }}
        />
        <div className="d-flex align-items-center justify-content-center mt-5">
          <Button
            btnText="Add Qestion"
            btnClass="default-btn"
            onClick={() => {
              submitQuestion();
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default QuizCreateForm;
