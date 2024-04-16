import React from "react";
import PageBanner from "@/components/Common/PageBanner";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";

const privacyPolicy = ({ user }) => {
  return (
    <>
      <Navbar user={user} />
      <PageBanner
        pageTitle='Privacy Policy'
        homePageUrl='/'
        homePageText='Home'
        activePageText='Privacy Policy'
      />

      <section className='ptb-100'>
        <div className='container'>
          <div className='main-content-text'>
            <div className='gap-20'></div>
            <h3>Information We Collect:</h3>
            <p>
              {" "}
              <strong>Personal Information:</strong> We may collect personal
              information such as names, email addresses, and other contact
              details when users register for an account, subscribe to our
              newsletter, or engage in other activities on our Site.
            </p>
            <p>
              <strong>Usage Information:</strong> We automatically collect
              certain information about how users interact with our Site,
              including IP addresses, browser types, operating systems, and
              pages viewed. This information helps us improve the user
              experience and optimize our services. Cookies and Similar
              Technologies: We use cookies and similar technologies to track
              user preferences, enhance user experience, and collect analytics
              data. Users can manage cookie preferences through their browser
              settings.
            </p>

            <h3>How We Use Information:</h3>
            <p>
              <strong>Personal Information:</strong> We may collect personal
              information such as names, email addresses, and other contact
              details when users register for an account, subscribe to our
              newsletter, or engage in other activities on our Site.
            </p>
            <p>
              <strong>Usage Information:</strong> We automatically collect
              certain information about how users interact with our Site,
              including IP addresses, browser types, operating systems, and
              pages viewed. This information helps us improve the user
              experience and optimize our services. Cookies and Similar
              Technologies: We use cookies and similar technologies to track
              user preferences, enhance user experience, and collect analytics
              data. Users can manage cookie preferences through their browser
              settings.
            </p>
            <h3>How We Use Information:</h3>

            <p>
              <strong>Provide Services:</strong> We use personal information to
              deliver the services requested by users, such as providing access
              to educational resources and facilitating communication.
            </p>

            <p>
              <strong>Communication:</strong> We may use contact information to
              send users updates, newsletters, promotional offers, and other
              communications related to our services. Users can opt-out of
              receiving marketing communications at any time.
            </p>

            <p>
              <strong>Analytics:</strong> We analyze usage data to understand
              how users interact with our Site and improve its functionality and
              content.
            </p>

            <h3>Data Sharing:</h3>
            <p>
              <strong>Service Providers:</strong> We may share personal
              information with third-party service providers who assist us in
              operating our Site, conducting business, or servicing users. These
              providers are contractually obligated to protect the
              confidentiality and security of personal information.
            </p>
            <p>
              <strong>Legal Compliance:</strong> We may disclose personal
              information when required by law or in response to lawful requests
              from government authorities.
            </p>

            <div className='gap-20'></div>

            <h3>Data Security:</h3>
            <p>
              We implement appropriate technical and organizational measures to
              safeguard personal information against unauthorized access,
              alteration, disclosure, or destruction.Despite our efforts, no
              data transmission over the internet or electronic storage system
              is completely secure. Therefore, we cannot guarantee absolute
              security of user information.
            </p>

            <div className='gap-20'></div>

            <h3>Children's Privacy:</h3>
            <p>
              Our Site is not directed to individuals under the age of 13, and
              we do not knowingly collect personal information from children. If
              we become aware that we have inadvertently collected personal
              information from a child under 13, we will take steps to delete
              such information.
            </p>

            <div className='gap-20'></div>

            <h3>Your Choices:</h3>
            <p>
              Users can manage their communication preferences by unsubscribing
              from marketing emails or contacting us directly. Users can also
              control cookie preferences through their browser settings.
            </p>
            <div className='gap-20'></div>

            <h3>Changes to This Privacy Policy:</h3>
            <p>
              We reserve the right to update or modify this Privacy Policy at
              any time. Any changes will be effective immediately upon posting
              the revised Privacy Policy on this page. Users are encouraged to
              review this Privacy Policy periodically for any updates.
            </p>
            <div className='gap-20'></div>

            <h3>Contact Us:</h3>
            <p>
              If you have any questions or concerns about this Privacy Policy or
              our privacy practices, please contact us at{" "}
              <a href='mailto:hello@sharpstudy.io'>hello@sharpstudy.io</a> This
              Privacy Policy was last updated on April 1st 2024.
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
};

export default privacyPolicy;
