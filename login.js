const { chromium } = require('playwright');

(async () => {
  // 1. 눈에 보이는 진짜 브라우저 창을 엽니다.
  const browser = await chromium.launch({ headless: false }); 
  const context = await browser.newContext();
  const page = await context.newPage();

  // 2. 네이버 로그인 페이지로 이동합니다.
  await page.goto('https://nid.naver.com/nidlogin.login');

  console.log("==========================================");
  console.log("브라우저가 열렸습니다. 직접 로그인을 진행해 주세요.");
  console.log("캡차(자동입력 방지)가 나오면 직접 푸셔야 합니다.");
  console.log("여유 있게 2분(120초) 대기합니다...");
  console.log("==========================================");

  // 3. 사용자가 로그인할 수 있도록 120초(120000ms)를 넉넉히 기다려 줍니다.
  await page.waitForTimeout(120000);

  // 4. 시간이 지나면 현재 브라우저의 상태(쿠키 등)를 파일로 저장합니다.
  await context.storageState({ path: 'state.json' });
  
  console.log("성공! 로그인 상태가 state.json 파일로 저장되었습니다.");

  // 5. 브라우저를 종료합니다.
  await browser.close();
})();