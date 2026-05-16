const { chromium } = require('playwright');
const fs = require('fs');
require('dotenv').config();

const BLOG_ID = process.env.NAVER_BLOG_ID || 'kakaoadd'; 

(async () => {
  console.log("👻 [유령 이웃 정리 봇] 👑 자동 그룹 도장 깨기 모드 시작...");

  const stateFile = 'state.json';
  const hasState = fs.existsSync(stateFile);

  const browser = await chromium.launch({ 
    headless: true, // 💡 깃허브 액션에 올리실 땐 꼭 true로 변경하세요!
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

    console.log("▶ [내가 추가한 이웃] 관리 화면 진입...");
    await page.evaluate(() => {
        adminMain.GotoPage('https://admin.blog.naver.com/BuddyListManage.naver', false);
    });
    await page.waitForTimeout(4000); 

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    let totalDowngradedCount = 0; 

    let searchContext = null;
    if (await page.$('#buddyListManageForm')) searchContext = page;
    else for (const f of page.frames()) { if (await f.$('#buddyListManageForm')) { searchContext = f; break; } }
    
    if (!searchContext) throw new Error("❌ 이웃 목록 표를 찾을 수 없습니다.");

    const targetGroups = await searchContext.evaluate(() => {
        const selects = Array.from(document.querySelectorAll('select'));
        const groupSelect = selects.find(s => Array.from(s.options).some(o => o.text.includes('1년이상')));
        if (!groupSelect) return [];

        return Array.from(groupSelect.options)
            .map(opt => ({ text: opt.innerText.trim(), value: opt.value }))
            .filter(g => g.value && g.value !== '0' && g.value !== '' && !g.text.includes('전체') && !g.text.includes('1년이상'));
    });

    console.log(`\n🗺️ 총 ${targetGroups.length}개의 그룹 폴더를 발견했습니다! 도장 깨기를 시작합니다.`);

    for (const group of targetGroups) {
        console.log(`\n🚪 ==================================================`);
        console.log(`🚪 [그룹 진입] '${group.text}' 폴더를 청소합니다!`);
        console.log(`🚪 ==================================================`);

        await searchContext.evaluate((val) => {
            const selects = Array.from(document.querySelectorAll('select'));
            const groupSelect = selects.find(s => Array.from(s.options).some(o => o.text.includes('1년이상')));
            if (groupSelect) {
                groupSelect.value = val;
                groupSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, group.value);
        
        await page.waitForTimeout(4000); 

        let currentPage = 1;
        let hasMorePages = true;
        let stuckCounter = 0; 

        while (hasMorePages) {
            searchContext = null;
            if (await page.$('#buddyListManageForm')) searchContext = page;
            else for (const f of page.frames()) { if (await f.$('#buddyListManageForm')) { searchContext = f; break; } }
            if (!searchContext) break;

            console.log(`\n📄 ['${group.text}' 폴더 - ${currentPage}페이지] 스캔 중...`);
            
            const neighbors = await searchContext.$$('#buddyListManageForm table tbody tr'); 
            let targetFoundOnPage = false;

            if (neighbors.length === 0) await page.waitForTimeout(2000);

            for (let i = 0; i < neighbors.length; i++) {
                const checkbox = await neighbors[i].$('td:nth-child(1) input[type="checkbox"]');
                if (!checkbox) continue; 

                // 💡 [핵심 수정 포인트] 회원님이 알려주신 'td.buddy > div' 적용! 
                // (아이디와 닉네임 사이의 줄바꿈을 공백으로 바꿔서 한 줄로 예쁘게 만듭니다)
                const neighborName = await neighbors[i].$eval('td.buddy > div', el => el.innerText.replace(/\n/g, ' ').trim()).catch(() => '알 수 없음');
                const dateText = await neighbors[i].$eval('td:nth-child(6)', el => el.innerText.trim()).catch(() => '');
                
                let isGhost = false;
                let statusMsg = "";

                if (!dateText) {
                    isGhost = true;
                    statusMsg = "👻 유령 (글 없음)";
                } else if (dateText.match(/(전|어제|오늘|방금)/)) {
                    isGhost = false; 
                    statusMsg = `✅ 활동 중 (${dateText.trim()})`;
                } else {
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
                    totalDowngradedCount++;
                }
            }

            if (targetFoundOnPage) {
                console.log(`\n🔄 발견된 유령들을 '1년이상' 그룹으로 즉시 격리합니다.`);
                try {
                    await searchContext.evaluate(() => {
                        const moveBtn = document.querySelector('.btn_movegroup');
                        if (moveBtn) moveBtn.click();
                    });
                    await page.waitForTimeout(1500); 

                    const isDone = await searchContext.evaluate(() => {
                        const links = Array.from(document.querySelectorAll('#dropdown a'));
                        const target = links.find(a => a.innerText.includes('1년이상'));
                        if (target) { target.click(); return true; }
                        return false;
                    });

                    if (isDone) {
                        console.log(" -> ✅ 그룹 이동 전송 성공!");
                        stuckCounter = 0; 
                    } else {
                        stuckCounter++;
                    }
                    await page.waitForTimeout(4000); 
                    
                    console.log(` -> ♻️ 리스트가 빈 공간을 채웠습니다. ${currentPage}페이지를 다시 스캔합니다!`);

                } catch (e) {
                    console.log("⚠️ 이동 중 오류:", e.message);
                    stuckCounter++;
                }

                if (stuckCounter >= 3) {
                    console.log("⚠️ 3회 연속 팝업 에러 발생! 무한루프 방지를 위해 다음 페이지로 강제 이동합니다.");
                    targetFoundOnPage = false; 
                }
            } 
            
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
                    console.log(`\n🏁 [${group.text}] 폴더의 마지막 페이지입니다. 이 폴더 청소 완료!`);
                    hasMorePages = false; 
                }
            }
        }
    }

    console.log(`\n🏆 ==================================================`);
    console.log(`🏆 모든 그룹 폴더 도장 깨기가 완벽하게 끝났습니다!!`);
    console.log(`🏆 ==================================================`);

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `👻 [전체 그룹 도장 깨기 완료]\n총 ${totalDowngradedCount}명을 '1년이상 이웃'으로 격리 완료!` })
      });
    }

  } catch (error) {
    console.error("❌ 오류 발생:", error);
  } finally {
    console.log("🏁 봇 작동 종료.");
  }
})();