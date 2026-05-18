const { chromium } = require('playwright');
const fs = require('fs');
require('dotenv').config();

const BLOG_ID = process.env.NAVER_BLOG_ID || 'kakaoadd'; 

(async () => {
  console.log("🚜 [통합 대청소 봇] 탱크 모드 가동! 꼼꼼한 생중계 스캔 시작...");

  const stateFile = 'state.json';
  const hasState = fs.existsSync(stateFile);

  const browser = await chromium.launch({ 
    headless: false, // 💡 실서버(GitHub)에 올리실 땐 꼭 true로 변경하세요!
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  }); 
  
  const context = await browser.newContext({
    storageState: hasState ? stateFile : undefined,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();

  page.on('dialog', async dialog => {
      console.log(`💬 알림창 자동 확인: "${dialog.message()}"`);
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

    console.log("▶ [내가 추가한 이웃] 전체 목록 대문으로 진입합니다...");
    await page.evaluate(() => {
        adminMain.GotoPage('https://admin.blog.naver.com/BuddyListManage.naver', false);
    });
    await page.waitForTimeout(4000); 

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    
    let totalDowngradedAndMoved = 0; 
    let totalJustMoved = 0;

    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages) {
        let searchContext = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            if (await page.$('#buddyListManageForm')) { searchContext = page; break; }
            else { for (const f of page.frames()) { if (await f.$('#buddyListManageForm')) { searchContext = f; break; } } }
            await page.waitForTimeout(1500); 
        }
        if (!searchContext) throw new Error("❌ 이웃 목록 표를 찾을 수 없습니다.");

        console.log(`\n==================================================`);
        console.log(`📄 [전체 목록 - ${currentPage}페이지] 스캔 중...`);
        console.log(`==================================================`);
        
        let isPageClean = false;

        while (!isPageClean) {
            const neighbors = await searchContext.$$('#buddyListManageForm table tbody tr'); 
            if (neighbors.length === 0) await page.waitForTimeout(2000);

            let seoroGhosts = 0;
            let normalGhosts = 0;

            for (let i = 0; i < neighbors.length; i++) {
                const checkbox = await neighbors[i].$('td:nth-child(1) input[type="checkbox"]');
                if (!checkbox) continue; 

                const neighborName = await neighbors[i].$eval('td.buddy > div', el => el.innerText.replace(/\n/g, ' ').trim()).catch(() => '알 수 없음');
                const relationText = await neighbors[i].$eval('td:nth-child(3)', el => el.innerText.trim()).catch(() => '');
                const groupText = await neighbors[i].$eval('td:nth-child(4)', el => el.innerText.trim()).catch(() => '');
                const dateText = await neighbors[i].$eval('td:nth-child(6)', el => el.innerText.trim()).catch(() => '');
                
                let isGhost = false;
                let statusMsg = "";

                // 💡 날짜 판독 및 유령 판별 로직
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

                // 💡 이미 1년이상 그룹인 사람은 건너뛰기
                if (groupText.includes('1년이상')) {
                    isGhost = false;
                    statusMsg = `⏩ 이미 격리됨 (패스)`;
                }

                // 📺 [핵심 복구 포인트] 예쁘게 콘솔창에 생중계 출력!
                console.log(`[${i + 1}] ${neighborName.padEnd(20)} | [${relationText}] ${statusMsg}`);

                if (isGhost) {
                    await checkbox.check(); 
                    if (relationText === '서로이웃') seoroGhosts++;
                    else normalGhosts++;
                }
            }

            if (seoroGhosts > 0) {
                console.log(`\n🔄 [처리] 발견된 서로이웃 ${seoroGhosts}명을 강등 + 1년이상 그룹으로 던집니다!`);
                await searchContext.evaluate(() => {
                    const delBtn = document.querySelector('.btn_delete'); if (delBtn) delBtn.click();
                });
                await page.waitForTimeout(1500); 

                await searchContext.evaluate(() => {
                    document.querySelectorAll('label').forEach(lbl => { if (lbl.innerText.includes('관계만 변경')) lbl.click(); });
                    
                    const selects = Array.from(document.querySelectorAll('.ly_popup select, .layer_popup select'));
                    for (const select of selects) {
                        const targetOpt = Array.from(select.options).find(o => o.text.includes('1년이상'));
                        if (targetOpt) {
                            select.value = targetOpt.value;
                            select.dispatchEvent(new Event('change', { bubbles: true })); break;
                        }
                    }
                    
                    const clickables = Array.from(document.querySelectorAll('a, button, input[type="button"]'));
                    for (let i = clickables.length - 1; i >= 0; i--) {
                        if (clickables[i].innerText && (clickables[i].innerText.trim() === '확인' || clickables[i].innerText.trim() === '적용')) {
                            clickables[i].click(); break;
                        }
                    }
                });
                
                totalDowngradedAndMoved += seoroGhosts;
                await page.waitForTimeout(4000); 
                console.log(` -> ♻️ 리스트 갱신 완료! 누락된 유령이 없는지 한 번 더 스캔합니다.`);
            } 
            
            else if (normalGhosts > 0) {
                console.log(`\n🔄 [처리] 일반이웃 유령 ${normalGhosts}명을 1년이상 그룹으로 격리합니다!`);
                await searchContext.evaluate(() => {
                    const moveBtn = document.querySelector('.btn_movegroup'); if (moveBtn) moveBtn.click();
                });
                await page.waitForTimeout(1500); 

                await searchContext.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('#dropdown a'));
                    const target = links.find(a => a.innerText.includes('1년이상'));
                    if (target) target.click();
                });

                totalJustMoved += normalGhosts;
                await page.waitForTimeout(4000); 
                console.log(` -> ♻️ 리스트 갱신 완료! 누락된 유령이 없는지 한 번 더 스캔합니다.`);
            } 
            
            else {
                console.log(`\n✅ [${currentPage}페이지] 완벽하게 깨끗합니다! 다음 페이지로 넘어갑니다.`);
                isPageClean = true; 
            }
        }

        const targetNextPage = currentPage + 1;
        let pagedResult = "NOT_FOUND";
        
        pagedResult = await searchContext.evaluate((nextNum) => {
            const allLinks = Array.from(document.querySelectorAll('.paginate a, .blog_paginate a, #buddyListManageForm a'));
            
            const exactLink = allLinks.find(a => (a.href || '').includes(`goPage(${nextNum})`) || (a.getAttribute('onclick') || '').includes(`goPage(${nextNum})`));
            if (exactLink) { goPage(nextNum); return "NUMBER_EXECUTE"; }

            const numBtn = allLinks.find(a => a.innerText.trim() === String(nextNum));
            if (numBtn) { numBtn.click(); return "NUMBER_CLICK"; }
            
            const nextArrow = allLinks.find(a => a.innerText.includes('다음') || (a.querySelector('img') && a.querySelector('img').alt.includes('다음')) || (a.className && a.className.includes('next')));
            if (nextArrow) { nextArrow.click(); return "ARROW_CLICK"; }
            
            return "NOT_FOUND";
        }, targetNextPage);

        if (pagedResult !== "NOT_FOUND") {
            await page.waitForTimeout(3000); 
            currentPage++;
        } else {
            console.log(`\n🏁 전체 스캔 완주 완료! 더 이상 넘길 페이지가 없습니다.`);
            hasMorePages = false; 
        }
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      const msg = `🚜 [안정형 통합 대청소 완료]\n- 강등 및 격리: ${totalDowngradedAndMoved}명\n- 단순 격리: ${totalJustMoved}명\n총 ${totalDowngradedAndMoved + totalJustMoved}명 처리 완료!`;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg })
      });
    }

  } catch (error) {
    console.error("❌ 오류 발생:", error);
  } finally {
    console.log("🏁 봇 작동 종료.");
  }
})();