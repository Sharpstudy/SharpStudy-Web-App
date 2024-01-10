import nodemailer from "nodemailer";

// export const transport = nodemailer.createTransport({
//   // Yes. SMTP!
//   service: "SMTP",
//   host: "email-smtp.ca-central-1.amazonaws.com", // Amazon email SMTP hostname
//   // host: "email-smtp.ap-southeast-1.amazonaws.com", // Amazon email SMTP hostname
//   secureConnection: true, // use SSL
//   port: 465, // port for secure SMTP
//   auth: {
//     user: "AKIAWXZR2MNLH4547DPB", // Use from Amazon Credentials
//     pass: "BPD1hk3+xK4rib+mleIBr13MHCB/svA2cy4yW+vhcOeD", // Use from Amazon Credentials
//   },
// });

// import nodemailer from "nodemailer";

// export const transport = nodemailer.createTransport({
//   host: "email-smtp.ca-central-1.amazonaws.com",
//   secure: false, // true for 465, false for other ports
//   // port: 465, // port for secure SMTP
//   port: 587, // port for secure SMTP
//   auth: {
//     user: "AKIAWXZR2MNLH4547DPB",
//     // user: process.env.AWS_SES_USER,
//     pass: "BPD1hk3+xK4rib+mleIBr13MHCB/svA2cy4yW+vhcOeD",
//     // pass: process.env.AWS_SES_PASSWORD,
//   },
// });

export const transport = nodemailer.createTransport({
  host: "email-smtp.ca-central-1.amazonaws.com",
  port: 587,
  auth: {
    user: "AKIAWXZR2MNLH4547DPB",
    pass: "BPD1hk3+xK4rib+mleIBr13MHCB/svA2cy4yW+vhcOeD",
  },
  secure: false, // Set this to false to use STARTTLS
  requireTLS: true, // Force the usage of STARTTLS
  tls: {
    rejectUnauthorized: false, // Important, set to false for testing purposes
  },
});