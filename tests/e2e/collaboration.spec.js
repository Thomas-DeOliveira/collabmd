import {
  createLongMarkdownDocument,
  expect,
  openChat,
  openFile,
  replaceEditorContent,
  seedStoredUserName,
  sendChatMessage,
  test,
  waitForExcalidrawFrameHarness,
  waitForExcalidrawTestHarness,
} from './helpers/app-fixture.js';

test('allows explicit session takeover between tabs in the same browser context', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await openFile(pageA, 'README.md');
  await seedStoredUserName(pageB);
  await pageB.goto('/#file=README.md');

  await expect(pageB.locator('#tabLockOverlay')).toBeVisible();
  await expect(pageB.locator('#tabLockTitle')).toHaveText('This vault is active in another tab');

  await pageB.locator('#tabLockTakeoverBtn').click();

  await expect(pageB.locator('#tabLockOverlay')).toBeHidden();
  await expect(pageB.locator('.cm-editor')).toBeVisible();
  await expect(pageA.locator('#tabLockOverlay')).toBeVisible();
  await expect(pageA.locator('#tabLockTitle')).toHaveText('This tab is no longer active');

  await replaceEditorContent(pageB, '# Takeover Owner\n\nOnly once.\n');

  await context.close();

  const verifyContext = await browser.newContext();
  const verifyPage = await verifyContext.newPage();
  await verifyPage.goto('/');
  await expect.poll(async () => {
    const fileData = await verifyPage.evaluate(async () => {
      const response = await fetch('/api/file?path=README.md');
      return response.json();
    });
    return fileData.content;
  }).toBe('# Takeover Owner\n\nOnly once.\n');

  await verifyContext.close();
});

test('direct Excalidraw fallback does not wipe live room state from another page', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await pageA.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await waitForExcalidrawTestHarness(pageA);

  await pageA.evaluate(() => {
    const scene = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    scene.appState = {
      ...(scene.appState || {}),
      viewBackgroundColor: '#123456',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  });
  await pageA.waitForTimeout(150);

  await pageB.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1&syncTimeoutMs=0');
  await waitForExcalidrawTestHarness(pageB);

  await expect.poll(async () => (
    pageA.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#123456');

  await context.close();
});

test('taking over an Excalidraw file tab preserves the live scene', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await seedStoredUserName(pageA);
  await seedStoredUserName(pageB);

  await pageA.goto('/?test=1#file=sample-excalidraw.excalidraw');
  const frameA = await waitForExcalidrawFrameHarness(pageA);

  await frameA.evaluate(() => {
    const scene = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    scene.appState = {
      ...(scene.appState || {}),
      viewBackgroundColor: '#345678',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  });
  await frameA.waitForTimeout(150);

  await pageB.goto('/?test=1#file=sample-excalidraw.excalidraw');
  await expect(pageB.locator('#tabLockOverlay')).toBeVisible();
  await pageB.locator('#tabLockTakeoverBtn').click();

  await expect(pageB.locator('#tabLockOverlay')).toBeHidden();
  await expect(pageA.locator('#tabLockOverlay')).toBeVisible();

  const frameB = await waitForExcalidrawFrameHarness(pageB);
  await expect.poll(async () => (
    frameB.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#345678');

  await context.close();
});

test('renaming in the app updates the mounted Excalidraw iframe user name', async ({ page }) => {
  await seedStoredUserName(page, 'Before Name');
  await page.goto('/?test=1#file=sample-excalidraw.excalidraw');

  const frame = await waitForExcalidrawFrameHarness(page, '#previewContent .excalidraw-embed iframe');
  await expect.poll(async () => (
    frame.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getLocalUserName())
  )).toBe('Before Name');

  await page.locator('#editNameBtn').click();
  await expect(page.locator('#displayNameDialog')).toBeVisible();
  await page.locator('#displayNameInput').fill('After Name');
  await page.locator('#displayNameSubmit').click();

  await expect.poll(async () => (
    frame.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getLocalUserName())
  )).toBe('After Name');
});

test('creates, replies to, and resolves source-anchored comments', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, [
    '# Comment target',
    '',
    'First paragraph for review.',
    '',
    '## Second section',
    '',
    'Another paragraph that needs a follow-up.',
  ].join('\n'));

  await page.locator('#previewContent [data-source-line="3"] .comment-anchor-btn').click();
  await expect(page.locator('#commentsPanel')).toHaveClass(/expanded/);

  await page.locator('#commentComposerInput').fill('Please expand this explanation.');
  await page.locator('#commentComposerForm').getByRole('button', { name: 'Post comment' }).click();

  const thread = page.locator('#commentsList .comment-thread').first();
  await expect(thread).toContainText('Please expand this explanation.');
  await expect(page.locator('#previewContent [data-source-line="3"] .comment-anchor-btn')).toHaveAttribute('data-count', '1');

  await thread.getByRole('button', { name: 'Reply' }).click();
  await thread.locator('.comment-reply-input').fill('Adding a follow-up reply.');
  await thread.locator('.comment-reply-form').getByRole('button', { name: 'Reply' }).click();
  await expect(thread).toContainText('Adding a follow-up reply.');

  await thread.getByRole('button', { name: 'Resolve' }).click();
  await expect(thread).toBeHidden();
  await expect(page.locator('#previewContent [data-source-line="3"] .comment-anchor-btn')).toHaveAttribute('data-count', '+');
});

