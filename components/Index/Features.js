import React from "react";

const Features = () => {
  return (
    <div className="our-features-area bg-color-f1efee pt-100 pb-70">
      <div className="container">
        <div className="section-title">
          <span className="top-title">Our Features</span>
          <h2>Why You Should Choose Sharpstudy</h2>
        </div>

        <div className="row justify-content-center">
          <div className="col-lg-3 col-sm-6">
            <div className="single-features">
              <img
                src="/images/features/feature-1.svg"
                alt="feature"
              />
              <h3>Project Based Learning</h3>
              <p>
              Experience immersive education where real-world challenges inspire innovation and hands-on learning.
              </p>
            </div>
          </div>

          <div className="col-lg-3 col-sm-6">
            <div className="single-features">
              <img
                src="/images/features/feature-2.svg"
                alt="feature"
              />
              <h3>Adaptive Learning</h3>
              <p>
              Tailored learning roadmaps designed to align with each student's unique capabilities and educational background.
              </p>
            </div>
          </div>

          <div className="col-lg-3 col-sm-6 ">
            <div className="single-features">
              <img
                src="/images/features/feature-3.svg"
                alt="feature"
              />
              <h3>Microlearning</h3>
              <p>
              Engaging, concise training modules designed to captivate learners with ongoing micro lessons.
              </p>
            </div>
          </div>

          <div className="col-lg-3 col-sm-6">
            <div className="single-features">
              <img
                src="/images/features/feature-4.svg"
                alt="feature"
              />
              <h3>Gamify learning</h3>

              <p>
              Use leaderboards and contests to motivate learners, enhance team building, and drive performance!
              </p>
            </div>
          </div>
        </div>
      </div>

      <img
        src="/images/features/feature-shape-1.svg"
        className="shape shape-1"
        alt="feature"
      />
    </div>
  );
};

export default Features;
