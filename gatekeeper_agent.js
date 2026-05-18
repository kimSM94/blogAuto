const { chromium } = require('playwright');
const fs = require('fs');
const { OpenAI } = require('openai'); 
require('dotenv').config();

const BLOG_ID = process.env.NAVER_BLOG_ID || 'kakaoadd'; 
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// 🤖 GPT-4o-mini 스팸 판별 (블로그명 + 메시지 종합 분석)
async function checkSpam(nickname, message) {
    if (!openai || !message) return 'PASS'; 
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "당신은 네이버 블로그 서로이웃 신청 스팸 필터입니다. 신청자의 [블로그명(닉네임)]과 [메시지]를 종합적으로 분석하여 상업적 광고(성형외과, 병원, 부동산, 마케팅, 물건 판매 등) 목적의 계정인지 판별하세요. 상업적 광고라면 오직 'SPAM'이라고 대답하고, 일반 사용자거나 기본 멘트라면 오직 'PASS'라고만 대답하세요." },
                { role: "user", content: `[블로그명]: ${nickname}\n[메시지]: ${message}` }
            ],
            temperature: 0.1,
        });
        return response.choices[0].message.content.trim().toUpperCase() === 'SPAM' ? 'SPAM' : 'PASS';
    } catch (e) {
        console.error("⚠️ OpenAI API 에러:", e.message);
        return 'PASS'; 
    }
}

