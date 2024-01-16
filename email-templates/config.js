import nodemailer from "nodemailer";

export const transport = nodemailer.createTransport({
  service: "SMTP",
  host: "email-smtp.ca-central-1.amazonaws.com",
  secure: true, // use SSL
  port: 465, // port for secure SMTP
  auth: {
    user: "AKIAWXZR2MNLH4547DPB",
    pass: "BPD1hk3+xK4rib+mleIBr13MHCB/svA2cy4yW+vhcOeD",
  },
});
