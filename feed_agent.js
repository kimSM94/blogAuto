require('dotenv').config();
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ==========================================
// 🧠 1부: LLM Wiki (기억 장치) 로직
// ==========================================

async function getNeighborWiki(blogId) {
  const { data, error } = await supabase
    .from('neighbor_wiki')
    .select('*')
    .eq('blog_id', blogId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('위키 조회 에러:', error.message);
  }
  return data || { persona: '첫 방문', interaction_history: '기록 없음', last_visited_at: null };
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
  const commentResponse = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `너는 내 블로그의 다정하고 센스 있는 소통 에이전트야. 방문한 이웃의 위키(기억)를 참고해서 친근하게 댓글을 달아줘.
        
        [이웃 위키 정보]
        - 이웃 특징(관심사): ${wiki.persona}
        - 과거 소통 기록: ${wiki.interaction_history}
        
        [작성 규칙]
        1. 과거 소통 기록에 있는 말(예: 첫인사)은 절대 반복하지 말 것.
        2. 이웃의 특징이나 과거 맥락을 살짝 언급하며 이어갈 것.
        3. 새 글 내용에 공감하는 반응을 보일 것.
        4. 로봇처럼 보이지 않게 2~3문장으로 짧고 자연스럽게 작성할 것.`
      },
      { role: "user", content: `새 글 내용: ${postContent}` }
    ]
  });

  const myComment = commentResponse.choices[0].message.content.trim();

  const wikiUpdateResponse = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `방금 이웃의 글을 읽고 댓글을 달았어. 이 이웃에 대한 위키(기억)를 최신화해줘. 출력은 반드시 JSON 형식으로 해줘.
        {"persona": "이웃의 주요 관심사 (누적해서 업데이트)", "interaction_history": "지금까지 나눈 소통 핵심 요약 (방금 단 댓글 내용 포함)"}`
      },
      { role: "user", content: `기존 위키: ${JSON.stringify(wiki)}\n이번 글 내용: ${postContent}\n내가 방금 단 댓글: ${myComment}` }
    ]
  });

  const updatedWiki = JSON.parse(wikiUpdateResponse.choices[0].message.content);
  return { myComment, updatedWiki };
}

// ==========================================
// 🏃‍♂️ 2부: 실제 네이버 블로그 접속 및 순회 로직
// ==========================================

async function processNeighborPost(page, blogId, postContent, postUrl) {
  console.log(`\n🔍 [${blogId}] 이웃의 위키(기억)를 조회합니다...`);
  const wiki = await getNeighborWiki(blogId);

  // 🛡️ [방어 로직] 12시간 이내 방문 스킵
  if (wiki.last_visited_at) {
    const lastVisit = new Date(wiki.last_visited_at);
    const hoursSinceLastVisit = Math.abs(new Date() - lastVisit) / 36e5;
    if (hoursSinceLastVisit < 12) {
      console.log(`⏳ ${blogId}님은 ${Math.round(hoursSinceLastVisit)}시간 전에 방문했습니다. 스킵합니다.`);
      return; 
    }
  }

  console.log(`📝 [${blogId}] 위키 정보를 바탕으로 맞춤형 댓글을 고민 중...`);
  const { myComment, updatedWiki } = await generateWikiComment(wiki, postContent);

  // 해당 포스트로 이동하여 댓글 달기 (모바일 버전 기준)
  console.log(`🚀 [${blogId}] 포스트로 이동하여 댓글을 작성합니다.`);
  await page.goto(postUrl, { waitUntil: 'domcontentloaded' });
  
  try {
    // 댓글 창 열기 및 입력 (네이버 블로그 모바일 UI 기준)
    await page.waitForSelector('.btn_reply', { timeout: 5000 });
    await page.click('.btn_reply');
    await page.waitForSelector('.u_cbox_text', { timeout: 5000 });
    await page.fill('.u_cbox_text', myComment);
    
    // 등록 버튼 클릭 (실제 봇 가동 시 아래 주석 해제)
    await page.click('.u_cbox_btn_upload'); 
    await page.waitForTimeout(2000); 

    console.log(`✅ [댓글 작성 완료] ${myComment}`);

    console.log(`💾 [${blogId}] 이웃 위키(기억)를 업데이트하여 DB에 저장합니다.`);
    await updateNeighborWiki(blogId, updatedWiki.persona, updatedWiki.interaction_history);
  } catch (err) {
    console.log(`❌ [${blogId}] 댓글 창을 찾을 수 없거나 에러가 발생했습니다. (댓글 막힘 등)`);
  }
}

async function runFeedAgent() {
  console.log("🌟 [이웃새글] 피드 자동화 에이전트 시작...");
  
  // 깃허브 액션 환경을 위한 headless 설정
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }); 
  const context = await browser.newContext({
      storageState: 'state.json' // 로그인 세션 유지
  });
  const page = await context.newPage();

  try {
    // 네이버 모바일 이웃 피드 접속
    console.log("🌐 네이버 이웃 피드에 접속합니다...");
    await page.goto('https://m.blog.naver.com/FeedList.naver', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // 피드 목록 가져오기
    const feedItems = await page.$$('.item.post._feed_item');
    console.log(`총 ${feedItems.length}개의 최신 글을 발견했습니다.`);

    for (let item of feedItems) {
      // 작성자 아이디, 포스트 링크, 글 내용 추출
      const blogId = await item.getAttribute('data-blog-id');
      const postUrl = await item.getAttribute('data-link');
      const postContent = await item.innerText();

      if (blogId && postUrl) {
        // 위키 봇에게 일거리 넘겨주기
        await processNeighborPost(page, blogId, postContent, postUrl);
      }
    }

  } catch (error) {
    console.error("🚨 에러 발생:", error);
  } finally {
    await browser.close();
    console.log("✅ 모든 작업을 마치고 브라우저를 종료합니다.");
  }
}

// 프로그램 실행 버튼! (이게 있어야 작동합니다)
runFeedAgent();