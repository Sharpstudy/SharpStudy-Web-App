import React, { useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/_App/Navbar";
import PageBanner from "@/components/Common/PageBanner";
import Footer from "@/components/_App/Footer";
import { EmptyState, Button } from "@/components/ui";
import { blogData } from "@/utils/sampleData";

// The articles come from utils/sampleData.js (there is no blog backend). Search and category filters run
// in the browser over that same list; nothing is added or invented here.
const Blogs = ({ user }) => {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const categories = useMemo(() => [...new Set(blogData.map((b) => b.category))], []);
  const posts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return blogData.filter((b) => (!category || b.category === category) && (!needle || `${b.title} ${b.description} ${b.category}`.toLowerCase().includes(needle)));
  }, [q, category]);

  return (
    <>
      <Navbar user={user} />
      <main>
        <PageBanner
          pageTitle="Blogs"
          homePageUrl="/"
          homePageText="Home"
          activePageText="Learning blog"
          description="Ideas, stories and inspiration from the SharpStudy community."
        />
        <section className="ss-section ss-section--tight">
          <div className="ss-container ss-container--wide">
            <div className="ss-blogbar">
              <ul className="ss-blogcats" aria-label="Blog categories">
                <li>
                  <button type="button" aria-pressed={category === ""} onClick={() => setCategory("")}>
                    All
                  </button>
                </li>
                {categories.map((c) => (
                  <li key={c}>
                    <button type="button" aria-pressed={category === c} onClick={() => setCategory(c)}>
                      {c}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="ss-filter">
                <label htmlFor="blog-q" className="visually-hidden">
                  Search articles
                </label>
                <input id="blog-q" type="search" value={q} placeholder="Search articles" maxLength={80} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
            <p className="ss-resultline" role="status" aria-live="polite">
              {posts.length} article{posts.length === 1 ? "" : "s"}
            </p>
            {posts.length === 0 ? (
              <EmptyState
                icon="ri-article-line"
                title="No articles match"
                description="Try a different word or category."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQ("");
                      setCategory("");
                    }}
                  >
                    Show all articles
                  </Button>
                }
              />
            ) : (
              <div className="ss-grid ss-grid--cards">
                {posts.map((blog) => (
                  <article className="ss-course-card" key={blog.id}>
                    <div className="ss-course-card__media">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={blog.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    </div>
                    <div className="ss-course-card__body">
                      <span className="ss-badge ss-badge--soft">{blog.category}</span>
                      <h2 className="ss-course-card__title">
                        <Link href={`/blog/${blog.id}`}>
                          <a>{blog.title}</a>
                        </Link>
                      </h2>
                      <p className="ss-course-card__desc">{blog.description.slice(0, 120)}…</p>
                      <div className="ss-course-card__meta">
                        <span className="ss-muted">{blog.date}</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
};

export default Blogs;
