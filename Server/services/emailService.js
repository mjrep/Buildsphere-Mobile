const nodemailer = require('nodemailer');

function getMailerConfig() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const user = process.env.SMTP_USER || process.env.GMAIL_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || process.env.EMAIL_APP_PASSWORD;
  const from = process.env.SMTP_FROM || process.env.EMAIL_FROM || user;

  return { host, port, secure, user, pass, from };
}

function createTransporter() {
  const { host, port, secure, user, pass } = getMailerConfig();
  if (!user || !pass) {
    throw new Error('Missing SMTP config. Set SMTP_USER and SMTP_PASS, or GMAIL_USER and GMAIL_APP_PASSWORD, in Server/.env.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

function isPasswordResetEmailConfigured() {
  const { user, pass } = getMailerConfig();
  return Boolean(user && pass);
}

async function sendPasswordResetOtp(email, otp) {
  const { from } = getMailerConfig();
  const transporter = createTransporter();
  const fromAddress = from?.includes('<') ? from : `"BuildSphere" <${from}>`;

  await transporter.sendMail({
    from: fromAddress,
    to: email,
    subject: 'Your BuildSphere password reset code',
    text: `Your BuildSphere password reset code is ${otp}. This code expires in 15 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>BuildSphere password reset</h2>
        <p>Use this 6-digit code to reset your password:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">${otp}</p>
        <p>This code expires in 15 minutes. If you did not request it, you can ignore this email.</p>
      </div>
    `,
  });
}

module.exports = { isPasswordResetEmailConfigured, sendPasswordResetOtp };
