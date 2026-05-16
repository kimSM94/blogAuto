const { chromium } = require('playwright');
require('dotenv').config();

// 💡 1. 본인의 네이버 아이디 (오타가 없는지 한 번만 쓱 확인해 주세요!)
const BLOG_ID = process.env.NAVER_BLOG_ID || 'kakaoadd'; 

(async () => {
  console.log("👻 [유령 이웃 정리 봇] 작동을 시작합니다...");

  // 💡 로컬 테스트용 (화면 보임)
  const browser = await chromium.launch({ 
    headless: false, 
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  }); 
  
  const context = await browser.newContext({
    storageState: 'state.json', // 네이버 로그인 세션
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();

  try {
    // =======================================================================
    // 🛡️ [경로 수정 완료] clean_agent.js 방식의 가장 안전한 정문 접속!
    // =======================================================================
    console.log(`▶ [${BLOG_ID}] 블로그 관리자 홈으로 안전하게 진입합니다...`);
    
    // 💡 ?blogId= 파라미터를 빼고 순수하게 아이디만 넣는 것이 네이버의 최신 정식 주소입니다.
    await page.goto(`https://admin.blog.naver.com/${BLOG_ID}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000); 

    if (page.url().includes('error')) {
      throw new Error("❌ 접속 권한 에러! (state.json 로그인이 풀렸거나 아이디가 다릅니다)");
    }

    // 💡 봇이 사람처럼 왼쪽 메뉴에서 [이웃·그룹 관리]를 직접 찾아 누릅니다.
    console.log("▶ 왼쪽 메뉴에서 [이웃·그룹 관리]를 클릭합니다...");
    const buddyMenu = page.locator('a:has-text("이웃·그룹 관리"), a[href*="ManageBuddy"]').first();
    await buddyMenu.click();
    
    // 프레임 안의 데이터가 뜰 때까지 넉넉히 대기
    await page.waitForTimeout(3000); 
    console.log("✅ 이웃 관리 페이지 로딩 성공!");

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    console.log(`▶ 기준 날짜: ${oneYearAgo.toLocaleDateString()} 이전 글만 있는 계정 강등 처리 시작`);
    
    // =======================================================================
    // 🔄 프레임 뚫기 및 2단계 강등(관계만 변경) 로직 시작
    // =======================================================================
    
    // 💡 네이버 관리자는 진짜 알맹이가 'mainFrame'이라는 껍데기 안에 숨어있습니다.
    const frame = page.frame({ name: 'mainFrame' });
    if (!frame) throw new Error("❌ 메인 프레임을 찾을 수 없습니다.");

    let downgradedCount = 0; 
    let currentPage = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      console.log(`\n📄 [${currentPage}페이지] 유령 이웃 스캔 중...`);
      await page.waitForTimeout(2000); 

      // 이제 page가 아니라 frame 안에서 이웃 목록을 찾습니다!
      const neighbors = await frame.$$('table.buddy_list tbody tr, #buddyList tbody tr'); 

      let targetFoundOnPage = false;

      for (const neighbor of neighbors) {
        const tds = await neighbor.$$('td');
        if (tds.length < 5) continue; 

        const checkbox = await neighbor.$('input[type="checkbox"]');
        if (!checkbox) continue;

        // 최근 글 업데이트 날짜 칸 (보통 맨 끝에서 두 번째)
        const dateText = await tds[tds.length - 2].innerText().catch(() => '');
        const cleanDateText = dateText.trim();

        let isGhost = false;

        // 👻 유령 탐지 로직
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

      // 유령이 선택되었으면 [삭제 -> 관계만 변경] 수행
      if (targetFoundOnPage) {
        console.log(`🔄 이 페이지에서 발견된 유령 이웃을 [서로이웃 -> 이웃]으로 강등합니다.`);
        
        const deleteBtn = frame.locator('a, button').filter({ hasText: /^삭제$/ }).first();
        await deleteBtn.click();
        await page.waitForTimeout(1500); 

        try {
          // 팝업 라디오 버튼 "관계만 변경" 클릭
          const radioLabel = frame.locator('label').filter({ hasText: '관계만 변경' }).first();
          await radioLabel.click();
          await page.waitForTimeout(500);

          // 팝업 "확인" 클릭
          const confirmBtn = frame.locator('.ly_popup a, .layer_popup a, button').filter({ hasText: /^확인$/ }).last();
          await confirmBtn.click();
          console.log("✅ 관계 변경 완료!");
          
          await page.waitForTimeout(2500); 
        } catch (popupErr) {
          console.log("⚠️ 팝업창 처리 중 문제 발생 (수동 확인 필요):", popupErr.message);
        }
      } else {
         console.log("✅ 이 페이지에는 1년 이상 잠수 탄 유령 이웃이 없습니다.");
      }

      // 다음 페이지 이동
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

    // 텔레그램 보고 전송
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
    // 💡 테스트 후 창이 바로 꺼지는 게 불편하시면 주석(//) 처리하셔도 됩니다.
    await browser.close();
    console.log("👻 [유령 이웃 정리 봇] 테스트 종료.");
  }
})();