import React from "react";
import Navbar from "@/components/_App/Navbar";
import PageBanner from "@/components/Common/PageBanner";
import Footer from "@/components/_App/Footer";

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
      <p>This is the blog pag</p>

      <Footer />
    </>
  );
};

export default Blogs;
