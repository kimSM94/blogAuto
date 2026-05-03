const { chromium } = require('playwright');
const { supabase, generateNeighborComment } = require('./config');

async function runFeedAgent() {
  console.log('🌟 [이웃새글] 피드 자동화 에이전트 시작...');
  const browser = await chromium.launch({ headless: false }); 
  const context = await browser.newContext({ storageState: 'state.json' });
  const feedPage = await context.newPage();

  try {
    let allUniquePosts = [];
    const seen = new Set();

    // 1. 페이징 처리 (1~3페이지 수집)
    for (let pageNum = 1; pageNum <= 3; pageNum++) {
      console.log(`\n📄 [피드 수집] 이웃 새글 ${pageNum}페이지 스캔 중...`);
      await feedPage.goto(`https://section.blog.naver.com/BlogHome.naver?directoryNo=0&currentPage=${pageNum}&groupId=0`, { waitUntil: 'networkidle' });
      await feedPage.waitForTimeout(3000);

      // 💡 [방어 1단계] 쓸데없는 헤더/사이드바를 제외하고 오직 '본문 영역(#content)' 안의 링크만 주워옵니다.
      const pageUrls = await feedPage.$$eval('#content a', links => links.map(a => a.href).filter(Boolean));

      for (const url of pageUrls) {
        const lowerUrl = url.toLowerCase();
        
        // 프로필, 카테고리 등 본문이 아닌 링크 차단
        if (lowerUrl.includes('profile') || lowerUrl.includes('category') || lowerUrl.includes('prologue') || lowerUrl.includes('guestbook')) continue;

        // 게시글 고유 번호(logNo) 추출
        const match = url.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)\/(\d{10,})/);
        if (match) {
          const [_, blogId, logNoStr] = match;
          const key = `${blogId}_${logNoStr}`;
          
          if (!seen.has(key)) {
            seen.add(key);
            // 💡 [핵심] 정렬을 위해 logNo를 실제 숫자로 변환해서 저장해 둡니다.
            allUniquePosts.push({ 
              blogId, 
              logNoStr, 
              logNoNum: parseInt(logNoStr, 10) 
            });
          }
        }
      }
    }

    // 💡 [방어 2단계 - 치트키] 수집된 모든 글을 '게시글 번호가 큰 순서(최신순)'로 내림차순 정렬합니다!
    // 이렇게 하면 배너에 걸린 4/10일 옛날 글은 무조건 맨 뒤로 쫓겨납니다.
    allUniquePosts.sort((a, b) => b.logNoNum - a.logNoNum);

    console.log(`✅ 총 ${allUniquePosts.length}개의 글을 수집하여 [완벽한 최신 시간순]으로 정렬했습니다!`);
    console.log(`👉 가장 첫 번째로 방문할 글 번호: ${allUniquePosts[0]?.logNoStr}`);

    // 2. 각 포스트 방문 처리
    for (const post of allUniquePosts) {
      const { blogId, logNoStr: logNo } = post;
      
      const { data: alreadyProcessed } = await supabase.from('processed_feed_posts').select('post_id').eq('post_id', logNo);
      if (alreadyProcessed && alreadyProcessed.length > 0) {
        console.log(`[패스] DB 기록 확인됨 (이미 방문함): ${logNo}`);
        continue;
      }

      const postPage = await context.newPage();
      try {
        const targetUrl = `https://m.blog.naver.com/${blogId}/${logNo}`;
        await postPage.goto(targetUrl, { waitUntil: 'networkidle' });
        await postPage.waitForTimeout(3000);

        const postBody = postPage.locator('.se-main-container, .se_component_wrap, .post_ct').first();
        if (await postBody.count() === 0) {
          console.log(`⚠️ 본문을 찾을 수 없음: ${logNo}`);
          continue;
        }
        
        const postText = await postBody.innerText();
        
        await postPage.evaluate(() => window.scrollBy(0, 2000));
        await postPage.waitForTimeout(1500);

        // --- [공감 로직] ---
        console.log(`❤️ [공감 시도]`);
        try {
          const likeBtn = postPage.locator('a.u_likeit_list_btn, button.u_likeit_list_btn, .__reaction__zeroface').first();
          if (await likeBtn.count() > 0) {
            const isLiked = await likeBtn.evaluate(el => 
              el.getAttribute('aria-pressed') === 'true' || 
              el.classList.contains('on') || 
              el.querySelector('.u_likeit_icon.on') !== null
            );

            if (!isLiked) {
              await likeBtn.click({ force: true });
              console.log(`✅ 공감 버튼을 꾹 눌렀습니다.`);
              await postPage.waitForTimeout(1000);
            } else {
              console.log(`🚫 이미 하트가 켜져 있습니다.`);
            }
          }
        } catch (likeErr) {
          console.log(`⚠️ 공감 버튼 클릭 중 오류 발생 (무시하고 계속 진행)`);
        }

        // --- [댓글 중복 체크 및 작성 로직] ---
        const commentOpenBtn = postPage.locator('.icon__seNf8, .num__OVfhz').first();
        if (await commentOpenBtn.count() > 0) {
          await commentOpenBtn.click();
          await postPage.waitForTimeout(2500); 

          const alreadyCommented = await postPage.$$eval('.u_cbox_comment', elements => {
            return elements.some(el => {
              const info = el.getAttribute('data-info');
              return info && info.includes('mine:true'); 
            });
          });

          if (alreadyCommented) {
            console.log(`🚫 [중복 방지] 이미 내가 작성한 댓글이 있습니다. 건너뜁니다.`);
          } else {
            const aiComment = await generateNeighborComment(postText);
            console.log(`💬 [AI 댓글 생성] ${aiComment}`);

            await postPage.fill('.u_cbox_text', aiComment);
            await postPage.waitForTimeout(500);
            await postPage.click('.u_cbox_btn_upload');
            console.log(`✅ [작성 완료] 이웃 새글에 댓글을 남겼습니다.`);
          }
          
          await supabase.from('processed_feed_posts').insert([{ post_id: logNo }]);

        } else {
          console.log(`⚠️ 댓글창을 열 수 없습니다. (비공개 혹은 댓글 막힘)`);
        }

      } catch (e) {
        console.error(`❌ ${logNo} 처리 중 에러:`, e.message);
      } finally {
        await postPage.close();
      }

      const delay = 12000 + Math.random() * 5000;
      console.log(`☕ 다음 작업을 위해 ${Math.floor(delay/1000)}초 휴식...`);
      await feedPage.waitForTimeout(delay);
    }
  } catch (error) {
    console.error('❌ 전체 공정 에러:', error);
  } finally {
    await browser.close();
    console.log('🏁 모든 이웃 새글 순회를 종료합니다.');
  }
}

runFeedAgent();