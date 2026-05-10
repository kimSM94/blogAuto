const { chromium } = require('playwright');
require('dotenv').config();

const BLOG_ID = 'kakaoadd'; 

(async () => {
  console.log("👻 [유령 이웃 정리 봇] 작동을 시작합니다...");

  // 💡 지금은 내 PC에서 테스트 중이니까 화면이 보이게(false) 띄웁니다!
  // 나중에 깃허브에 올릴 때는 꼭 true 로 바꿔주세요!
  const browser = await chromium.launch({ headless: false }); 
  
  const context = await browser.newContext({
    storageState: 'state.json', // 네이버 로그인 세션 유지
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();

  try {
    // 2. 네이버 블로그 이웃 관리 페이지 접속
    console.log("▶ 네이버 블로그 이웃 관리(서로이웃) 페이지로 이동 중...");
    await page.goto(`https://admin.blog.naver.com/AdminMain.naver?blogId=${BLOG_ID}&Redirect=Buddyinfo`, { waitUntil: 'networkidle' });

    // 임시 로직: 1년 기준 날짜 계산 (현재 2026년 기준 2025년 날짜 셋팅)
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    console.log(`▶ 기준 날짜: ${oneYearAgo.toLocaleDateString()} 이전 글만 있는 계정 강등 처리 시작`);

    // =======================================================================
    // 눈으로 확인하기 위해 5초간 대기합니다. (실제 네이버 화면이 잘 뜨는지 보세요!)
    // =======================================================================
    await page.waitForTimeout(5000); 
    
    const downgradedCount = 0; // 강등시킨 이웃 수 카운트

    // 3. 작업 완료 후 텔레그램 보고!
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    if (botToken && chatId) {
      const message = `👻 [유령 이웃 정리] 작업 완료!\n1년 이상 글이 없는 서로이웃 ${downgradedCount}명을 일반 이웃으로 내렸습니다.`;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message })
      });
      console.log("✅ 텔레그램 보고 완료!");
    }

  } catch (error) {
    console.error("❌ 봇 실행 중 오류 발생:", error);
  } finally {
    await browser.close();
    console.log("👻 [유령 이웃 정리 봇] 테스트 종료.");
  }
})();