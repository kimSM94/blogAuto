require('dotenv').config();
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ====================================================================
// 🧠 [LLM Wiki 두뇌] 이웃의 위키(기억) 로직
// ====================================================================
async function getNeighborWiki(blogId) {
  const { data, error } = await supabase
    .from('neighbor_wiki')
    .select('*')
    .eq('blog_id', blogId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('위키 조회 에러:', error.message);
  }
  return data || {
    persona: '첫 방문',
    interaction_history: '기록 없음',
    last_visited_at: null
  };
}

async function updateNeighborWiki(blogId, newPersona, newHistory) {
  const { error } = await supabase
    .from('neighbor_wiki')
    .upsert({
      blog_id: blogId,
      persona: newPersona,
      interaction_history: newHistory,
      last_visited_at: new Date().toISOString()
    });
  if (error) console.error('위키 업데이트 에러:', error.message);
}

// 🤖 [기능 3] LLM을 이용해 기억 기반 댓글 생성 + 위키 요약 (✨토큰 최적화 버전)
async function generateWikiComment(wiki, postContent) {
  const shortContent = postContent.length > 1000 ? postContent.substring(0, 1000) + "..." : postContent;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" }, 
    messages: [{
        role: "system",
        content: `너는 내 블로그의 다정하고 센스 있는 소통 에이전트야. 방문한 이웃의 위키(기억)를 참고해서 친근하게 댓글을 달고, 위키 정보를 최신화해줘.
        
        [이웃 위키 정보]
        - 이웃 특징(관심사): ${wiki.persona}
        - 과거 소통 기록: ${wiki.interaction_history}
        
        [출력 규칙 (반드시 아래 JSON 형식으로 출력할 것)]
        {
          "myComment": "과거 소통을 참고하여 새 글에 공감하는 자연스럽고 짧은 2~3문장의 댓글 (첫인사 등 했던 말 반복 금지)",
          "persona": "이웃의 주요 관심사 (기존 정보에 누적해서 업데이트)",
          "interaction_history": "이전 소통 기록과 방금 네가 작성한 myComment를 합친 핵심 요약 (토큰 낭비를 막기 위해 3문장 이내로 짧게 압축할 것)"
        }`
      },
      {
        role: "user",
        content: `새 글 내용: ${shortContent}`
      }
    ]
  });

  const result = JSON.parse(response.choices[0].message.content);

  return {
    myComment: result.myComment,
    updatedWiki: {
      persona: result.persona,
      interaction_history: result.interaction_history
    }
  };
}


