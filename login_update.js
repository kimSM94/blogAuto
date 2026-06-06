const { chromium } = require('playwright');

(async () => {
  // headless: false로 설정하여 화면을 띄우고 직접 로그인합니다.
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://nid.naver.com/nidlogin.login');

  console.log("👀 브라우저 창이 열리면 네이버 로그인을 진행해주세요.");
  console.log("⏳ 로그인이 완료되고 네이버 메인 화면으로 이동하면 자동으로 세션이 저장됩니다...");

  // 네이버 메인 화면(www.naver.com)으로 넘어갈 때까지 무한 대기 (로그인 성공 기준)
  await page.waitForURL('https://www.naver.com/**', { timeout: 0 }); 

  // 로그인 성공 후 쿠키/세션 상태를 기존 state.json 파일에 덮어쓰기
  await context.storageState({ path: 'state.json' });
  console.log("✅ state.json 파일이 성공적으로 최신화되었습니다!");

  await browser.close();
})();