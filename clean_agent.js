const { chromium } = require('playwright');
const fs = require('fs');
require('dotenv').config();

const BLOG_ID = process.env.NAVER_BLOG_ID || 'kakaoadd'; 

(async () => {
  console.log("🧹 [월간 이웃 대청소 봇] 서로이웃 -> 일반이웃 강등 작업을 시작합니다...");

  const stateFile = 'state.json';
  const hasState = fs.existsSync(stateFile);

  const browser = await chromium.launch({ 
    headless: false, // 💡 깃허브에 올리실 땐 true로 변경!
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  }); 
  
  const context = await browser.newContext({
    storageState: hasState ? stateFile : undefined,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();

  page.on('dialog', async dialog => {
      console.log(`💬 알림창 확인: "${dialog.message()}" -> 자동 엔터!`);
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

    console.log("▶ [내가 추가한 이웃] 관리 화면으로 이동합니다...");
    await page.evaluate(() => {
        adminMain.GotoPage('https://admin.blog.naver.com/BuddyListManage.naver', false);
    });
    await page.waitForTimeout(4000); 

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    
    let downgradedCount = 0; 
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      // 💡 화면 갱신 대비 컨텍스트 재확보 로직 (에러 방지)
      let searchContext = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
          if (await page.$('#buddyListManageForm')) {
              searchContext = page; break;
          } else {
              for (const f of page.frames()) {
                  if (await f.$('#buddyListManageForm')) { searchContext = f; break; }
              }
          }
          if (searchContext) break;
          await page.waitForTimeout(2000); 
      }

      if (!searchContext) throw new Error("❌ 이웃 목록 표를 찾을 수 없습니다.");

      console.log(`\n==================================================`);
      console.log(`📄 현재 [${currentPage}페이지] 강등 대상 스캔 중...`);
      console.log(`==================================================`);
      
      const neighbors = await searchContext.$$('#buddyListManageForm table tbody tr'); 
      let targetFoundOnPage = false;

      if (neighbors.length === 0) await page.waitForTimeout(2000);

      for (let i = 0; i < neighbors.length; i++) {
        const checkbox = await neighbors[i].$('td:nth-child(1) input[type="checkbox"]');
        if (!checkbox) continue;

        // 💡 아까 찾아낸 완벽한 경로로 아이디/닉네임 추출
        const neighborName = await neighbors[i].$eval('td.buddy > div', el => el.innerText.replace(/\n/g, ' ').trim()).catch(() => '알 수 없음');
        const relationText = await neighbors[i].$eval('td:nth-child(3)', el => el.innerText.trim()).catch(() => '');
        const dateText = await neighbors[i].$eval('td:nth-child(6)', el => el.innerText.trim()).catch(() => '');
        
        let isGhost = false;
        let statusMsg = "";

        // 일반 이웃은 이미 강등된 상태이므로 패스
        if (relationText !== '서로이웃') {
            isGhost = false;
            statusMsg = "⏩ 이미 일반 이웃 (패스)";
        } else if (!dateText) {
            isGhost = true;
            statusMsg = "👻 유령 (글 없음)";
        } else if (dateText.match(/(전|어제|오늘|방금)/)) {
            isGhost = false; 
            statusMsg = `✅ 활동 중 (${dateText.trim()})`;
        } else {
            // 💡 2자리 연도 완벽 판독기 적용
            const dateMatch = dateText.match(/(\d{2,4})\D+(\d{1,2})\D+(\d{1,2})/);
            if (dateMatch) {
                let year = parseInt(dateMatch[1], 10);
                if (year < 100) year += 2000; 
                const postDate = new Date(year, parseInt(dateMatch[2], 10) - 1, parseInt(dateMatch[3], 10));

                if (postDate < oneYearAgo) {
                    isGhost = true;
                    statusMsg = `👻 유령 (${dateText.trim()})`;
                } else {
                    isGhost = false;
                    statusMsg = `✅ 활동 중 (${dateText.trim()})`;
                }
            } else {
                statusMsg = `❓ 판독불가 (${dateText.trim()})`;
            }
        }

        console.log(`[${i + 1}] ${neighborName.padEnd(25)} | ${statusMsg}`);

        if (isGhost && checkbox) {
            await checkbox.check(); 
            targetFoundOnPage = true;
            downgradedCount++;
        }
      }

      // 강등(관계만 변경) 실행
      if (targetFoundOnPage) {
        console.log(`\n🔄 유령 이웃을 [서로이웃 -> 일반이웃]으로 강등합니다.`);
        try {
          await searchContext.evaluate(() => {
              const delBtn = document.querySelector('.btn_delete'); // 삭제 버튼 클릭
              if (delBtn) delBtn.click();
          });
          await page.waitForTimeout(1500); 

          const isDone = await searchContext.evaluate(() => {
              let clicked = false;
              // 라디오 버튼 '관계만 변경' 선택
              document.querySelectorAll('label').forEach(lbl => {
                  if (lbl.innerText.includes('관계만 변경')) {
                      lbl.click();
                      clicked = true;
                  }
              });

              if (clicked) {
                  // 확인 버튼 타격
                  const clickables = Array.from(document.querySelectorAll('a, button, input[type="button"]'));
                  for (let i = clickables.length - 1; i >= 0; i--) {
                      let el = clickables[i];
                      if (el.innerText && (el.innerText.trim() === '확인' || el.innerText.trim() === '적용')) {
                          el.click();
                          return true;
                      }
                  }
              }
              return false;
          });

          if (isDone) console.log(" -> ✅ 강등 처리(관계만 변경) 완료!");
          await page.waitForTimeout(4000); 

          // 💡 서로이웃을 해제하면 리스트가 당겨질 수 있으므로 현재 페이지 다시 스캔
          console.log(` -> ♻️ 리스트가 갱신되었습니다. ${currentPage}페이지를 다시 확인합니다!`);

        } catch (e) {
          console.log("⚠️ 이동 중 오류:", e.message);
        }
      } 
      
      // 해당 페이지에 강등할 유령이 더 이상 없으면 다음 페이지로!
      if (!targetFoundOnPage) {
          const targetNextPage = currentPage + 1;
          console.log(`\n🔎 이 페이지는 깨끗합니다. 다음 페이지(${targetNextPage})를 탐색합니다...`);

          let pagedResult = "NOT_FOUND";

          for (let retry = 1; retry <= 3; retry++) {
              pagedResult = await searchContext.evaluate((nextNum) => {
                  const allLinks = Array.from(document.querySelectorAll('.paginate a, .blog_paginate a, #buddyListManageForm a'));
                  
                  const exactLink = allLinks.find(a => (a.href || '').includes(`goPage(${nextNum})`) || (a.getAttribute('onclick') || '').includes(`goPage(${nextNum})`));
                  if (exactLink) { goPage(nextNum); return "NUMBER_EXECUTE"; }

                  const numBtn = allLinks.find(a => a.innerText.trim() === String(nextNum));
                  if (numBtn) { numBtn.click(); return "NUMBER_CLICK"; }
                  
                  const nextArrow = allLinks.find(a => 
                      a.innerText.includes('다음') || 
                      (a.querySelector('img') && a.querySelector('img').alt.includes('다음')) ||
                      (a.className && a.className.includes('next'))
                  );
                  if (nextArrow) { nextArrow.click(); return "ARROW_CLICK"; }
                  
                  return "NOT_FOUND";
              }, targetNextPage);

              if (pagedResult !== "NOT_FOUND") break; 
              await page.waitForTimeout(2000); 
          }

          if (pagedResult !== "NOT_FOUND") {
              console.log(`➡️ 다음 페이지로 이동합니다!`);
              await page.waitForTimeout(4000); 
              currentPage++;
          } else {
              console.log(`\n🏁 마지막 페이지입니다. 스캔 완료!`);
              hasMorePages = false; 
          }
      }
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `🧹 [월간 대청소 완료]\n총 ${downgradedCount}명의 서로이웃을 일반 이웃으로 강등했습니다!` })
      });
    }

  } catch (error) {
    console.error("❌ 오류 발생:", error);
  } finally {
    console.log("🏁 봇 작동 종료.");
  }
})();