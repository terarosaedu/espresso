// 교육생 화면과 강사 화면이 함께 쓰는 설정
const CFG = window.APP_CONFIG || {};
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
const BUCKET = 'ev-photos';

// 실습 피드백 세부 항목 (여기만 고치면 화면에 반영됨)
const ESPRESSO_GROUPS = [
  { group: null, items: ['추출 루틴', '주변 정리', '분쇄도 조절', '추출량 확인', '머신 오픈', '머신 마감'] },
];
const MILK_GROUPS = [
  { group: null, items: ['공기 주입(스트레칭)', '롤링', '온도', '안정화'] },
  { group: '푸어링', items: ['피쳐 높이', '타점 위치', '핸들링', '각도'] },
  { group: null, items: ['라테아트 형태'] },
];
const CATEGORIES = [
  { key: 'espresso', label: '에스프레소', groups: ESPRESSO_GROUPS },
  { key: 'latte', label: '카페라테', groups: MILK_GROUPS },
  { key: 'cappuccino', label: '카푸치노', groups: MILK_GROUPS },
];
const CAT_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.key, c.label]));
const itemValue = (group, item) => (group ? `${group}(${item})` : item);

// 만족도 조사
const SURVEY = [
  { key: 'q1', section: '커피 이론', text: '교육자의 교육 내용이 효과적으로 잘 전달 되었는가' },
  { key: 'q2', section: '커피 이론', text: '해당 교육 내용이 지식 학습 효과에 기여하였는가' },
  { key: 'q3', section: '커피 실습', text: '교육자의 교육 내용이 효과적으로 잘 전달 되었는가' },
  { key: 'q4', section: '커피 실습', text: '해당 교육 내용이 기술 학습 효과에 기여하였는가' },
];
const SURVEY_COMMENT = '에스프레소 베리에이션 교육의 총평을 남겨 주십시오.';
const SCALE_LOW = '전혀 그렇지 않다';
const SCALE_HIGH = '매우 그렇다';

const PHOTO_KINDS = [
  { key: 'latte', label: '카페라테', sample: 'assets/sample-latte.jpg' },
  { key: 'cappuccino', label: '카푸치노', sample: 'assets/sample-cappuccino.jpg' },
];

// 날짜·시간 (한국 시간 기준)
function todayKST() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}
function nowKST() {
  return new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
}
function timeKST(ts) {
  return new Date(ts).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
}
function dateKST(ts) {
  return new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}
function dayIndexOf(dates, d = todayKST()) {
  return (dates || []).indexOf(d) + 1; // 0이면 교육일 아님
}
function shortDate(d) {
  const [, m, day] = d.split('-');
  return `${Number(m)}/${Number(day)}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

// 총평 스킬에 넣을 텍스트
function buildReviewText(name, code, feedback) {
  const lines = [`[교육생] ${name} (기수 ${code})`];
  for (const c of CATEGORIES) {
    lines.push(`[${c.label}]`);
    const rows = feedback
      .filter(f => f.category === c.key)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (!rows.length) lines.push('- 기록 없음');
    rows.forEach(f => {
      const day = f.day ? `${f.day}일차` : '교육일 외';
      const items = f.items && f.items.length ? f.items.join(', ') : '항목 미선택';
      const state = f.resolved ? '교정됨' : '연습 중';
      lines.push(`- ${day} | ${items} | ${state} | ${String(f.memo || '').replace(/\s+/g, ' ').trim()}`);
    });
  }
  return lines.join('\n');
}

function friendlyError(err) {
  const msg = String(err?.message || err || '');
  if (msg.includes('COHORT_NOT_FOUND')) return '기수 코드를 찾을 수 없어요. 강사님께 받은 코드를 다시 확인해 주세요.';
  if (msg.includes('NAME_REQUIRED')) return '이름을 입력해 주세요.';
  if (err?.status === 429 || /rate limit/i.test(msg)) return '접속이 한꺼번에 몰렸어요. 1분 뒤 다시 시도해 주세요.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return '인터넷 연결을 확인하고 다시 시도해 주세요.';
  return `저장하지 못했어요. 다시 시도해 주세요. (${msg})`;
}
