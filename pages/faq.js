import React from "react";
import Navbar from "@/components/_App/Navbar";
import PageBanner from "../components/Common/PageBanner";
import FaqList from "@/components/Common/FaqList";
import Footer from "@/components/_App/Footer";
import Business from "@/components/Index/Business";

export default function FAQPage({ user }) {
  return (
    <>
      <Navbar user={user} />

      <PageBanner
        pageTitle="Frequently Asked Questions"
        homePageUrl="/"
        homePageText="Home"
        activePageText="Frequently asked questions"
      />

      <section className="ss-section ss-section--tight">
        <div className="ss-container ss-faq-wrap">
          <FaqList headingLevel={2} />
        </div>
      </section>
      <Business />

      <Footer />
    </>
  );
}