test('syncs collaborative edits across two users on the same file', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await openFile(pageA, 'README.md');
  await openFile(pageB, 'README.md');

  await expect(pageA.locator('#userCount')).toHaveText('2 online');

  await pageA.locator('.cm-content').first().click();
  await pageA.keyboard.press('Control+End');
  await pageA.keyboard.press('Enter');
  await pageA.keyboard.press('Enter');
  await pageA.keyboard.type('# Shared Draft\n\nUpdated from browser A.', { delay: 5 });

  await expect(pageB.locator('#previewContent')).toContainText('Shared Draft');
  await expect(pageB.locator('#previewContent')).toContainText('Updated from browser A.');

  await pageA.close();
  await pageB.close();
});

test('syncs disposable lobby chat and tracks unread messages', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await openFile(pageA, 'README.md');
  await openFile(pageB, 'README.md');

  await sendChatMessage(pageA, 'Quick sync: reviewing README right now.');

  await expect(pageB.locator('#chatToggleBadge')).toHaveText('1');

  await openChat(pageB);
  await expect(pageB.locator('#chatMessages')).toContainText('Quick sync: reviewing README right now.');
  await expect(pageB.locator('#chatToggleBadge')).toBeHidden();

  await pageA.close();
  await pageB.close();
});

test('shows a browser notification for a background chat message when alerts are enabled', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await pageB.addInitScript(() => {
    window.__testNotifications = [];

    class TestNotification {
      static permission = 'granted';

      static async requestPermission() {
        return 'granted';
      }

      constructor(title, options = {}) {
        this.title = title;
        this.options = options;
        window.__testNotifications.push({ title, ...options });
      }

      addEventListener() { }

      close() { }
    }

    Object.defineProperty(window, 'Notification', {
      configurable: true,
      writable: true,
      value: TestNotification,
    });
  });

  await openFile(pageA, 'README.md');
  await openFile(pageB, 'README.md');

  await openChat(pageB);
  await pageB.locator('#chatNotificationBtn').click();
  await expect(pageB.locator('#chatNotificationBtn')).toHaveText('Alerts on');
  await pageB.locator('#chatToggleBtn').click();

  await pageB.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
  });

  await sendChatMessage(pageA, 'Background ping from README.');

  await expect.poll(async () => (
    pageB.evaluate(() => window.__testNotifications.length)
  )).toBe(1);

  const notification = await pageB.evaluate(() => window.__testNotifications[0]);
  expect(notification.title).toContain('CollabMD chat');
  expect(notification.body).toBe('README: Background ping from README.');

  await pageA.close();
  await pageB.close();
});

test('follows another user to their current cursor position', async ({ browser }) => {
  const followerPage = await browser.newPage();
  const targetPage = await browser.newPage();

  await openFile(followerPage, 'README.md');
  await openFile(targetPage, 'README.md');

  await expect(followerPage.locator('#userCount')).toHaveText('2 online');

  await replaceEditorContent(targetPage, createLongMarkdownDocument());
  await expect(followerPage.locator('#previewContent')).toContainText('Line 80 for follow testing.');

  const initialScrollTop = await followerPage.locator('.cm-scroller').evaluate((element) => element.scrollTop);
  await followerPage.locator('#userAvatars .user-avatar-button').first().click();

  await expect.poll(async () => (
    followerPage.locator('.cm-scroller').evaluate((element) => element.scrollTop)
  )).toBeGreaterThan(initialScrollTop + 150);

  await followerPage.close();
  await targetPage.close();
});

test('pins and labels the current user in the header avatar list', async ({ browser }) => {
  const localPage = await browser.newPage();
  const remotePage = await browser.newPage();

  await openFile(localPage, 'README.md', { userName: 'Owner' });
  await openFile(remotePage, 'README.md', { userName: 'Teammate' });

  await expect(localPage.locator('#userCount')).toHaveText('2 online');

  const localAvatar = localPage.locator('#userAvatars > .user-avatar').first();
  await expect(localAvatar).toHaveClass(/is-local/);
  await expect(localAvatar).toContainText('You');
  await expect(localAvatar).toHaveAttribute('aria-label', /Owner \(you\) — README/);
  await expect(localPage.locator('#userAvatars .user-avatar-button')).toHaveCount(1);

  await localPage.close();
  await remotePage.close();
});
