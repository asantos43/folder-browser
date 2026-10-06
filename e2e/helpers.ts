import type { Page } from '@playwright/test'

/**
 * Opens a file of an open snapshot in a tab the way a person does now that the snapshot has no tree of its files: Go to File (Ctrl+E), the name or part of it, Enter.
 * (The first match is the one that opens: give a name that is clear.)
 */
export async function goToFile(page: Page, query: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+e')
  const box = page.getByRole('combobox', { name: 'Go to File' })
  await box.fill(query)
  await page.keyboard.press('Enter')
}
