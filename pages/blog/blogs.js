import React, { useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import Navbar from "@/components/_App/Navbar";
import PageBanner from "@/components/Common/PageBanner";
import Footer from "@/components/_App/Footer";
import { EmptyState, Button } from "@/components/ui";
import DemoBand from "@/components/FreeDemo/DemoBand";
import { blogData } from "@/utils/sampleData";
import { blogCategories, featuredPost, sortNewest } from "@/lib/blog/helpers";

// The articles come from utils/sampleData.js (there is no blog backend; route, data and article URLs are unchanged). The newest article is
// featured, the rest are listed newest first, and search and category filters run in the browser over that same list. Author is shown
// only for an article that has an `author` field (none currently do); nothing is invented here.
const PostCard = ({ blog, tag: Tag = "h2" }) => (
  <article className="ss-course-card" key={blog.id}>
    <div className="ss-course-card__media">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={blog.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
    </div>
    <div className="ss-course-card__body">
      <span className="ss-badge ss-badge--soft">{blog.category}</span>
      <Tag className="ss-course-card__title">
        <Link href={`/blog/${blog.id}`}>
          <a>{blog.title}</a>
        </Link>
      </Tag>
      <p className="ss-course-card__desc">{blog.description.slice(0, 120)}…</p>
      <div className="ss-course-card__meta">
        <span className="ss-muted">{blog.author ? `${blog.author} · ` : ""}{blog.date}</span>
      </div>
    </div>
  </article>
);

const Blogs = ({ user }) => {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const categories = useMemo(() => blogCategories(blogData), []);
  const featured = useMemo(() => featuredPost(blogData), []);
  const filtering = q.trim() !== "" || category !== "";
  const posts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sortNewest(blogData).filter((b) => (!category || b.category === category) && (!needle || `${b.title} ${b.description} ${b.category}`.toLowerCase().includes(needle)));
  }, [q, category]);
  const showFeatured = !filtering && featured;
  const list = showFeatured ? posts.filter((b) => b.id !== featured.id) : posts;

  return (
    <>
      <Head>
        <title>Blog | SharpStudy</title>
        <meta name="description" content="Ideas, stories and inspiration from the SharpStudy community." />
      </Head>
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
            {showFeatured && (
              <article className="ss-featured" aria-labelledby="featured-title">
                <div className="ss-featured__media">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={featured.image} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                </div>
                <div className="ss-featured__body">
                  <span className="ss-eyebrow">Featured article</span>
                  <h2 id="featured-title">
                    <Link href={`/blog/${featured.id}`}>
                      <a>{featured.title}</a>
                    </Link>
                  </h2>
                  <div className="ss-article__meta">
                    <span className="ss-badge ss-badge--soft">{featured.category}</span>
                    <span className="ss-muted">{featured.author ? `${featured.author} · ` : ""}{featured.date}</span>
                  </div>
                  <p>{featured.description.slice(0, 220)}…</p>
                  <Button href={`/blog/${featured.id}`} iconRight="ri-arrow-right-line">
                    Read article
                  </Button>
                </div>
              </article>
            )}

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
              <>
                {showFeatured && list.length > 0 && <h2 className="ss-sectiontitle">Latest posts</h2>}
                <div className="ss-grid ss-grid--cards">
                  {list.map((blog) => (
                    <PostCard key={blog.id} blog={blog} tag={showFeatured ? "h3" : "h2"} />
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
        <DemoBand source="blog_cta" title="Learning something new?" text="Book a free demo class and try SharpStudy for yourself." />
      </main>

      <Footer />
    </>
  );
};

export default Blogs;
