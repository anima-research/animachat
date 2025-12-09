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

interface EmailContent {
  title: string;
  greeting: string;
  body: string;
  buttonText: string;
  buttonUrl: string;
  expiry: string;
  footer: string;
}

function generateEmailHtml(content: EmailContent): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${content.title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 560px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 40px 24px 40px; border-bottom: 1px solid #e4e4e7;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td>
                    <span style="font-size: 24px; font-weight: 600; color: #18181b; letter-spacing: -0.5px;">The Arc</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 32px 40px;">
              <h1 style="margin: 0 0 24px 0; font-size: 20px; font-weight: 600; color: #18181b; line-height: 1.4;">
                ${content.title}
              </h1>
              <p style="margin: 0 0 16px 0; font-size: 15px; color: #3f3f46; line-height: 1.6;">
                ${content.greeting}
              </p>
              <p style="margin: 0 0 28px 0; font-size: 15px; color: #3f3f46; line-height: 1.6;">
                ${content.body}
              </p>
              
              <!-- Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="border-radius: 6px; background-color: #7c3aed;">
                    <a href="${content.buttonUrl}" target="_blank" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 6px;">
                      ${content.buttonText}
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 28px 0 0 0; font-size: 13px; color: #71717a; line-height: 1.5;">
                ${content.expiry}
              </p>
            </td>
          </tr>
          
          <!-- Link fallback -->
          <tr>
            <td style="padding: 0 40px 32px 40px;">
              <p style="margin: 0 0 8px 0; font-size: 13px; color: #71717a;">
                Or copy this link:
              </p>
              <p style="margin: 0; font-size: 13px; color: #7c3aed; word-break: break-all;">
                <a href="${content.buttonUrl}" style="color: #7c3aed; text-decoration: underline;">${content.buttonUrl}</a>
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #fafafa; border-top: 1px solid #e4e4e7; border-radius: 0 0 8px 8px;">
              <p style="margin: 0 0 8px 0; font-size: 13px; color: #71717a; line-height: 1.5;">
                ${content.footer}
              </p>
              <p style="margin: 0; font-size: 13px; color: #a1a1aa;">
                — The Arc
              </p>
            </td>
          </tr>
        </table>
        
        <!-- Outer footer -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 560px;">
          <tr>
            <td style="padding: 24px 40px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
                Sent by <a href="${APP_URL}" style="color: #7c3aed; text-decoration: none;">The Arc</a> · Anima Labs
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

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
      html: generateEmailHtml({
        title: 'Verify Your Email',
        greeting: `Hello ${name},`,
        body: `Welcome to The Arc. Click the button below to verify your email address and complete your registration.`,
        buttonText: 'Verify Email',
        buttonUrl: verifyUrl,
        expiry: 'This link will expire in 24 hours.',
        footer: `If you didn't create an account on The Arc, you can safely ignore this email.`
      }),
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
      html: generateEmailHtml({
        title: 'Reset Your Password',
        greeting: `Hello ${name},`,
        body: `We received a request to reset your password. Click the button below to create a new password.`,
        buttonText: 'Reset Password',
        buttonUrl: resetUrl,
        expiry: 'This link will expire in 1 hour.',
        footer: `If you didn't request a password reset, you can safely ignore this email.`
      }),
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

