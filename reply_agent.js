require('dotenv').config();
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const BLOG_ID = 'kakaoadd'; 

// =====================================================================
// 💡 DB에서 마지막 번호 가져오기 / 덮어쓰기 함수
// =====================================================================
async function getLastProcessedCommentNo() {
  try {
    const { data } = await supabase.from('bot_settings').select('last_comment_no').eq('id', 1).single();
    if (data && data.last_comment_no) return parseInt(data.last_comment_no, 10);
  } catch (e) { console.log("DB 기억 불러오기 실패:", e); }
  return 0; // 초기값
}

async function saveLastProcessedCommentNo(no) {
  try {
    await supabase.from('bot_settings').upsert({ id: 1, last_comment_no: no.toString() });
    console.log(`💾 [Supabase 저장 완료] 다음엔 댓글 ID: ${no} 이후부터 읽습니다.`);
  } catch (e) { console.log("DB 기억 저장 실패:", e); }
}
// =====================================================================

// 1. 내 블로그용 AI 두뇌
async function generateReply(commentText) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `당신은 IT 기술과 일상을 공유하는 다정한 네이버 블로거입니다. 
        [제약 조건]
        1. 1~2문장으로 짧고 담백하게 작성할 것.
        2. 이모지(이모티콘)는 봇 같은 느낌을 주므로 절대 사용하지 말 것.
        3. 자연스러운 한국어 웃음 표현인 'ㅎㅎ' 나 'ㅋㅋ'를 문장 끝에 한두 번만 사용할 것.
        4. 편안하고 친근한 구어체(~해요, ~맞아요 등)를 사용할 것.
        5. (매우 중요) 부연 설명, 상황에 대한 혼잣말 등을 절대 출력하지 말고, 오직 '답글 텍스트' 하나만 출력할 것.`
      },
      {
        role: "user",
        content: `내 포스팅에 방문자가 다음과 같은 댓글을 남겼습니다: "${commentText}"`
      }
    ],
    temperature: 0.7, 
    max_tokens: 100, 
  });
  return response.choices[0].message.content.trim();
}

// 2. 이웃 블로그용 AI 두뇌
async function generateNeighborComment(postText) {
  const shortText = postText.length > 800 ? postText.substring(0, 800) : postText;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `당신은 네이버 블로그 이웃의 새 글을 읽고 소통하러 온 다정한 방문자입니다. 
        [제약 조건]
        1. 본문 내용을 바탕으로 1~2문장의 공감하는 댓글을 담백하게 작성할 것.
        2. 이모지(이모티콘) 절대 금지. 'ㅎㅎ' 나 'ㅋㅋ'를 자연스럽게 섞어 쓸 것.
        3. 블로그 내용과 전혀 상관없는 매크로성 인사(잘보고 갑니다, 서이추 해요 등)는 절대 금지.
        4. (매우 중요) 부연 설명 없이 오직 '댓글 본문'만 출력할 것.`
      },
      {
        role: "user",
        content: `다음은 이웃 블로그의 최신 포스팅 본문입니다. 읽고 공감하는 댓글을 달아주세요: \n\n"${shortText}"` 
      }
    ],
    temperature: 0.7, 
    max_tokens: 100, 
  });
  return response.choices[0].message.content.trim();
}

