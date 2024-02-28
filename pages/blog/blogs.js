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
      <PageBanner
        pageTitle="Blogs"
        homePageUrl="/"
        homePageText="Home"
        activePageText="Active Blogs"
      />
      <div className="courses-area ptb-100">
        <div className="container">
          <div className="row justify-content-center">
            {blogData.map((blog) => (
              <div className="col-lg-3 col-md-6" key={blog.id}>
                <div className="single-courses">
                  <div
                    className="courses-main-img"
                    style={{ maxHeight: "200px" }}
                  >
                    <img
                      src={blog.image}
                      alt={blog.title}
                      style={{
                        height: "190px",
                        width: "100%",
                        objectFit: "cover",
                      }}
                    />
                  </div>
                  <div className="courses-content">
                    <Link href={`/blog/${blog.id}`}>
                      <a>{blog.title}</a>
                    </Link>

                    <ul className="admin pt-2">
                      <li>
                        <img
                          src="/images/testimonials/testimonial-1.png"
                          className="rounded-circle"
                          alt="user_image"
                          style={{
                            height: "25px",
                            width: "25px",
                          }}
                        />
                      </li>
                      <li>
                        <span>By</span>
                      </li>
                      <li>Admin</li>
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Footer />
    </>
  );
};

export default Blogs;
