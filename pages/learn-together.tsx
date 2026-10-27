import React from "react";
import Head from "next/head";
import Link from "next/link";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import s from "@/learn-together/client/lt.module.scss";

const FEATURES = [
  {
    icon: "⏱️",
    title: "You get a 5 minute Prep-Boy!",
    body: "Before every lesson, a quick prep brief tells you exactly what to say and do. No research, no planning.",
  },
  {
    icon: "🤝",
    title: "Teach it together",
    body: "Structured scripts guide you through each concept. You stay in charge; we make sure you're brilliant.",
  },
  {
    icon: "✨",
    title: "Daily Spark makes it stick",
    body: "A 5–10 minute daily activity keeps learning alive between sessions. Easy enough to fit any day.",
  },
];

const VALUES = [
  "Academics", "Creativity", "Faith", "Honesty", "Kindness",
  "Perseverance", "Responsibility", "Service",
];

export default function LearnTogetherLanding({ user }: { user?: unknown }) {
  return (
    <>
      <Head>
        <title>Learn Together · Sharp Study</title>
        <meta name="description" content="Parent-led homeschooling shaped by your family values. Every lesson in 8 minutes." />
      </Head>
      <Navbar user={user} />

      <main id="main">
        <div className="container" style={{ padding: "40px 16px 80px" }}>

          {/* Hero */}
          <div className={s.landingHero}>
            <h1>Your values. Your kids.<br />You teach – we make you great at it.</h1>
            <p>
              Parent-led homeschooling for ages 6–8. Every lesson in 8 minutes –
              shaped by your family values. No lesson plans.
            </p>
            <div className={s.landingHeroBtns}>
              <Link href="/learn/onboarding">
                <a className={s.btn}>Start your Family Blueprint</a>
              </Link>
              <a href="#how-it-works" className={s.btnGhost} style={{ color: "#fff", borderColor: "rgba(255,255,255,0.7)" }}>
                See how it works
              </a>
            </div>
          </div>

          {/* Feature cards */}
          <section id="how-it-works" aria-labelledby="feat-h">
            <h2 id="feat-h" style={{ textAlign: "center", fontSize: 28, fontWeight: 700, marginBottom: 24 }}>
              Learn first. Teach together. Let it stick.
            </h2>
            <div className={s.featureCards}>
              {FEATURES.map((f) => (
                <div key={f.title} className={s.featureCard}>
                  <span className="icon">{f.icon}</span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Faith / heritage section */}
          <div className={s.faithSection}>
            <h2>Faith-based or secular. Every heritage. Every home language.</h2>
            <p>
              During your Family Blueprint, you choose which values matter most at home.
              Learn Together shapes every lesson and Daily Spark around those priorities —
              without you having to search for anything.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 20 }}>
              {VALUES.map((v) => (
                <span key={v} className={s.chip}>{v}</span>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
              Ready to build your Family Blueprint?
            </h2>
            <p className={s.muted} style={{ marginBottom: 20 }}>
              Takes 5 minutes. Shapes every lesson after that.
            </p>
            <Link href="/learn/onboarding">
              <a className={s.btn} style={{ fontSize: 18, padding: "14px 36px" }}>
                Start your Family Blueprint
              </a>
            </Link>
          </div>

        </div>
      </main>

      <Footer />
    </>
  );
}

export async function getServerSideProps() {
  return { props: {} };
}
