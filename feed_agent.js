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
  
  // 🚨 [핵심 해결책 1] 봇에게 완벽한 아이폰(iPhone 12 Pro) 환경을 씌워줍니다!
  const context = await browser.newContext({
    storageState: 'state.json',
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    isMobile: true,  // 👈 [추가 1] 나 진짜 모바일 기기야!
    hasTouch: true   // 👈 [추가 2] 나 마우스 없고 터치스크린이야!
  });

  context.setDefaultTimeout(60000);

  const feedPage = await context.newPage();

  try {
    let allUniquePosts = [];
    const seen = new Set();

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

    for (const post of allUniquePosts) {
      const { blogId, logNoStr: logNo } = post;

      const wiki = await getNeighborWiki(blogId);
      if (wiki.last_visited_at) {
        const lastVisit = new Date(wiki.last_visited_at);
        const hoursSinceLastVisit = Math.abs(new Date() - lastVisit) / 36e5;
        if (hoursSinceLastVisit < 12) {
          console.log(`⏳ [${blogId}]님은 ${Math.round(hoursSinceLastVisit)}시간 전에 방문했습니다. (도배 방지 스킵)`);
          continue;
        }
      }

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

        const currentUrl = postPage.url();
        const pageTitle = await postPage.title();
        console.log(`👀 봇 시야 확인 - 현재 주소: ${currentUrl}`);
        console.log(`👀 봇 시야 확인 - 창 제목: ${pageTitle}`);

        const postBody = postPage.locator('.se-main-container, .se_component_wrap, .post_ct').first();
        if (await postBody.count() === 0) {
          console.log(`⚠️ 본문을 찾을 수 없음: ${logNo}`);
          continue;
        }

        const postText = await postBody.innerText();

        // 🚨 [핵심 해결책 2] 사람처럼 부드럽게 스크롤을 여러 번 내려서 버튼 로딩 유도
        await postPage.evaluate(async () => {
          for(let i=0; i<6; i++) {
            window.scrollBy(0, window.innerHeight * 0.8);
            await new Promise(r => setTimeout(r, 400));
          }
        });

        // --- [공감 로직 (순수 JS 기반 타겟팅)] ---
        console.log(`❤️ [공감 시도]`);
        const likeStatus = await postPage.evaluate(() => {
          const btns = document.querySelectorAll('.u_likeit_button, [data-click-area*="sym"], .area_sympathy a');
          for (const btn of btns) {
            // 이미 좋아요가 눌려있는지 확인
            if (btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('on')) {
              return 'already_liked';
            }
            // 버튼이 화면에 보이면 클릭!
            if (btn.offsetParent !== null) { 
              btn.click(); 
              return 'clicked'; 
            }
          }
          return 'not_found';
        });

        if (likeStatus === 'clicked') {
          console.log(`✅ 공감 버튼을 사람처럼 꾹~ 눌렀습니다.`);
          await postPage.waitForTimeout(2000);
        } else if (likeStatus === 'already_liked') {
          console.log(`🚫 이미 하트가 켜져 있습니다.`);
        } else {
          console.log(`⚠️ 공감 버튼을 화면에서 찾을 수 없습니다.`);
        }

        // --- [댓글 오픈 로직 (순수 JS 기반 타겟팅)] ---
        console.log(`💬 [댓글 작업] 댓글창을 찾습니다...`);
        const commentOpened = await postPage.evaluate(() => {
          // 💡 [더 강력한 타겟팅] 네이버가 사용하는 모든 댓글창 오픈 버튼 선택자 총동원
          const selectors = [
            'button[data-click-area*="re"]', // 캡처에서 확인된 속성
            'a.btn_comment',                 // 일반적인 댓글 버튼
            '.area_comment .btn_comment',    // 영역 내 댓글 버튼
            'button.comment_btn__*',         // 캡처에서 확인된 랜덤 클래스 대응
            'div[class*="comment_btn"] button',
            'a[href*="comment"]',
            '.u_cbox_btn_reply'              // 기존 방식
          ];
          
          for (const selector of selectors) {
            const btns = document.querySelectorAll(selector);
            for (const btn of btns) {
              if (btn.offsetParent !== null) { // 화면에 보이는 버튼만
                btn.click();
                return true;
              }
            }
          }
          return false;
        });

        if (commentOpened) {
          await postPage.waitForTimeout(2500);

          const alreadyCommented = await postPage.$$eval('.u_cbox_comment', elements => {
            return elements.some(el => {
              const info = el.getAttribute('data-info');
              return info && info.includes('mine:true');
            });
          });

          if (alreadyCommented) {
            console.log(`🚫 [중복 방지] 이미 내가 작성한 댓글이 있습니다. 건너뜁니다.`);
            await supabase.from('visited_neighbors').insert([{ neighbor_id: blogId }]);
          } else {
            const loginGuide = postPage.locator('.u_cbox_guide').first();
            const isLoginRequired = await loginGuide.count() > 0 && await loginGuide.innerText().then(t => t.includes('로그인'));

            if (isLoginRequired) {
              console.log(`⚠️ [세션 만료] '로그인 해주세요' 안내문이 감지되었습니다. 댓글 작성을 건너뜁니다.`);
            } else {
              console.log(`📝 [${blogId}] 위키(기억) 정보를 바탕으로 맞춤형 댓글을 고민 중...`);

              const { myComment, updatedWiki } = await generateWikiComment(wiki, postText);
              console.log(`💬 [AI 맞춤 댓글] ${myComment}`);

              try {
                // 댓글 입력창 포커스 및 작성
                const commentBox = postPage.locator('.u_cbox_text').first();
                await commentBox.waitFor({ state: 'visible', timeout: 5000 });
                await commentBox.scrollIntoViewIfNeeded();
                await commentBox.click({ force: true }).catch(()=>{}); 
                await postPage.waitForTimeout(500);

                await commentBox.fill(myComment);
                await postPage.waitForTimeout(1000);

                // 💡 [핵심 해결책 3] 등록 버튼도 순수 JS로 멱살 잡고 클릭
                await postPage.evaluate(() => {
                  const uploadBtn = document.querySelector('.u_cbox_btn_upload');
                  if (uploadBtn) uploadBtn.click();
                });

                await postPage.waitForTimeout(1500);
                console.log(`✅ [작성 완료] 이웃 새글에 댓글을 남겼습니다.`);

                console.log(`💾 [${blogId}] 이웃 위키(기억)를 업데이트하여 DB에 저장합니다.`);
                await updateNeighborWiki(blogId, updatedWiki.persona, updatedWiki.interaction_history);
                await supabase.from('visited_neighbors').insert([{ neighbor_id: blogId }]);

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