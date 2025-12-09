import { Resend } from 'resend';

// Lazy initialization to avoid errors when API key is not set
let resend: Resend | null = null;

function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    return null;
  }
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

const FROM_EMAIL = process.env.EMAIL_FROM || 'Arc <noreply@tesserae.cc>';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

export interface EmailService {
  sendVerificationEmail(email: string, token: string, name: string): Promise<boolean>;
  sendPasswordResetEmail(email: string, token: string, name: string): Promise<boolean>;
}

export async function sendVerificationEmail(
  email: string, 
  token: string, 
  name: string
): Promise<boolean> {
  const client = getResendClient();
  if (!client) {
    console.warn('[Email] RESEND_API_KEY not set - skipping email verification');
    return true; // Allow signup without email in dev mode
  }

  const verifyUrl = `${APP_URL}/verify-email?token=${token}`;
  
  try {
    const { error } = await client.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Verify your email - The Arc',
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: 'JetBrains Mono', 'Courier New', monospace;
      background: #101015;
      color: #fafaf8;
      padding: 40px;
      margin: 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(139, 122, 166, 0.3);
      padding: 40px;
    }
    h1 {
      font-size: 24px;
      font-weight: 300;
      letter-spacing: 0.2em;
      color: #8b7aa6;
      margin-bottom: 20px;
    }
    p {
      font-size: 14px;
      line-height: 1.8;
      opacity: 0.8;
      margin-bottom: 20px;
    }
    .button {
      display: inline-block;
      background: rgba(139, 122, 166, 0.2);
      border: 1px solid rgba(139, 122, 166, 0.5);
      color: #8b7aa6;
      padding: 15px 30px;
      text-decoration: none;
      font-family: inherit;
      font-size: 14px;
      letter-spacing: 0.1em;
      margin: 20px 0;
    }
    .button:hover {
      background: rgba(139, 122, 166, 0.3);
    }
    .code {
      background: rgba(8, 8, 12, 0.8);
      padding: 15px;
      font-size: 12px;
      word-break: break-all;
      margin: 20px 0;
      border-left: 2px solid rgba(139, 122, 166, 0.4);
    }
    .footer {
      font-size: 11px;
      opacity: 0.5;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid rgba(255,255,255,0.1);
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>verify.email</h1>
    <p>Hello ${name},</p>
    <p>Welcome to The Arc. Click the button below to verify your email address and complete your registration.</p>
    <a href="${verifyUrl}" class="button">verify.email.address</a>
    <p>Or copy and paste this link into your browser:</p>
    <div class="code">${verifyUrl}</div>
    <p>This link will expire in 24 hours.</p>
    <div class="footer">
      <p>If you didn't create an account on The Arc, you can safely ignore this email.</p>
      <p>— The Arc System</p>
    </div>
  </div>
</body>
</html>
      `,
      text: `
Hello ${name},

Welcome to The Arc. Please verify your email address by clicking the link below:

${verifyUrl}

This link will expire in 24 hours.

If you didn't create an account on The Arc, you can safely ignore this email.

— The Arc System
      `
    });

    if (error) {
      console.error('[Email] Failed to send verification email:', error);
      return false;
    }

    console.log(`[Email] Verification email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('[Email] Error sending verification email:', error);
    return false;
  }
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
  name: string
): Promise<boolean> {
  const client = getResendClient();
  if (!client) {
    console.warn('[Email] RESEND_API_KEY not set - cannot send password reset');
    return false;
  }

  const resetUrl = `${APP_URL}/reset-password?token=${token}`;

  try {
    const { error } = await client.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Reset your password - The Arc',
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: 'JetBrains Mono', 'Courier New', monospace;
      background: #101015;
      color: #fafaf8;
      padding: 40px;
      margin: 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(139, 122, 166, 0.3);
      padding: 40px;
    }
    h1 {
      font-size: 24px;
      font-weight: 300;
      letter-spacing: 0.2em;
      color: #8b7aa6;
      margin-bottom: 20px;
    }
    p {
      font-size: 14px;
      line-height: 1.8;
      opacity: 0.8;
      margin-bottom: 20px;
    }
    .button {
      display: inline-block;
      background: rgba(139, 122, 166, 0.2);
      border: 1px solid rgba(139, 122, 166, 0.5);
      color: #8b7aa6;
      padding: 15px 30px;
      text-decoration: none;
      font-family: inherit;
      font-size: 14px;
      letter-spacing: 0.1em;
      margin: 20px 0;
    }
    .code {
      background: rgba(8, 8, 12, 0.8);
      padding: 15px;
      font-size: 12px;
      word-break: break-all;
      margin: 20px 0;
      border-left: 2px solid rgba(139, 122, 166, 0.4);
    }
    .footer {
      font-size: 11px;
      opacity: 0.5;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid rgba(255,255,255,0.1);
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>reset.password</h1>
    <p>Hello ${name},</p>
    <p>We received a request to reset your password. Click the button below to create a new password.</p>
    <a href="${resetUrl}" class="button">reset.password</a>
    <p>Or copy and paste this link into your browser:</p>
    <div class="code">${resetUrl}</div>
    <p>This link will expire in 1 hour.</p>
    <div class="footer">
      <p>If you didn't request a password reset, you can safely ignore this email.</p>
      <p>— The Arc System</p>
    </div>
  </div>
</body>
</html>
      `,
      text: `
Hello ${name},

We received a request to reset your password. Click the link below to create a new password:

${resetUrl}

This link will expire in 1 hour.

If you didn't request a password reset, you can safely ignore this email.

— The Arc System
      `
    });

    if (error) {
      console.error('[Email] Failed to send password reset email:', error);
      return false;
    }

    console.log(`[Email] Password reset email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('[Email] Error sending password reset email:', error);
    return false;
  }
}

