import { test, expect, request, Page, Locator } from '@playwright/test';
import * as crypto from 'crypto';

test.describe('E2E: Users and Groups UI Flow', () => {
    const uniqueSuffix = crypto.randomUUID().split('-')[0];
    const testUserName = `UI User ${uniqueSuffix}`;
    const testUserEmail = `ui_user_${uniqueSuffix}@test.com`;
    const testGroupName = `UI Group ${uniqueSuffix}`;

    let createdUserId: string | null = null;
    let createdGroupId: string | null = null;

    test('should execute full flow: create external user, create group, and assign via UI', async ({ page }) => {
        // Reusable Nav Locators
        const sidebarHamburger = page.locator('.layout-menu-button, i.pi-bars').first();
        const usersSidebarMenu = page.locator('i.pi-users:visible').first();
        const usersListLink = page.locator('a[href="/user-management/users"]:visible');
        const usersConfigMenuLink = page.locator('a[href="/user-management/configuration"]:visible');
        const groupsConfigLink = page.locator('a[href="/user-management/configuration/groups"]:visible');
        const addNewBtn = page.locator('button:has-text("Add new")');

        // 1: Authentication & Navigation
        await page.goto('/login');

        await page.locator('input[formcontrolname="username"]').fill('superadmin@test.com');
        await page.locator('input[formcontrolname="password"]').fill('12345678');
        await page.keyboard.press('Enter');

        await expect(page).not.toHaveURL(/.*login.*/, { timeout: 15000 });

        await page.waitForTimeout(500);
        if (await sidebarHamburger.isVisible()) {
            await sidebarHamburger.click();
        }

        await page.waitForTimeout(500);
        await expect(usersSidebarMenu).toBeVisible({ timeout: 10000 });
        await usersSidebarMenu.click();

        // Wait for the exact user sub-menu link to become visible
        await expect(usersListLink).toBeVisible({ timeout: 10000 });
        await usersListLink.click();


        // 2: Create External User

        await expect(addNewBtn).toBeVisible({ timeout: 10000 });
        await addNewBtn.click();

        // Fill standard text inputs
        await page.locator('input[formcontrolname="email"]').fill(testUserEmail);
        await page.locator('input[formcontrolname="name"]').fill(testUserName);
        await page.locator('input[id="password"]').fill('SecurePassword123!');

        // Find the dropdown that currently says "Internal" or "Owner" and click it
        await page.locator('span.p-dropdown-label:visible')
            .filter({ hasText: /(Internal|Owner)/i })
            .click();
        await page.locator('li[role="option"][aria-label="user.type.external"]').click();

        // Intercept network to capture ID
        const userResponsePromise = page.waitForResponse(response =>
            response.url().includes('/api/users') && response.status() === 201
        );
        await page.locator('app-save-button button').click();

        const userResponse = await userResponsePromise;
        createdUserId = (await userResponse.json()).id;

        // Refresh user list navigation
        await page.waitForTimeout(500);
        await expect(usersSidebarMenu).toBeVisible({ timeout: 15000 });
        await usersSidebarMenu.click();

        // Wait for the exact user sub-menu link to become visible
        await expect(usersListLink).toBeVisible({ timeout: 15000 });
        await usersListLink.click();

        // Verify row appears in table
        const verifiedRow = await findRowWithPagination(page, testUserEmail, '/api/users');
        await expect(verifiedRow).toBeVisible();


        // 3: Create Group
        await page.waitForTimeout(500);
        await expect(usersSidebarMenu).toBeVisible({ timeout: 15000 });
        await usersSidebarMenu.click();

        // Wait for the exact groups sub-menu link to become visible
        await expect(usersConfigMenuLink).toBeVisible({ timeout: 15000 });
        await usersConfigMenuLink.click();

        // Wait for the exact User Management UI
        await expect(groupsConfigLink).toBeVisible({ timeout: 15000 });
        await groupsConfigLink.click();

        // Wait for the page to load and the 'Add new' button to appear
        const groupText = page.locator('th:has-text("Description "):visible');
        await expect(groupText).toBeVisible({ timeout: 15000 });

        await expect(addNewBtn).toBeVisible({ timeout: 15000 });
        await addNewBtn.click();

        await page.locator('input[formcontrolname="name"]').fill(testGroupName);
        await page.locator('textarea[formcontrolname="description"]').fill('E2E Test Group');

        const groupResponsePromise = page.waitForResponse(response =>
            response.url().includes('/api/groups') && response.status() === 201
        );
        await page.locator('app-save-button button').click();

        const groupResponse = await groupResponsePromise;
        createdGroupId = (await groupResponse.json()).id;

        await expect(page.locator('tr', { hasText: testGroupName })).toBeVisible();


        // 4: Assign Group to User
        // Navigate back to users list
        await page.waitForTimeout(500);
        await expect(usersSidebarMenu).toBeVisible({ timeout: 10000 });
        await usersSidebarMenu.click();

        await expect(usersListLink).toBeVisible({ timeout: 10000 });
        await usersListLink.click();

        // Find the profile row and click it
        const targetUserRow = await findRowWithPagination(page, testUserEmail, '/api/users');
        await targetUserRow.click({ force: true });

        // Select the group by its exact aria-label
        const groupDropdown = page.locator('span[aria-label="Select group"]');
        await expect(groupDropdown).toBeVisible({ timeout: 15000 });
        await groupDropdown.click();

        await page.locator(`li[aria-label="${testGroupName}"]`).click();
        await page.locator('button.p-button-icon-only:has(span.pi-plus)').click();

        const userGroupTable = page.locator('tbody.p-datatable-tbody');
        await expect(userGroupTable.locator('tr', { hasText: testGroupName })).toBeVisible();
    });

    test.afterAll(async () => {
        // Clean up test data robustly
        // to prevent database pollution
        const apiContext = await request.newContext();

        const authRes = await apiContext.post('/api/auth-tokens', {
            data: { username: 'superadmin@test.com', password: '12345678' }
        });

        if (authRes.ok()) {
            const body = await authRes.json();
            const token = body.accessToken || body.token;
            const headers = { 'Authorization': `Bearer ${token}` };

            if (createdUserId) {
                await apiContext.delete(`/api/users/${createdUserId}`, { headers }).catch();
            }
            if (createdGroupId) {
                await apiContext.delete(`/api/groups/${createdGroupId}`, { headers }).catch();
            }
        }
        await apiContext.dispose();
    });
});

/**
 * Navigates through pagination until a row containing the specific text is found.
 */
async function findRowWithPagination(page: Page, searchText: string, apiEndpointPattern: string, maxPages = 15): Promise<Locator> {
    await page.waitForTimeout(5000); // UI stabilization pause
    const targetRow = page.locator('tr', { hasText: searchText });

    for (let currentPage = 1; currentPage <= maxPages; currentPage++) {
        // 1. Fast check on current page
        if (await targetRow.isVisible()) {
            return targetRow; // Exit function and return the locator
        }

        // 2. Look for the "Next" button
        const nextButton = page.locator('button.p-paginator-next');

        if (await nextButton.isVisible()) {
            const isNextDisabled = await nextButton.evaluate((btn) =>
                btn.classList.contains('p-disabled') || btn.hasAttribute('disabled')
            );

            if (isNextDisabled) break;

            // 3. Click next and wait for table data to refresh
            await Promise.all([
                page.waitForResponse(response =>
                    response.url().includes(apiEndpointPattern) &&
                    response.request().method() === 'GET'
                ),
                nextButton.click()
            ]);
        } else {
            break;
        }
    }

    throw new Error(`Pagination Search Failsafe: Row with text "${searchText}" was not found across ${maxPages} pages.`);
}