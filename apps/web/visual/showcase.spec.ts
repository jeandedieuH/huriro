import { expect, test } from '@playwright/test'

/**
 * Baseline screenshots for the component showcase — light + dark shell.
 * Fonts render slightly differently across OSes; CI pins the linux snapshot.
 */
test('showcase renders the component set (light)', async ({ page }) => {
	await page.goto('/')
	await expect(page.locator('main')).toBeVisible()
	await expect(page).toHaveScreenshot('showcase-light.png', { fullPage: true })
})

test('showcase renders dark theme via .dark class', async ({ page }) => {
	await page.goto('/')
	await page.evaluate(() => document.documentElement.classList.add('dark'))
	await expect(page.locator('main')).toBeVisible()
	await expect(page).toHaveScreenshot('showcase-dark.png', { fullPage: true })
})