(async () => {
  console.log("🏰 [서이추 문지기 봇] OpenAI 닉네임/메시지 필터링 가동! 정문 방어를 시작합니다...");

  const stateFile = 'state.json';
  const hasState = fs.existsSync(stateFile);

  const browser = await chromium.launch({ 
    headless: true, // 💡 실서버(GitHub)에 올릴 땐 꼭 true로 변경하세요!
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  }); 
  
  const context = await browser.newContext({
    storageState: hasState ? stateFile : undefined,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();

  // 브라우저 기본 알림창 자동 확인 (거절 누를 때 뜨는 알림창 처리용)
  page.on('dialog', async dialog => {
      console.log(`💬 네이버 알림창 확인: "${dialog.message()}" -> 자동 허용`);
      await dialog.accept();
  });

  try {
    await page.goto(`https://admin.blog.naver.com/${BLOG_ID}`, { waitUntil: 'networkidle' });
    
    if (page.url().includes('nidlogin')) {
      console.log("🚨 로그인 필요 (60초 대기)");
      await page.waitForTimeout(60000); 
      await context.storageState({ path: stateFile });
      await page.goto(`https://admin.blog.naver.com/${BLOG_ID}`, { waitUntil: 'networkidle' });
    }

    console.log("▶ 좌측 메뉴에서 [서로이웃 신청] 엘리먼트를 정확히 타격합니다...");
    
    try {
        await page.waitForSelector('#buddyinvite_config_anchor', { timeout: 5000 });
        await page.locator('#buddyinvite_config_anchor').click();
    } catch (e) {
        console.log("⚠️ 클릭 실패! 네이버 순정 JS 함수로 다이렉트 호출합니다.");
        await page.evaluate(() => {
            adminMain.GotoPage('https://admin.blog.naver.com/BuddyInviteReceivedManage.naver', false);
        });
    }
    
    await page.waitForTimeout(5000); 

    let currentPage = 1;
    let hasMorePages = true;
    let totalAccepted = 0;
    let totalRejected = 0;

    while (hasMorePages) {
        console.log(`\n==================================================`);
        console.log(`📄 [받은 신청 - ${currentPage}페이지] 스캔 및 AI 분석 중...`);
        console.log(`==================================================`);

        let targetFrame = null;
        for (let attempt = 1; attempt <= 10; attempt++) {
            for (const f of page.frames()) {
                if (await f.$('table.table4')) { 
                    targetFrame = f; 
                    break; 
                }
            }
            if (targetFrame) break;
            await page.waitForTimeout(1000); 
        }

        if (!targetFrame) throw new Error("❌ 신청 목록 테이블(table.table4)을 찾을 수 없습니다.");

        const rows = await targetFrame.$$('table.table4 tbody tr'); 
        if (rows.length === 0) {
            console.log("✅ 현재 화면에 스캔할 신청자가 없습니다.");
            break;
        }
        
        let currentTargetAction = null; 
        let targetCount = 0;

        for (let i = 0; i < rows.length; i++) {
            const checkbox = await rows[i].$('input[type="checkbox"]');
            if (!checkbox) continue; 
            
            const nameText = await rows[i].$eval('td:nth-child(2)', el => el.innerText.replace(/\n/g, ' ').trim()).catch(() => '');
            const msgText = await rows[i].$eval('td:nth-child(3)', el => el.innerText.trim()).catch(() => '');
            
            if (nameText.includes('신청한 사람') || !nameText) continue;

            const decision = await checkSpam(nameText, msgText);
            
            if (currentTargetAction === null) currentTargetAction = decision;

            if (decision === currentTargetAction) {
                await checkbox.check();
                targetCount++;
                const emoji = decision === 'SPAM' ? '🚫 거절' : '✅ 수락';
                console.log(`[${emoji}] ${nameText.padEnd(15)} | ${msgText.substring(0, 25).replace(/\n/g, ' ')}...`);
            }
        }

        // =======================================================================
        // ⚔️ 액션 실행: 새 창(Popup Window) 낚아채기 핵심 패치!
        // =======================================================================
        if (targetCount > 0) {
            if (currentTargetAction === 'SPAM') {
                console.log(`\n🗑️ 광고 계정 ${targetCount}명을 [거절] 처리합니다.`);
                // 거절은 보통 기본 알림창(confirm)만 뜨고 새로고침 되므로 기존 창에서 진행
                const rejectBtn = targetFrame.locator('.action2 a, .action2 button').filter({ hasText: /^거절$/ }).first();
                await rejectBtn.click();
                
                totalRejected += targetCount;
                await page.waitForTimeout(3000); // 처리 후 리스트 갱신 대기
                continue; 

            } else {
                console.log(`\n🎉 일반 유저 ${targetCount}명을 [수락] 처리합니다.`);
                const acceptBtn = targetFrame.locator('.action2 a, .action2 button').filter({ hasText: /^수락$/ }).first();
                
                console.log("👉 새 창(팝업 브라우저)이 뜨기를 기다립니다...");
                let popupWindow = null;
                
                try {
                    // 💡 [핵심] 수락 버튼을 누름과 동시에 "새로운 팝업창"이 열리는 이벤트를 낚아챕니다!
                    [popupWindow] = await Promise.all([
                        page.waitForEvent('popup', { timeout: 8000 }), 
                        acceptBtn.click()
                    ]);
                } catch (e) {
                    console.log("⚠️ 새 창을 감지하지 못했습니다. 기존 레이어로 폴백합니다.");
                }

                if (popupWindow) {
                    console.log("✅ 팝업창 낚아채기 성공! 팝업창 내부 조종을 시작합니다.");
                    // 팝업창 내용이 다 불러와질 때까지 대기
                    await popupWindow.waitForLoadState('domcontentloaded');
                    await popupWindow.waitForTimeout(1000); // 렌더링 안정화 1초 대기

                    // 💡 [선배님 경로 타격] 이제 기존 창이 아니라 '새로 뜬 팝업창' 안에서 버튼을 누릅니다!
                    console.log("👉 팝업창 내부의 최종 승인 버튼(#footer input[type=image]) 타격!");
                    const footerBtn = popupWindow.locator('#footer input[type="image"]').first();
                    await footerBtn.waitFor({ state: 'attached', timeout: 5000 });
                    await footerBtn.click();
                    
                    console.log(" -> ✅ 수락 승인 완벽 성공!");
                } else {
                    // (만약 네이버가 새 창이 아니라 인페이지 레이어로 띄웠을 경우를 대비한 예비책)
                    console.log("👉 기존 프레임 내부에서 버튼을 찾습니다.");
                    await targetFrame.evaluate(() => {
                        const btn = document.querySelector('#footer input[type="image"]');
                        if (btn) btn.click();
                    });
                }

                totalAccepted += targetCount;
                await page.waitForTimeout(4000); // 팝업 닫히고 본 창 리스트 갱신 대기
                continue; 
            }
        }

        // =======================================================================
        // 🛡️ 다음 페이지 이동
        // =======================================================================
        const targetNextPage = currentPage + 1;
        const hasNext = await targetFrame.evaluate((nextNum) => {
            const paginateDivs = document.querySelectorAll('.paginate, .blog_paginate, div.paginate');
            if (paginateDivs.length === 0) return false;
            
            let allLinks = [];
            paginateDivs.forEach(div => allLinks.push(...div.querySelectorAll('a')));
            
            const exactLink = allLinks.find(a => (a.href || '').includes(`goPage(${nextNum})`) || (a.getAttribute('onclick') || '').includes(`goPage(${nextNum})`));
            if (exactLink) { goPage(nextNum); return true; }

            const numBtn = allLinks.find(a => a.innerText.trim() === String(nextNum));
            if (numBtn) { numBtn.click(); return true; }
            
            const nextArrow = allLinks.find(a => a.innerText.includes('다음') || (a.querySelector('img') && a.querySelector('img').alt.includes('다음')));
            if (nextArrow) { nextArrow.click(); return true; }
            
            return false;
        }, targetNextPage);

        if (hasNext) {
            console.log(`➡️ 다음 페이지로 이동합니다...`);
            await page.waitForTimeout(4000); 
            currentPage++;
        } else {
            console.log(`\n🏁 더 이상 대기 중인 신청이 없습니다!`);
            hasMorePages = false;
        }
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      const msg = `🏰 [문지기 AI 보고서]\n- 수락된 일반 이웃: ${totalAccepted}명\n- 거절된 광고(스팸): ${totalRejected}명\n문지기 임무를 완벽하게 수행했습니다!`;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg })
      });
    }

  } catch (error) {
    console.error("❌ 오류 발생:", error);
  } finally {
    console.log("🏁 서이추 문지기 봇 작동 종료.");
  }
})();