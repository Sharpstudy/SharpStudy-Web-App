import React from "react";
import PageBanner from "@/components/Common/PageBanner";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";

const termsConditions = ({ user }) => {
  return (
    <>
      <Navbar user={user} />
      <PageBanner
        pageTitle="Terms & Conditions"
        homePageUrl="/"
        homePageText="Home"
        activePageText="Terms & Conditions"
      />
      <section className="ptb-100">
        <div className="container">
          <div className="main-content-text">
            <p>
              These terms and conditions (Terms) govern your use of SharpStudy
              elearning Platform , operated by SharpStudy. <br /> By accessing
              or using the Website, you agree to be bound by these Terms. If you
              disagree with any part of these Terms, you may not access the
              Website.
            </p>
            <h2 className="ss-legal-h">1. Use of the Website</h2>
            <p>
              1.1 <strong>Eligibility:</strong> By using the Website, you affirm
              that you are at least 18 years of age or have obtained
              parental/guardian consent to use the Website. <br />
              1.2 <strong>License:</strong> We grant you a limited,
              non-exclusive, non-transferable, and revocable license to use the
              Website for its intended purpose. <br /> 1.3{" "}
              <strong>User Account</strong>: You may be required to create a
              user account. You are responsible for maintaining the
              confidentiality of your account information and for all activities
              that occur under your account
            </p>

            <div className="gap-20"></div>

            <h2 className="ss-legal-h">2. Content</h2>
            <p>
              2.1 <strong>Ownership :</strong> All content on the Website,
              including but not limited to text, graphics, logos, images, audio
              clips, and software, is owned or licensed by us and is subject to
              copyright and other intellectual property rights. <br /> 2.2{" "}
              <strong>User-Generated Content: </strong> If you submit any
              content to the Website, you grant us a worldwide, irrevocable,
              perpetual, royalty-free license to use, modify, publish, adapt,
              translate, distribute, and display such content
            </p>

            <div className="gap-20"></div>

            <h2 className="ss-legal-h">3. Prohibited Conduct</h2>
            <p>
              You agree not to: <br />
              3.1 Use the Website in any way that violates applicable laws or
              regulations.
              <br />
              3.2 IEngage in any activity that disrupts or interferes with the
              Website or servers.
              <br />
              3.3 Attempt to gain unauthorized access to any part of the
              Website.
            </p>

            <div className="gap-20"></div>

            <h2 className="ss-legal-h">4. Privacy</h2>
            <p>
              Our Privacy Policy governs the collection, use, and disclosure of
              your personal information. By using the Website, you consent to
              the terms of our Privacy Policy.
            </p>

            <div className="gap-20"></div>

            <h2 className="ss-legal-h">5. Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by law, we shall not be liable for
              any indirect, incidental, special, consequential, or punitive
              damages arising out of or in connection with your use of the
              Website.
            </p>

            <div className="gap-20"></div>

            <h2 className="ss-legal-h">6. Termination</h2>
            <p>
              We reserve the right to terminate or suspend access to the Website
              immediately, without prior notice or liability, for any reason
              whatsoever.
            </p>
            <h2 className="ss-legal-h">7. Changes to Terms</h2>
            <p>
              We reserve the right to modify or replace these Terms at any time.
              Your continued use of the Website after any such changes
              constitute your acceptance of the new Terms.
            </p>
            <h2 className="ss-legal-h">8. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with
              the applicable laws.
            </p>
            <h2 className="ss-legal-h">9. Contact Us</h2>
            <p>
              If you have any questions about these Terms, please contact us at
              hello@sharpstudy.io.
            </p>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
};

export default termsConditions;
