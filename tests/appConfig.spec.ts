import { test, expect } from './fixtures';
import { testIds } from '../src/components/testIds';

test('should be possible to save app configuration', async ({ appConfigPage, page }) => {
  await page.getByTestId(testIds.appConfig.region).fill('us-east-2');

  const saveResponse = appConfigPage.waitForSettingsResponse();
  await page.getByTestId(testIds.appConfig.submit).click();
  await expect(saveResponse).toBeOK();
});

test('app page renders the workspace', async ({ gotoPage, page }) => {
  await gotoPage();
  await expect(page.getByTestId(testIds.app.container)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run query' })).toBeVisible();
});
