import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Landing page (home, no sidebar)
  await page.goto('http://localhost:4173/docs/');
  await page.waitForSelector('.VPNavBarSearch');
  const homeBtn = await page.locator('.DocSearch-Button').boundingBox();
  const homeSearch = await page.locator('.VPNavBarSearch').boundingBox();
  console.log('=== LANDING PAGE ===');
  console.log('VPNavBarSearch box:', JSON.stringify(homeSearch));
  console.log('DocSearch-Button box:', JSON.stringify(homeBtn));
  console.log('NavBar title width:', await page.locator('.VPNavBar .title').evaluate(el => el.getBoundingClientRect().width));
  console.log('Content padding-left:', await page.locator('.VPNavBar .content').evaluate(el => getComputedStyle(el).paddingLeft));
  console.log('Container padding-left:', await page.locator('.VPNavBar .container').evaluate(el => getComputedStyle(el).paddingLeft));
  console.log('NavBar classes:', await page.locator('.VPNavBar').evaluate(el => el.className));

  // Inner page (with sidebar)
  await page.goto('http://localhost:4173/docs/how-to-play.html');
  await page.waitForSelector('.VPNavBarSearch');
  const innerBtn = await page.locator('.DocSearch-Button').boundingBox();
  const innerSearch = await page.locator('.VPNavBarSearch').boundingBox();
  console.log('\n=== INNER PAGE ===');
  console.log('VPNavBarSearch box:', JSON.stringify(innerSearch));
  console.log('DocSearch-Button box:', JSON.stringify(innerBtn));
  console.log('NavBar title width:', await page.locator('.VPNavBar .title').evaluate(el => el.getBoundingClientRect().width));
  console.log('Content padding-left:', await page.locator('.VPNavBar .content').evaluate(el => getComputedStyle(el).paddingLeft));
  console.log('Container padding-left:', await page.locator('.VPNavBar .container').evaluate(el => getComputedStyle(el).paddingLeft));
  console.log('NavBar classes:', await page.locator('.VPNavBar').evaluate(el => el.className));

  if (homeBtn && innerBtn) {
    console.log(`\n=== DIFFERENCE ===`);
    console.log(`Search button X: landing=${Math.round(homeBtn.x)}, inner=${Math.round(innerBtn.x)}, diff=${Math.round(innerBtn.x - homeBtn.x)}px`);
  }

  await browser.close();
}

main().catch(console.error);
