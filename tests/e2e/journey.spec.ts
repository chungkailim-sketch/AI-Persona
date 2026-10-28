/**
 * The simplified journey in the browser, with the mock provider: upload → brief → cast → roundtable →
 * slide report. Set SHOT_DIR to keep a screenshot of each step.
 */
import type { Page } from '@playwright/test';
import { test, expect, signInAs, goAndHydrate } from './fixtures';

const BANDS: Record<string, string[]> = {
  Indonesia: ['Less than IDR 3 million', 'IDR 3-5 million', 'IDR 5-10 million', 'IDR 10 million or more'],
  Thailand: ['Less than THB 15000', 'THB 15000-30000', 'THB 30000-50000', 'THB 50000 or more'],
  Malaysia: ['Less than RM 3000', 'RM 3000-6000', 'RM 6000-10000', 'RM 10000 or more'],
};

function csv(): string {
  const lines = ['market,wave,wave_year,wave_month,question_id,statement,response,segment_group,segment,sample_base,share'];
  for (const [market, bands] of Object.entries(BANDS)) {
    for (const [q, statement, all] of [['Q1', 'I prefer premium brands', 40], ['Q2', 'I look for the lowest price', 55], ['Q3', 'I try new brands often', 35], ['Q4', 'I shop on social media', 45]] as const) {
      const rows: [string, string, number, number][] = [['All', 'All', 1000, all]];
      bands.forEach((b, i) => rows.push(['Monthly household income', b, 250, Math.max(1, Math.min(99, all + (i - 1.5) * (q === 'Q2' ? -9 : 9)))]));
      for (const [group, seg, base, share] of rows) {
        for (const [response, v] of [['Agree', share], ['Disagree', 100 - share]] as const) {
          lines.push([market, 'March 2026', 2026, 'March', q, `"${statement}"`, response, group, `"${seg}"`, base, v].join(','));
        }
      }
    }
  }
  return lines.join('\n');
}

async function shot(page: Page, name: string) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png`, fullPage: true });
}

test('from upload to a slide report in five steps', async ({ page }) => {
  test.setTimeout(240_000);
  await signInAs(page, `e2e-journey-${Date.now()}@example.com`, 'STANDARD_USER');
  await goAndHydrate(page, '/projects');
  await page.getByLabel('Project name').fill(`Asia CBGA Outlook ${Date.now()}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/data/);
  const id = new URL(page.url()).pathname.split('/')[2]!;

  // 1 Data
  await page.locator('input[name="files"]').setInputFiles({ name: 'mintel_sea.csv', mimeType: 'text/csv', buffer: Buffer.from(csv()) });
  await page.getByRole('button', { name: 'Upload and ingest' }).click();
  await expect(page.getByRole('region', { name: 'Your files' }).getByText('Ready', { exact: true })).toBeVisible({ timeout: 90_000 });
  await shot(page, '1-data');

  // 2 Brief: the default question and categories are filled in; choose the markets.
  await goAndHydrate(page, `/projects/${id}/brief`);
  await expect(page.getByLabel('Roundtable question')).toHaveValue(/Chinese brand/);
  for (const m of Object.keys(BANDS)) await page.getByLabel(m).check();
  await page.getByRole('button', { name: 'Save brief' }).click();
  await expect(page.getByText('Brief saved.')).toBeVisible();
  await shot(page, '2-brief');

  // 3 Cast
  await goAndHydrate(page, `/projects/${id}/personas`);
  await expect(page.getByText('9 personas: Indonesia, Malaysia, Thailand × 3 income tiers.')).toBeVisible();
  await page.getByRole('button', { name: 'Build the cast' }).click();
  await expect(page.locator('[data-persona-card]')).toHaveCount(9, { timeout: 60_000 });
  await expect(page.getByRole('columnheader', { name: 'Indonesia' })).toBeVisible();
  await expect(page.getByText('Premium Pioneers')).toBeVisible();
  await shot(page, '3-cast');
  await page.getByRole('button', { name: 'Approve cast' }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();

  // 4 Roundtable
  await goAndHydrate(page, `/projects/${id}/simulate`);
  await page.getByRole('button', { name: 'Start the roundtable' }).click();
  await expect(page.getByText('Roundtable complete')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('9 of 9 answered')).toBeVisible();
  await shot(page, '4-roundtable');

  // 5 Report
  await goAndHydrate(page, `/projects/${id}/results`);
  await expect(page.getByText('AI Persona Roundtable', { exact: true })).toBeVisible();
  await expect(page.getByText('rf.AI Persona — how the engine works')).toBeVisible();
  await expect(page.getByText('Where Chinese brands have the most room to grow')).toBeVisible();
  await expect(page.getByRole('img', { name: /Map of the markets/ })).toBeVisible();
  await expect(page.getByText('How open each market is, category by category')).toBeVisible();
  await expect(page.getByText('Key takeaways')).toBeVisible();

  // Market inputs feed the indices.
  await page.locator('summary', { hasText: 'Market inputs' }).click();
  await page.getByLabel('Indonesia: Geopolitics & trade').fill('25');
  await page.getByLabel('Indonesia: source').fill('Team estimate');
  await page.getByRole('button', { name: 'Save market inputs' }).click();
  await expect(page.getByText('Market inputs saved.')).toBeVisible();
  await shot(page, '5-report');

  await goAndHydrate(page, `/projects/${id}/report`);
  await expect(page.getByRole('button', { name: /Print or save as PDF/ })).toBeVisible();
  await expect(page.getByText('Persona profile', { exact: false }).first()).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  if (process.env.SHOT_DIR) await page.pdf({ path: `${process.env.SHOT_DIR}/report.pdf`, width: '13.333in', height: '7.5in', printBackground: true });
});