// ====================================================================
// 🏃‍♂️ [본체] 이웃 새글 순회 및 작업 에이전트
// ====================================================================
async function runFeedAgent() {
  console.log('🌟 [이웃새글] 피드 자동화 에이전트 시작...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    storageState: 'state.json'
  });

  context.setDefaultTimeout(60000);

  const feedPage = await context.newPage();

  try {
    let allUniquePosts = [];
    const seen = new Set();

    // 1. 페이징 처리 (1~4페이지 수집)
    for (let pageNum = 1; pageNum <= 4; pageNum++) {
      console.log(`\n📄 [피드 수집] 이웃 새글 ${pageNum}페이지 스캔 중...`);
      await feedPage.goto(`https://section.blog.naver.com/BlogHome.naver?directoryNo=0&currentPage=${pageNum}&groupId=0`, {
        waitUntil: 'domcontentloaded'
      });
      await feedPage.waitForTimeout(3000);

      const pageUrls = await feedPage.$$eval('#content a', links => links.map(a => a.href).filter(Boolean));

      for (const url of pageUrls) {
        const lowerUrl = url.toLowerCase();

        if (lowerUrl.includes('profile') || lowerUrl.includes('category') || lowerUrl.includes('prologue') || lowerUrl.includes('guestbook')) continue;

        const match = url.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)\/(\d{10,})/);
        if (match) {
          const [_, blogId, logNoStr] = match;
          const key = `${blogId}_${logNoStr}`;

          if (!seen.has(key)) {
            seen.add(key);
            allUniquePosts.push({
              blogId,
              logNoStr,
              logNoNum: parseInt(logNoStr, 10)
            });
          }
        }
      }
    }

    allUniquePosts.sort((a, b) => b.logNoNum - a.logNoNum);
    console.log(`✅ 총 ${allUniquePosts.length}개의 글을 수집하여 [완벽한 최신 시간순]으로 정렬했습니다!`);

    // 2. 각 포스트 방문 및 위키/공감/댓글 처리
    for (const post of allUniquePosts) {
      const { blogId, logNoStr: logNo } = post;

      // 🛡️ [위키 방어 로직] 12시간 이내 방문 스킵
      const wiki = await getNeighborWiki(blogId);
      if (wiki.last_visited_at) {
        const lastVisit = new Date(wiki.last_visited_at);
        const hoursSinceLastVisit = Math.abs(new Date() - lastVisit) / 36e5;
        if (hoursSinceLastVisit < 12) {
          console.log(`⏳ [${blogId}]님은 ${Math.round(hoursSinceLastVisit)}시간 전에 방문했습니다. (도배 방지 스킵)`);
          continue;
        }
      }

      // 🛡️ [DB 방어 로직] 이미 처리한 글 번호 스킵
      const { data: alreadyProcessed } = await supabase.from('processed_feed_posts').select('post_id').eq('post_id', logNo);
      if (alreadyProcessed && alreadyProcessed.length > 0) {
        console.log(`[패스] DB 기록 확인됨 (이미 방문함): ${logNo}`);
        continue;
      }

      const postPage = await context.newPage();
      try {
        const targetUrl = `https://m.blog.naver.com/${blogId}/${logNo}`;
        await postPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        await postPage.waitForTimeout(3000);

        const postBody = postPage.locator('.se-main-container, .se_component_wrap, .post_ct').first();
        if (await postBody.count() === 0) {
          console.log(`⚠️ 본문을 찾을 수 없음: ${logNo}`);
          continue;
        }

        const postText = await postBody.innerText();

        // 💡 [핵심 해결책] 봇 환경을 위해 마우스 휠 굴리듯 여러 번 스크롤 내려서 로딩 강제 유도!
        for (let i = 0; i < 6; i++) {
          await postPage.mouse.wheel(0, 1500);
          await postPage.waitForTimeout(500);
        }

        // --- [공감 로직] ---
        console.log(`❤️ [공감 시도]`);
        try {
          const likeBtnSelector = '#floating_bottom .area_sympathy a.u_likeit_button, a.u_likeit_button._face, [data-click-area*="sym"]';
          const likeBtn = postPage.locator(likeBtnSelector).first();

          if (await likeBtn.count() > 0) {
            const isLiked = await likeBtn.evaluate(el =>
              el.getAttribute('aria-pressed') === 'true' ||
              el.classList.contains('on') ||
              el.querySelector('.__reaction__like[style*="z-index: 2"]') !== null ||
              el.querySelector('.on') !== null
            );

            if (!isLiked) {
              // 💡 JS 강제 클릭으로 변경 (안정성 100배)
              await likeBtn.evaluate(el => el.click());
              console.log(`✅ 공감 버튼을 사람처럼 꾹~ 눌렀습니다.`);
              await postPage.waitForTimeout(2000);
            } else {
              console.log(`🚫 이미 하트가 켜져 있습니다.`);
            }
          } else {
            console.log(`⚠️ 공감 버튼을 화면에서 찾을 수 없습니다.`);
          }
        } catch (likeErr) {
          console.log(`⚠️ 공감 버튼 클릭 중 오류 발생: ${likeErr.message}`);
        }

        // --- [댓글 로직] ---
        // 💡 [핵심 해결책] 랜덤 클래스에 대비해 광범위하게 댓글 오픈 버튼 찾기
        const commentOpenBtnSelector = 'a.btn_comment, div[class*="comment_btn"] button, a[href*="comment"], [data-click-area*="reply"]';
        
        try {
          await postPage.waitForSelector(commentOpenBtnSelector, { state: 'attached', timeout: 5000 });
        } catch (e) {
          // 5초 안에 안 뜨면 패스
        }

        const commentOpenBtn = postPage.locator(commentOpenBtnSelector).first();
        
        if (await commentOpenBtn.count() > 0) {
          // 💡 JS 강제 클릭으로 무조건 열기
          await commentOpenBtn.evaluate(el => el.click());
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
            const loginGuide = postPage.locator('.u_cbox_guide').first();
            const isLoginRequired = await loginGuide.count() > 0 && await loginGuide.innerText().then(t => t.includes('로그인'));

            if (isLoginRequired) {
              console.log(`⚠️ [세션 만료] '로그인 해주세요' 안내문이 감지되었습니다. 댓글 작성을 건너뜁니다.`);
            } else {
              console.log(`📝 [${blogId}] 위키(기억) 정보를 바탕으로 맞춤형 댓글을 고민 중...`);

              const { myComment, updatedWiki } = await generateWikiComment(wiki, postText);
              console.log(`💬 [AI 맞춤 댓글] ${myComment}`);

              // 💡 변수 꼬임 완벽 수정! (page -> postPage 로 통일)
              try {
                const commentBox = postPage.locator('.u_cbox_text').first();

                await commentBox.waitFor({ state: 'visible', timeout: 5000 });
                await commentBox.scrollIntoViewIfNeeded();
                await commentBox.click({ force: true }); 
                await postPage.waitForTimeout(500);

                await commentBox.fill(myComment);
                await postPage.waitForTimeout(1000);

                // 💡 Playwright 클릭 대신 JS 강제 클릭으로 버튼 찾기 에러 원천 차단
                await postPage.evaluate(() => {
                  const uploadBtn = document.querySelector('.u_cbox_btn_upload');
                  if (uploadBtn) uploadBtn.click();
                });

                await postPage.waitForTimeout(1500);
                console.log(`✅ [작성 완료] 이웃 새글에 댓글을 남겼습니다.`);

                console.log(`💾 [${blogId}] 이웃 위키(기억)를 업데이트하여 DB에 저장합니다.`);
                await updateNeighborWiki(blogId, updatedWiki.persona, updatedWiki.interaction_history);
              } catch (error) {
                console.log("⚠️ 댓글창이 닫혀있거나 구조가 다릅니다. 댓글 작성을 건너뜁니다.");
              }
            }
          }
        } else {
          console.log(`⚠️ 댓글창을 열 수 없습니다. (비공개 혹은 댓글 막힘)`);
        }

        // DB에 무사히 순회 완료 기록 남기기
        await supabase.from('processed_feed_posts').insert([{ post_id: logNo }]);

      } catch (e) {
        console.error(`❌ ${logNo} 처리 중 에러:`, e.message);
      } finally {
        await postPage.close();
      }

      const delay = 12000 + Math.random() * 5000;
      console.log(`☕ 다음 작업을 위해 ${Math.floor(delay/1000)}초 휴식...\n`);
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