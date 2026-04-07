import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock Resend ──────────────────────────────────────────────────

const mockSend = vi.fn();

vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: mockSend };
  },
}));

// ── Setup / Teardown ─────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules();
  mockSend.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.RESEND_API_KEY;
  delete process.env.APP_URL;
  delete process.env.EMAIL_FROM;
});

// Helper to import fresh module (resets the cached resend client)
async function freshImport() {
  return await import('./email.js');
}

// ── sendVerificationEmail ────────────────────────────────────────

describe('sendVerificationEmail', () => {
  it('returns true without sending when RESEND_API_KEY is not set (dev mode)', async () => {
    delete process.env.RESEND_API_KEY;
    const { sendVerificationEmail } = await freshImport();

    const result = await sendVerificationEmail('user@test.com', 'tok-123', 'Alice');

    expect(result).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends verification email with correct subject and recipient', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.APP_URL = 'https://app.example.com';
    mockSend.mockResolvedValue({ error: null });

    const { sendVerificationEmail } = await freshImport();
    const result = await sendVerificationEmail('user@test.com', 'verify-tok', 'Alice');

    expect(result).toBe(true);
    expect(mockSend).toHaveBeenCalledOnce();

    const sendArgs = mockSend.mock.calls[0][0];
    expect(sendArgs.to).toBe('user@test.com');
    expect(sendArgs.subject).toBe('Verify your email - The Arc');
    expect(sendArgs.html).toContain('Verify Your Email');
    expect(sendArgs.html).toContain('Hello Alice,');
    expect(sendArgs.html).toContain('https://app.example.com/verify-email?token=verify-tok');
    expect(sendArgs.text).toContain('Hello Alice,');
    expect(sendArgs.text).toContain('https://app.example.com/verify-email?token=verify-tok');
  });

  it('includes 24-hour expiry notice in verification email', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockResolvedValue({ error: null });

    const { sendVerificationEmail } = await freshImport();
    await sendVerificationEmail('user@test.com', 'tok', 'Bob');

    const sendArgs = mockSend.mock.calls[0][0];
    expect(sendArgs.html).toContain('24 hours');
    expect(sendArgs.text).toContain('24 hours');
  });

  it('returns false when Resend API returns an error', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockResolvedValue({ error: { message: 'Invalid API key' } });

    const { sendVerificationEmail } = await freshImport();
    const result = await sendVerificationEmail('user@test.com', 'tok', 'Alice');

    expect(result).toBe(false);
  });

  it('returns false when send throws an exception', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockRejectedValue(new Error('Network error'));

    const { sendVerificationEmail } = await freshImport();
    const result = await sendVerificationEmail('user@test.com', 'tok', 'Alice');

    expect(result).toBe(false);
  });

  it('uses default APP_URL when env var is not set', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    delete process.env.APP_URL;
    mockSend.mockResolvedValue({ error: null });

    const { sendVerificationEmail } = await freshImport();
    await sendVerificationEmail('user@test.com', 'tok', 'Alice');

    const sendArgs = mockSend.mock.calls[0][0];
    expect(sendArgs.html).toContain('http://localhost:5173/verify-email?token=tok');
  });
});

// ── sendPasswordResetEmail ───────────────────────────────────────

describe('sendPasswordResetEmail', () => {
  it('returns false when RESEND_API_KEY is not set (cannot send reset in dev)', async () => {
    delete process.env.RESEND_API_KEY;
    const { sendPasswordResetEmail } = await freshImport();

    const result = await sendPasswordResetEmail('user@test.com', 'tok-123', 'Alice');

    expect(result).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends password reset email with correct subject and URL', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.APP_URL = 'https://app.example.com';
    mockSend.mockResolvedValue({ error: null });

    const { sendPasswordResetEmail } = await freshImport();
    const result = await sendPasswordResetEmail('user@test.com', 'reset-tok', 'Bob');

    expect(result).toBe(true);
    expect(mockSend).toHaveBeenCalledOnce();

    const sendArgs = mockSend.mock.calls[0][0];
    expect(sendArgs.to).toBe('user@test.com');
    expect(sendArgs.subject).toBe('Reset your password - The Arc');
    expect(sendArgs.html).toContain('Reset Your Password');
    expect(sendArgs.html).toContain('Hello Bob,');
    expect(sendArgs.html).toContain('https://app.example.com/reset-password?token=reset-tok');
    expect(sendArgs.text).toContain('Hello Bob,');
  });

  it('includes 1-hour expiry notice in password reset email', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockResolvedValue({ error: null });

    const { sendPasswordResetEmail } = await freshImport();
    await sendPasswordResetEmail('user@test.com', 'tok', 'Bob');

    const sendArgs = mockSend.mock.calls[0][0];
    expect(sendArgs.html).toContain('1 hour');
    expect(sendArgs.text).toContain('1 hour');
  });

  it('returns false when Resend API returns an error', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockResolvedValue({ error: { message: 'Rate limited' } });

    const { sendPasswordResetEmail } = await freshImport();
    const result = await sendPasswordResetEmail('user@test.com', 'tok', 'Bob');

    expect(result).toBe(false);
  });

  it('returns false when send throws an exception', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockRejectedValue(new Error('Timeout'));

    const { sendPasswordResetEmail } = await freshImport();
    const result = await sendPasswordResetEmail('user@test.com', 'tok', 'Bob');

    expect(result).toBe(false);
  });
});

// ── Verification vs reset behavior difference ────────────────────

describe('email — verification vs reset no-API-key behavior', () => {
  it('verification returns true without API key (allows dev signup)', async () => {
    delete process.env.RESEND_API_KEY;
    const { sendVerificationEmail } = await freshImport();
    expect(await sendVerificationEmail('a@b.com', 'tok', 'X')).toBe(true);
  });

  it('password reset returns false without API key (cannot reset without email)', async () => {
    delete process.env.RESEND_API_KEY;
    const { sendPasswordResetEmail } = await freshImport();
    expect(await sendPasswordResetEmail('a@b.com', 'tok', 'X')).toBe(false);
  });
});

// ── HTML template structure ──────────────────────────────────────

describe('email — HTML template structure', () => {
  it('produces valid HTML with DOCTYPE and button link', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.APP_URL = 'https://myapp.com';
    mockSend.mockResolvedValue({ error: null });

    const { sendVerificationEmail } = await freshImport();
    await sendVerificationEmail('user@test.com', 'tok-abc', 'Charlie');

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<a href="https://myapp.com/verify-email?token=tok-abc"');
    expect(html).toContain('Verify Email');
    expect(html).toContain('The Arc');
  });

  it('includes both HTML and plaintext versions', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockResolvedValue({ error: null });

    const { sendPasswordResetEmail } = await freshImport();
    await sendPasswordResetEmail('user@test.com', 'tok', 'Dana');

    const sendArgs = mockSend.mock.calls[0][0];
    expect(sendArgs.html).toBeDefined();
    expect(sendArgs.text).toBeDefined();
    // Both should contain the user's name
    expect(sendArgs.html).toContain('Dana');
    expect(sendArgs.text).toContain('Dana');
  });

  it('includes link fallback text in HTML', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.APP_URL = 'https://myapp.com';
    mockSend.mockResolvedValue({ error: null });

    const { sendVerificationEmail } = await freshImport();
    await sendVerificationEmail('user@test.com', 'tok-xyz', 'Eve');

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('Or copy this link');
    expect(html).toContain('https://myapp.com/verify-email?token=tok-xyz');
  });
});
