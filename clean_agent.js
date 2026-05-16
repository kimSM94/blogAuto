const { chromium } = require('playwright');
const fs = require('fs');
require('dotenv').config();

const BLOG_ID = process.env.NAVER_BLOG_ID || 'kakaoadd'; 

(async () => {
  console.log("👻 [유령 이웃 정리 봇] 작동을 시작합니다...");

  // 💡 1. 로그인 파일(state.json)이 있는지 먼저 검사합니다.
  const stateFile = 'state.json';
  const hasState = fs.existsSync(stateFile);

  const browser = await chromium.launch({ 
    headless: false, 
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  }); 
  
  const context = await browser.newContext({
    storageState: hasState ? stateFile : undefined,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();

  try {
    // =======================================================================
    // 🛡️ [1단계] 네이버 로그인 생존 여부 테스트 및 복구
    // =======================================================================
    console.log("▶ 네이버 로그인 상태를 점검합니다...");
    await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'networkidle' });
    
    // 아이디 입력창이 보이면 = 로그아웃 된 상태!
    if (await page.locator('#id').isVisible()) {
      console.log("🚨 [경고] 네이버 로그인이 풀렸습니다! (이래서 계속 에러가 났던 겁니다)");
      console.log("⏳ 지금 뜬 창에서 직접 아이디/비번을 치고 로그인해 주세요! (60초 기다립니다...)");
      
      // 회원님이 로그인하실 수 있도록 60초 대기
      await page.waitForTimeout(60000); 
      
      // 로그인 완료 후 따끈따끈한 새 쿠키를 저장!
      await context.storageState({ path: stateFile });
      console.log("✅ 로그인 정보(state.json) 갱신 완료! 이제 에러 안 납니다!");
    } else {
      console.log("✅ 네이버 로그인이 정상 유지되고 있습니다.");
    }

    // =======================================================================
    // 🛡️ [2단계] 회원님 맞춤 경로: 대문 접속 -> '내가 추가한 이웃' 클릭
    // =======================================================================
    console.log(`▶ https://admin.blog.naver.com/${BLOG_ID} 관리자 대문으로 진입합니다...`);
    await page.goto(`https://admin.blog.naver.com/${BLOG_ID}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000); 

    // 💡 회원님이 정확히 짚어주신 [내가 추가한 이웃] 메뉴를 찾아서 클릭합니다!
    console.log("▶ 왼쪽 메뉴에서 [내가 추가한 이웃]을 클릭합니다...");
    const buddyMenu = page.locator('a').filter({ hasText: '내가 추가한 이웃' }).first();
    await buddyMenu.click();
    
    // 껍데기(iframe) 안의 목록이 뜰 때까지 넉넉히 대기
    await page.waitForTimeout(3000); 
    console.log("✅ 이웃 관리 페이지 로딩 성공!");

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    console.log(`▶ 기준 날짜: ${oneYearAgo.toLocaleDateString()} 이전 글만 있는 계정 강등 처리 시작`);
    
    // =======================================================================
    // 🔄 [3단계] 껍데기(iframe) 뚫기 및 2단계 강등 로직
    // =======================================================================
    const frame = page.frame({ name: 'mainFrame' });
    if (!frame) throw new Error("❌ 메인 프레임을 찾을 수 없습니다.");

    let downgradedCount = 0; 
    let currentPage = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      console.log(`\n📄 [${currentPage}페이지] 유령 이웃 스캔 중...`);
      await page.waitForTimeout(2000); 

      // frame 안에서 이웃 목록 탐색
      const neighbors = await frame.$$('table.buddy_list tbody tr, #buddyList tbody tr'); 
      let targetFoundOnPage = false;

      for (const neighbor of neighbors) {
        const tds = await neighbor.$$('td');
        if (tds.length < 5) continue; 

        const checkbox = await neighbor.$('input[type="checkbox"]');
        if (!checkbox) continue;

        // 최근 글 업데이트 날짜 (일반적으로 끝에서 두 번째 칸)
        const dateText = await tds[tds.length - 2].innerText().catch(() => '');
        const cleanDateText = dateText.trim();
        let isGhost = false;

        // 👻 유령 탐지
        if (cleanDateText === '') {
          isGhost = true;
          console.log(`👻 유령 발견! (작성글 아예 없음)`);
        } else if (cleanDateText.includes('전') || cleanDateText.includes('어제')) {
          isGhost = false; 
        } else {
          const parsedDateStr = cleanDateText.replace(/\./g, '-').replace(/-$/, '').trim();
          const postDate = new Date(parsedDateStr);
          if (!isNaN(postDate) && postDate < oneYearAgo) {
            isGhost = true;
            console.log(`👻 유령 발견! (마지막 글: ${cleanDateText})`);
          }
        }

        if (isGhost) {
          await checkbox.check();
          targetFoundOnPage = true;
          downgradedCount++;
        }
      }

      // 유령 발견 시 [삭제 -> 관계만 변경]
      if (targetFoundOnPage) {
        console.log(`🔄 이 페이지에서 발견된 유령 이웃을 [서로이웃 -> 이웃]으로 강등합니다.`);
        
        const deleteBtn = frame.locator('a, button').filter({ hasText: /^삭제$/ }).first();
        await deleteBtn.click();
        await page.waitForTimeout(1500); 

        try {
          // 라디오 버튼 "관계만 변경"
          const radioLabel = frame.locator('label').filter({ hasText: '관계만 변경' }).first();
          await radioLabel.click();
          await page.waitForTimeout(500);

          // "확인" 클릭
          const confirmBtn = frame.locator('.ly_popup a, .layer_popup a, button').filter({ hasText: /^확인$/ }).last();
          await confirmBtn.click();
          console.log("✅ 관계 변경 완료!");
          await page.waitForTimeout(2500); 
        } catch (popupErr) {
          console.log("⚠️ 팝업창 처리 중 문제 발생:", popupErr.message);
        }
      } else {
         console.log("✅ 이 페이지에는 1년 이상 잠수 탄 유령 이웃이 없습니다.");
      }

      // 다음 페이지 화살표 클릭
      const nextButton = await frame.$('.paginate a.next, .blog_paginate a.next'); 
      if (nextButton) {
        console.log("➡️ 다음 페이지로 넘어갑니다.");
        await nextButton.click();
        currentPage++;
        await page.waitForTimeout(3000); 
      } else {
        hasNextPage = false;
        console.log("🏁 마지막 페이지까지 완벽하게 스캔 완료!");
      }
    }

    // 텔레그램 보고
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      const message = `👻 [유령 이웃 정리] 작업 완료!\n1년 이상 글이 없는 서로이웃 ${downgradedCount}명을 일반 이웃으로 내렸습니다.`;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message })
      });
      console.log(`✅ 텔레그램 보고 완료! (총 ${downgradedCount}명)`);
    }

  } catch (error) {
    console.error("❌ 봇 실행 중 오류 발생:", error);
  } finally {
    // 확인하실 수 있도록 창을 안 닫고 살려둡니다 (실서버 올릴 때는 주석 해제하세요)
    // await browser.close(); 
    console.log("👻 [유령 이웃 정리 봇] 작동 종료.");
  }
})();