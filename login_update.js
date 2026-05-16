const { chromium } = require('playwright');

(async () => {
  console.log("🔑 네이버 로그인 세션(state.json) 갱신을 시작합니다...");
  // 새 창을 띄웁니다 (기존 state.json을 무시하고 완전 새 상태로 켬)
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext(); 
  const page = await context.newPage();

  // 네이버 로그인 화면으로 바로 이동
  await page.goto('https://nid.naver.com/nidlogin.login');
  
  console.log("⏳ 뜬 브라우저 창에서 직접 아이디/비밀번호를 치고 [로그인]을 완료해 주세요!");
  console.log("⏳ (2단계 인증이나 캡차가 뜰 수 있으니 사람의 손길이 필요합니다. 40초 대기할게요!)");

  // 회원님이 폰으로 인증번호 누르고 로그인할 수 있도록 40초 넉넉하게 대기!
  await page.waitForTimeout(40000); 

  // 로그인 완료 후 따끈따끈한 쿠키를 state.json으로 저장
  await context.storageState({ path: 'state.json' });
  console.log("✅ 새로운 state.json 파일이 완벽하게 갱신되었습니다!");

  await browser.close();
})();