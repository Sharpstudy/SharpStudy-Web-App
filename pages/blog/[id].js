import React, { useState } from "react";
import { useRouter } from "next/router";
import Navbar from "@/components/_App/Navbar";
import PageBanner from "@/components/Common/PageBanner";
import { blogData } from "@/utils/sampleData";
import Link from "next/link";

const SingleBlog = ({ user }) => {
  const router = useRouter();
  const { id } = router.query;

  const blog = blogData.find((blog) => blog.id === id);

  if (!blog) return <div>Blog not found</div>;

  return (
    <>
      <Navbar user={user} />
      <PageBanner
        pageTitle="Blogs"
        homePageUrl="/"
        homePageText="Home"
        activePageText={blog.title}
      />
      <section className="section blog-wrap bg-gray pt-100">
        <div className="container">
          <div className="row">
            <div className="col-lg-8">
              <div className="row">
                <div className="col-lg-12 mb-5">
                  <div className="single-blog-item">
                    <img
                      src={blog.image}
                      alt={blog.title}
                      className="img-fluid rounded"
                      style={{ width: "100%", objectFit: "cover" }}
                    />
                    <div className="blog-item-content bg-white p-5">
                      <div className="blog-item-meta bg-gray py-1 px-2">
                        <span className="text-muted text-capitalize mr-3">
                          <i className="ti-pencil-alt mr-2" />
                          {blog.category}
                        </span>
                      </div>
                      <h2 className="mt-3 mb-4">
                        <a href="blog-single.html">{blog.title}</a>
                      </h2>
                      <p>{blog.description}</p>
                      <div className="tag-option mt-5 clearfix">
                        <ul className="float-left list-inline">
                          <li>Tags:</li>
                          <li className="list-inline-item">
                            <a href="#" rel="tag">
                              {blog.category}
                            </a>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="col-lg-4">
              <div className="sidebar-wrap">
                <div className="sidebar-widget latest-post card border-0 p-4 mb-3">
                  <h5>Latest Posts</h5>
                  {blogData.slice(0, 3).map((item) => (
                    <div className="media border-bottom py-3" key={item.id}>
                      <a href="#">
                        <img className="mr-4" src={item.image} alt />
                      </a>
                      <div className="media-body">
                        <h6 className="my-2">
                          <Link href={`/blog/${item.id}`}>
                            <a>{item.title}</a>
                          </Link>
                        </h6>
                        <span className="text-sm text-muted">{item.date}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default SingleBlog;
