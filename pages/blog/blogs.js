import React from "react";
import Navbar from "@/components/_App/Navbar";
import PageBanner from "@/components/Common/PageBanner";
import Footer from "@/components/_App/Footer";
import Link from "next/link";
import { blogData } from "@/utils/sampleData";

const Blogs = ({ user }) => {
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
            <div className="ss-grid ss-grid--cards">
              {blogData.map((blog) => (
                <article className="ss-course-card" key={blog.id}>
                  <div className="ss-course-card__media">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={blog.image} alt="" loading="lazy" />
                  </div>
                  <div className="ss-course-card__body">
                    <h2 className="ss-course-card__title">
                      <Link href={`/blog/${blog.id}`}>
                        <a>{blog.title}</a>
                      </Link>
                    </h2>
                    <div className="ss-course-card__meta">
                      <span className="ss-course-card__author">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="ss-avatar ss-avatar--sm"
                          src="/images/testimonials/testimonial-1.png"
                          alt=""
                        />
                        By Admin
                      </span>
                    </div>
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

export default Blogs;
