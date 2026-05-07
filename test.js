const axios = require('axios');

// 💡 여기에 회원님의 'REST API 키'를 직접 붙여넣어 보세요! (따옴표는 유지)
const KAKAO_KEY = "46494199d6955827e8e6b75383d7e677"; 

async function runTest() {
  try {
    console.log("🔍 카카오 API 통신 테스트 시작...");
    
    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent('혜정닭갈비')}`;
    const response = await axios.get(url, {
      headers: { 'Authorization': `KakaoAK ${KAKAO_KEY}` }
    });

    console.log("✅ 통신 대성공! 첫 번째 검색 결과:", response.data.documents[0].place_name);
    console.log("📍 주소:", response.data.documents[0].road_address_name);
    
  } catch (error) {
    if (error.response) {
      console.error("❌ 카카오가 거절한 진짜 이유:", error.response.data);
    } else {
      console.error("❌ 에러:", error.message);
    }
  }
}

runTest();