async function runAgent() {
  console.log('🤖 네이버 블로그 자동화 에이전트 시작...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  // 💡 feed_agent.js에서 정상 작동한 순정 세팅으로 원복! (아이폰 위장 제거)
  const context = await browser.newContext({ storageState: 'state.json' });
  const page = await context.newPage();

  page.setDefaultTimeout(60000);

  try {
    console.log(`🔍 [탐색] 내 블로그(${BLOG_ID})의 가장 최신 글 번호를 찾고 있습니다...`);
    
    await page.goto(`https://m.blog.naver.com/${BLOG_ID}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000); // 💡 feed_agent.js와 동일하게 3초 넉넉히 대기

    const latestLogNo = await page.evaluate((id) => {
      const links = Array.from(document.querySelectorAll('a'));
      let maxLogNo = 0;
      
      for (const a of links) {
        const href = a.getAttribute('href');
        if (href && href.toLowerCase().includes(id.toLowerCase()) && /\d{10,}/.test(href) && !href.includes('comment') && !href.includes('profile')) {
          const numMatch = href.match(/(\d{10,})/);
          if (numMatch) {
            const num = parseInt(numMatch[1], 10);
            if (num > maxLogNo) {
              maxLogNo = num;
            }
          }
        }
      }
      return maxLogNo > 0 ? maxLogNo.toString() : null;
    }, BLOG_ID);

    if (!latestLogNo) {
      console.log('❌ 최신 게시글을 찾지 못했습니다. 스크립트를 종료합니다.');
      return;
    }

    const POST_NO = latestLogNo;
    console.log(`✅ [성공] 최신 게시글 번호 장착 완료: ${POST_NO}`);

    // =================================================================
    // 🚀 [궁극의 치트키] 본문을 거치지 않고 '댓글 전용 페이지'로 다이렉트 진입!
    // =================================================================
    const commentUrl = `https://m.blog.naver.com/CommentList.naver?blogId=${BLOG_ID}&logNo=${POST_NO}`;
    console.log(`[이동] 내 블로그 댓글 전용 페이지로 순간이동: ${commentUrl}`);
    
    await page.goto(commentUrl, { waitUntil: 'domcontentloaded' });
    
    // 💡 버튼을 누를 필요 없이, 이미 열려있는 댓글창에 댓글 데이터가 뜰 때까지만 기다립니다.
    console.log('[동작] 댓글 데이터 로딩 대기 중...');
    try {
      await page.waitForSelector('.u_cbox_comment', { state: 'attached', timeout: 10000 });
      console.log('✅ 댓글 목록 로딩 완료!');
    } catch (e) {
      console.log('⚠️ 달린 댓글이 없거나, 댓글창이 닫혀있습니다.');
    }
    await page.waitForTimeout(2000); 

    // 💡 [안전망] 윗 단계에서 클릭이 안 되었거나 댓글이 없으면 빈 배열 반환
    const rawDataInfos = await page.$$eval('.u_cbox_comment', elements => 
      elements.map(el => el.getAttribute('data-info')).filter(info => info)
    ).catch(() => []); 

    console.log(`총 ${rawDataInfos.length}개의 댓글 데이터를 분석합니다...`);

    // ... (이 아래에 있는 const repliedParentIds = new Set(); 부터는 기존 코드 그대로 두시면 됩니다!)

    const repliedParentIds = new Set();
    const parsedComments = [];

    for (const dataInfo of rawDataInfos) {
      const commentNoMatch = dataInfo.match(/commentNo:'(\d+)'/);
      const parentMatch = dataInfo.match(/parentCommentNo:'(\d+)'/);
      const replyLevelMatch = dataInfo.match(/replyLevel:(\d+)/);
      const mineMatch = dataInfo.match(/mine:(true|false)/);
      const deletedMatch = dataInfo.match(/deleted:(true|false)/);

      const commentNo = commentNoMatch ? commentNoMatch[1] : null;
      const parentNo = parentMatch ? parentMatch[1] : null;
      const replyLevel = replyLevelMatch ? parseInt(replyLevelMatch[1]) : 1;
      const isMine = mineMatch ? mineMatch[1] === 'true' : false;
      const isDeleted = deletedMatch ? deletedMatch[1] === 'true' : false;
      
      if (isMine && replyLevel > 1 && parentNo) {
        repliedParentIds.add(parentNo);
      }

      parsedComments.push({ commentNo, parentNo, replyLevel, isMine, isDeleted });
    }

    const lastProcessedNo = await getLastProcessedCommentNo();
    let currentSessionMaxNo = lastProcessedNo;

    let index = 1;
    for (const comment of parsedComments) {
      const { commentNo, replyLevel, isMine, isDeleted } = comment;
      
      console.log(`\n--- [${index}]번째 댓글 확인 중 (ID: ${commentNo}) ---`);
      index++;

      if (!commentNo || isDeleted || isMine || replyLevel > 1) {
        console.log('[패스] 삭제/내댓글/대댓글은 무시합니다.');
        continue;
      }

      const currentNoInt = parseInt(commentNo, 10);
      if (currentNoInt <= lastProcessedNo) {
        console.log(`⏩ [스킵] 이미 예전에 확인했던 옛날 댓글입니다. DB 조회 없이 넘어갑니다.`);
        continue;
      }

      if (currentNoInt > currentSessionMaxNo) {
        currentSessionMaxNo = currentNoInt;
      }

      const commentLocator = page.locator(`.u_cbox_comment[data-info*="commentNo:'${commentNo}'"]`).first();
      if (await commentLocator.count() === 0) continue;
      
      let alreadyReplied = repliedParentIds.has(commentNo);
      if (!alreadyReplied) {
        const { data } = await supabase.from('processed_comments').select('comment_id').eq('comment_id', commentNo);
        if (data && data.length > 0) alreadyReplied = true;
      }

      if (alreadyReplied) {
        console.log(`[내 블로그] 이미 답글이 달린 댓글입니다. 이웃 답방 로직으로 넘어갑니다.`);
      } else {
        const commentText = await commentLocator.locator('.u_cbox_contents').first().innerText();
        console.log(`✨ [새 댓글 발견!] 내용: ${commentText}`);

        const aiReplyText = await generateReply(commentText);
        console.log(`💬 [내 블로그 AI 답글] ${aiReplyText}`);

        await commentLocator.locator('.u_cbox_btn_reply').first().click({ force: true });
        await page.waitForTimeout(1000); 
        await page.fill('.u_cbox_text', aiReplyText);
        
        const replyUploadBtn = page.locator('.u_cbox_btn_upload').first();
        await replyUploadBtn.scrollIntoViewIfNeeded(); 
        await replyUploadBtn.click({ force: true, delay: 150 });
        await page.waitForTimeout(1500);
        
        await supabase.from('processed_comments').insert([{ comment_id: commentNo }]);
        console.log(`✅ [답글 작성 완료]`);
        await page.waitForTimeout(3000 + Math.random() * 1000);
      }
      
      // -------------------------------------------------------------
      // 2. 이웃 블로그 방문 (답방)
      // -------------------------------------------------------------
      try {
        const profileHref = await commentLocator.locator('a.u_cbox_name, a.u_cbox_thumb_wrap').first().getAttribute('href').catch(() => null);
        let neighborId = null;

        if (profileHref && profileHref !== '#' && !profileHref.includes('javascript')) {
          try {
            const urlObj = new URL(profileHref, 'https://m.blog.naver.com');
            neighborId = urlObj.searchParams.get('blogId');
            if (!neighborId) {
              const pathParts = urlObj.pathname.split('/').filter(p => p);
              if (pathParts.length > 0 && !pathParts[0].includes('PostList')) {
                neighborId = pathParts[0];
              }
            }
          } catch (e) {}
        }
        
        if (neighborId) {
          const { data: visitedData } = await supabase.from('visited_neighbors').select('neighbor_id').eq('neighbor_id', neighborId);
          
          if (visitedData && visitedData.length > 0) {
            console.log(`[답방 패스] 이미 답방을 다녀온 이웃입니다. (ID: ${neighborId})`);
          } else {
            console.log(`🚀 [답방 출발] 이웃(${neighborId})의 블로그 홈으로 이동합니다...`);
            
            const neighborPage = await context.newPage();
            neighborPage.setDefaultTimeout(60000);
            
            await neighborPage.goto(`https://m.blog.naver.com/${neighborId}`, { waitUntil: 'domcontentloaded' });
            await neighborPage.waitForTimeout(3000); 
            
            let postBodyLocator = neighborPage.locator('.se-main-container, .se_component_wrap, .post_ct').first();
            let isAlreadyInPost = await postBodyLocator.count() > 0;

            if (!isAlreadyInPost) {
              const latestPostUrl = await neighborPage.evaluate((id) => {
                const links = Array.from(document.querySelectorAll('a'));
                const targetId = id.toLowerCase();
                let maxLogNo = 0;
                let bestHref = null;
                
                for (const a of links) {
                  const originalHref = a.getAttribute('href');
                  if (!originalHref) continue;
                  
                  const href = originalHref.toLowerCase();
                  const hasId = href.includes(`/${targetId}/`) || href.includes(`blogid=${targetId}`);
                  const isNotSystem = !href.includes('comment') && !href.includes('profile') && !href.includes('category') && !href.includes('guestbook');
                  
                  if (hasId && isNotSystem) {
                    const numberMatch = href.match(/(\d{10,})/); 
                    if (numberMatch) {
                      const currentLogNo = parseInt(numberMatch[1], 10);
                      if (currentLogNo > maxLogNo) {
                        maxLogNo = currentLogNo;
                        bestHref = originalHref;
                      }
                    }
                  }
                }
                return bestHref;
              }, neighborId);

              if (latestPostUrl) {
                console.log(`🔗 [답방 진입] 최신 게시글 발견! 들어갑니다.`);
                const fullUrl = latestPostUrl.startsWith('http') ? latestPostUrl : `https://m.blog.naver.com${latestPostUrl}`;
                
                await neighborPage.goto(fullUrl, { waitUntil: 'domcontentloaded' });
                await neighborPage.waitForTimeout(3000);
                
                postBodyLocator = neighborPage.locator('.se-main-container, .se_component_wrap, .post_ct').first();
              } else {
                console.log(`⚠️ [답방 패스] 클릭할 수 있는 최신 글이 없습니다.`);
              }
            }

            if (await postBodyLocator.count() > 0) {
              const postText = await postBodyLocator.innerText();
              const neighborComment = await generateNeighborComment(postText);
              console.log(`💬 [이웃 블로그 AI 댓글] ${neighborComment}`);

              await neighborPage.evaluate(() => window.scrollBy(0, 2000));
              await neighborPage.waitForTimeout(1500);
              
              let skipBecauseAlreadyLiked = false;

              try {
                const likeBtn = neighborPage.locator('a.u_likeit_list_btn, button.u_likeit_list_btn').first();
                if (await likeBtn.count() > 0) {
                  const isLiked = await likeBtn.evaluate(el => 
                    el.getAttribute('aria-pressed') === 'true' || 
                    el.classList.contains('on') || 
                    el.querySelector('.u_likeit_icon.on') !== null
                  );

                  if (isLiked) {
                    console.log(`🚫 [공감 체크] 이미 공감 상태입니다. 도망칩니다.`);
                    skipBecauseAlreadyLiked = true;
                  } else {
                    await likeBtn.click({ force: true });
                    console.log(`❤️ [공감 완료] 하트를 눌렀습니다.`);
                    await neighborPage.waitForTimeout(1000);
                  }
                }
              } catch (e) { console.log('⚠️ 공감 버튼 처리 중 오류'); }

              if (skipBecauseAlreadyLiked) {
                await supabase.from('visited_neighbors').insert([{ neighbor_id: neighborId }]);
              } else {
                const neighborCommentBtn = neighborPage.locator('.icon__seNf8, .num__OVfhz').first();
                
                if (await neighborCommentBtn.count() > 0) {
                  await neighborCommentBtn.click({ force: true });
                  await neighborPage.waitForTimeout(3000); 
                  
                  const myCommentCount = await neighborPage.$$eval('.u_cbox_comment', elements => {
                    return elements.filter(el => {
                      const info = el.getAttribute('data-info');
                      return info && info.includes('mine:true');
                    }).length;
                  }).catch(() => 0);

                  if (myCommentCount > 0) {
                    console.log(`🚫 [답방 패스] 이 게시글에는 이미 내가 남긴 댓글이 존재합니다! (중복 작성 방지)`);
                    await supabase.from('visited_neighbors').insert([{ neighbor_id: neighborId }]);
                  } else {
                    await neighborPage.locator('.u_cbox_text').first().click({ force: true });
                    await neighborPage.waitForTimeout(500);

                    await neighborPage.fill('.u_cbox_text', neighborComment);
                    await neighborPage.waitForTimeout(500);

                    await neighborPage.evaluate(() => {
                      const uploadBtn = document.querySelector('.u_cbox_btn_upload');
                      if (uploadBtn) uploadBtn.click();
                    });
                    console.log(`✅ [답방 완료] 이웃 블로그에 공감 댓글을 남겼습니다.`);
                    
                    await supabase.from('visited_neighbors').insert([{ neighbor_id: neighborId }]);
                  }
                } else {
                  console.log(`⚠️ [답방 패스] 이웃 블로그의 댓글창이 닫혀있습니다.`);
                }
              }
            } else {
              console.log(`⚠️ [답방 패스] 사진만 있거나 텍스트를 읽을 수 없는 글입니다.`);
            }
            
            await neighborPage.close();
            console.log(`[답방 복귀] 내 블로그로 무사히 돌아왔습니다.`);
            
            console.log('봇 차단을 피하기 위해 10초 이상 휴식합니다... ☕');
            await page.waitForTimeout(10000 + Math.random() * 5000);
          }
        } else {
           console.log(`⚠️ [답방 패스] 이웃의 블로그 아이디를 찾을 수 없는 사용자입니다.`);
        }
      } catch (neighborError) {
        console.log(`⚠️ [답방 중 에러] 이웃 블로그 처리 중 문제가 발생했습니다. 무시하고 넘어갑니다.`);
      }
    }

    if (currentSessionMaxNo > lastProcessedNo) {
      await saveLastProcessedCommentNo(currentSessionMaxNo);
    }
    
  } catch (error) {
    console.error('❌ 실행 중 에러 발생:', error);
  } finally {
    console.log('\n✅ 모든 작업을 마치고 브라우저를 종료합니다.');
    await browser.close();
  }
}

runAgent();