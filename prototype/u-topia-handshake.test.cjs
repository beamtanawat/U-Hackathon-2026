const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = process.argv[2] || 'http://127.0.0.1:4173/prototype/u-topia-handshake.html';

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    await page.goto(url);

    const tutorial = page.getByRole('button', { name: 'Feature Tutorial' });
    assert.equal(await tutorial.isVisible(), true, 'Feature Tutorial must be visible');

    await tutorial.click();
    assert.equal(await page.getByRole('dialog', { name: 'U-HANDSHAKE feature tutorial' }).isVisible(), true, `Tutorial must open. Page errors: ${pageErrors.join(' | ') || 'none'}`);

    for (let step = 0; step < 4; step += 1) {
      await page.getByRole('button', { name: 'Next' }).click();
    }

    const finalTutorial = page.getByRole('dialog');
    assert.match(await finalTutorial.innerText(), /Choose a scenario/i, 'Final tutorial step must point to scenarios');
    await finalTutorial.locator('[data-scen="B"]').click();

    assert.equal(await page.getByLabel('Amount in Thai Baht').inputValue(), '12900', 'Scenario B must open its populated transaction');
    assert.equal(await page.getByRole('button', { name: 'Exit demo' }).isVisible(), true, 'Scenario transaction must offer an explicit exit');

    await page.getByRole('button', { name: 'Back', exact: true }).click();
    assert.equal(await page.getByLabel('Who are you paying?').isVisible(), true, 'Back must return to the previous transaction step');
    assert.equal(await page.getByLabel('Who are you paying?').inputValue(), 'phone-store', 'Back must preserve scenario transaction data');
    assert.equal(await page.getByRole('heading', { name: 'Welcome!' }).count(), 0, 'Back must not return to Dashboard');

    await page.getByRole('button', { name: 'Exit demo' }).click();
    assert.equal(await page.getByRole('heading', { name: 'Welcome!' }).isVisible(), true, 'Exit demo must return to Dashboard');

    const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobilePage.goto(url);
    const dimensions = await mobilePage.evaluate(() => ({ body: document.body.scrollWidth, viewport: window.innerWidth }));
    assert.ok(dimensions.body <= dimensions.viewport, `Mobile layout must not overflow: ${dimensions.body}px body on ${dimensions.viewport}px viewport`);

    await mobilePage.getByRole('button', { name: 'Feature Tutorial' }).click();
    for (let step = 0; step < 4; step += 1) {
      await mobilePage.getByRole('button', { name: 'Next' }).click();
    }
    const mobileTutorial = mobilePage.getByRole('dialog');
    assert.match(await mobileTutorial.innerText(), /Choose a scenario/i, 'Mobile tutorial must finish at the scenario chooser');
    await mobileTutorial.locator('[data-scen="C"]').click();
    assert.equal(await mobilePage.getByRole('button', { name: 'Continue to Safe-to-Pay check' }).isVisible(), true, 'Scenario C must open its populated wallet-check step');
    await mobilePage.getByRole('button', { name: 'Back', exact: true }).click();
    assert.equal(await mobilePage.getByLabel('Amount in USDT').inputValue(), '120', 'Back must preserve the crypto amount');
    await mobilePage.getByRole('button', { name: 'Back', exact: true }).click();
    assert.equal(await mobilePage.getByLabel('Destination address (fictional)').inputValue(), 'xn1q-demo-0000-fict-7f3k', 'Back must preserve the crypto destination');
    await mobilePage.close();
  } finally {
    await browser.close();
  }
}

main().then(() => console.log('prototype flow: PASS')).catch(error => {
  console.error(`prototype flow: FAIL\n${error.stack}`);
  process.exitCode = 1;
});
