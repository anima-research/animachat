import { test, expect } from '@playwright/test';

// Test user credentials (from backend test setup)
const TEST_EMAIL = 'test@example.com';
const TEST_PASSWORD = 'password123';

async function loginAndDismissWelcome(page: any) {
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(1000);

  const loginForm = await page.locator('input[type="email"]').count();
  if (loginForm > 0) {
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.locator('button[type="submit"], button:has-text("Login")').first().click();
    await page.waitForTimeout(2000);
  }

  // Check for and dismiss Welcome dialog
  const welcomeDialog = page.locator('text=Welcome to The Arc');
  if (await welcomeDialog.count() > 0) {
    console.log('Welcome dialog detected, dismissing...');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const scrim = page.locator('.v-overlay__scrim');
    if (await scrim.count() > 0 && await welcomeDialog.count() > 0) {
      await scrim.click({ force: true });
      await page.waitForTimeout(500);
    }
  }

  console.log('After login/dismiss URL:', page.url());
}

test.describe('Settings Propagation Debug', () => {

  test('send message to trigger debug logs', async ({ page }) => {
    await loginAndDismissWelcome(page);

    // Open first Gemini conversation
    const geminiConversation = page.locator('text=Gemini').first();
    if (await geminiConversation.count() > 0) {
      await geminiConversation.click();
      await page.waitForTimeout(1500);
      console.log('Opened conversation:', page.url());
    }

    await page.screenshot({ path: '/tmp/arc-100-conversation.png', fullPage: true });

    // Send a test message to trigger inference and see debug logs
    const messageInput = page.locator('textarea').first();
    if (await messageInput.count() > 0) {
      console.log('Found message input, typing test message...');
      await messageInput.fill('Hello, this is a test message to check settings propagation.');

      await page.screenshot({ path: '/tmp/arc-101-message-typed.png', fullPage: true });

      const sendBtn = page.locator('button:has(.mdi-send)').first();
      if (await sendBtn.count() > 0) {
        console.log('\n=== SENDING MESSAGE ===');
        console.log('Check backend logs for [DEBUG-SETTINGS] output');
        await sendBtn.click();

        // Wait for response or timeout
        await page.waitForTimeout(8000);
      }
    }

    await page.screenshot({ path: '/tmp/arc-102-after-send.png', fullPage: true });
    console.log('Message sent - check backend logs');
  });

  test('view participant settings for Gemini', async ({ page }) => {
    await loginAndDismissWelcome(page);

    // Open first Gemini conversation
    const geminiConversation = page.locator('text=Gemini').first();
    if (await geminiConversation.count() > 0) {
      await geminiConversation.click();
      await page.waitForTimeout(1500);
    }

    // Open conversation settings
    const convSettingsBtn = page.locator('[title="Conversation settings"]').first();
    await convSettingsBtn.click();
    await page.waitForTimeout(800);

    const dialog = page.locator('.v-dialog').first();

    // Find Gemini row and click its gear icon
    const geminiRow = dialog.locator('tr:has-text("Flash"), tr:has-text("Gemini")').first();
    if (await geminiRow.count() > 0) {
      const gearBtn = geminiRow.locator('button:has(.mdi-cog)').first();
      if (await gearBtn.count() > 0) {
        await gearBtn.click();
        await page.waitForTimeout(500);
      }
    }

    await page.screenshot({ path: '/tmp/arc-110-gemini-settings.png', fullPage: true });

    // Get the participant settings content
    const allDialogs = await page.locator('.v-dialog').all();
    if (allDialogs.length > 1) {
      const settingsDialog = allDialogs[allDialogs.length - 1];
      const content = await settingsDialog.textContent();
      console.log('\n=== GEMINI PARTICIPANT SETTINGS ===');
      console.log(content);
    }
  });
});
