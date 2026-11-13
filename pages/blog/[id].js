import React from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { DiscussionEmbed } from "disqus-react";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import PageBanner from "@/components/Common/PageBanner";
import { EmptyState, Button } from "@/components/ui";
import { blogData } from "@/utils/sampleData";

// Article layout. Content still comes from utils/sampleData.js; the Disqus comments embed is unchanged.
const SingleBlog = ({ user }) => {
  const router = useRouter();
  const { id } = router.query;
  const blog = blogData.find((b) => b.id === id);

  if (!blog) {
    return (
      <>
        <Navbar user={user} />
        <main className="ss-container ss-student">
          <EmptyState icon="ri-article-line" title="Article not found" description="That article does not exist or was moved." action={<Button href="/blog/blogs/">All articles</Button>} />
        </main>
        <Footer />
      </>
    );
  }

  const more = blogData.filter((b) => b.id !== blog.id).slice(0, 3);
  return (
    <>
      <Navbar user={user} />
      <main>
        <PageBanner pageTitle={blog.title} homePageUrl="/blog/blogs/" homePageText="Blog" activePageText={blog.title} />
        <section className="ss-section ss-section--tight">
          <div className="ss-container">
            <article className="ss-article">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="ss-article__cover" src={blog.image} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              <div className="ss-article__meta">
                <span className="ss-badge ss-badge--soft">{blog.category}</span>
                <span className="ss-muted">{blog.date}</span>
              </div>
              <h2>{blog.title}</h2>
              <p>{blog.description}</p>
            </article>

            <DiscussionEmbed
              shortname="https-sharpstudy-io"
              config={{
                url: "https://https-sharpstudy-io.disqus.com/embed.js",
                identifier: blog.id,
                title: blog.title,
                language: "en_US",
              }}
            />

            <h2 className="ss-sectiontitle">More to read</h2>
            <div className="ss-grid ss-grid--cards">
              {more.map((item) => (
                <article className="ss-course-card" key={item.id}>
                  <div className="ss-course-card__media">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  </div>
                  <div className="ss-course-card__body">
                    <h3 className="ss-course-card__title">
                      <Link href={`/blog/${item.id}`}>
                        <a>{item.title}</a>
                      </Link>
                    </h3>
                    <span className="ss-muted">{item.date}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
};

export default SingleBlog;
