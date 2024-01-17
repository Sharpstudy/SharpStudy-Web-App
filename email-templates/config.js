import nodemailer from "nodemailer";

export const transport = nodemailer.createTransport({
  service: "SMTP",
  host: "email-smtp.ca-central-1.amazonaws.com",
  secure: true, // use SSL
  port: 465, // port for secure SMTP
  auth: {
    user: process.env.AWS_SES_USER,
    pass: process.env.AWS_SES_PASSWORD,
  },
});

