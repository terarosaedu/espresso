(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const LAST_COHORT = 'ev_admin_last_cohort';

  const st = { cohorts: [], cohort: null, students: [], att: [], fb: [], photos: [], surveys: [], current: null };

  init();

  async function init() {
    bind();
    const { data: { session } } = await sb.auth.getSession();
    if (session && !session.user.is_anonymous && await isAdmin()) return enter();
    if (session && session.user.is_anonymous) await sb.auth.signOut();
    showLogin();
  }

  async function isAdmin() {
    const { data, error } = await sb.rpc('ev_is_admin');
    return !error && data === true;
  }

  function showLogin() {
    $('#adminLogin').hidden = false;
    $('#adminMain').hidden = true;
    $('#adminLogout').hidden = true;
  }

  async function onLogin(e) {
    e.preventDefault();
    const err = $('#adminLoginError');
    err.hidden = true;
    const { error } = await sb.auth.signInWithPassword({ email: $('#adminEmail').value.trim(), password: $('#adminPw').value });
    if (error) {
      err.textContent = '이메일 또는 비밀번호가 맞지 않아요.';
      err.hidden = false;
      return;
    }
    if (!(await isAdmin())) {
      err.textContent = '강사 권한이 없는 계정이에요. ev_admins 테이블에 이 계정을 등록해 주세요.';
      err.hidden = false;
      await sb.auth.signOut();
      return;
    }
    enter();
  }

  async function enter() {
    $('#adminLogin').hidden = true;
    $('#adminMain').hidden = false;
    $('#adminLogout').hidden = false;
    await loadCohorts();
  }

  async function loadCohorts(selectId) {
    const { data, error } = await sb.from('ev_cohorts').select('*').order('created_at', { ascending: false });
    if (error) return toast(friendlyError(error));
    st.cohorts = data || [];
    const sel = $('#cohortSelect');
    sel.innerHTML = st.cohorts.map(c =>
      `<option value="${c.id}">${esc(c.code)}  ${esc(c.title)}  (${(c.dates || []).map(shortDate).join(', ')})</option>`
    ).join('');
    $('#noCohort').hidden = st.cohorts.length > 0;
    $('#cohortView').hidden = st.cohorts.length === 0;
    if (!st.cohorts.length) return;
    const want = selectId || localStorage.getItem(LAST_COHORT);
    sel.value = st.cohorts.some(c => c.id === want) ? want : st.cohorts[0].id;
    await loadCohort(sel.value);
  }

  async function loadCohort(id) {
    localStorage.setItem(LAST_COHORT, id);
    st.cohort = st.cohorts.find(c => c.id === id);
    const { data: students, error } = await sb.from('ev_students').select('*').eq('cohort_id', id).order('name');
    if (error) return toast(friendlyError(error));
    st.students = students || [];
    const ids = st.students.map(s => s.id);
    if (ids.length) {
      const [att, fb, ph, sv] = await Promise.all([
        sb.from('ev_attendance').select('*').in('student_id', ids),
        sb.from('ev_feedback').select('*').in('student_id', ids).order('created_at'),
        sb.from('ev_photos').select('*').in('student_id', ids),
        sb.from('ev_surveys').select('*').in('student_id', ids),
      ]);
      st.att = att.data || [];
      st.fb = fb.data || [];
      st.photos = ph.data || [];
      st.surveys = sv.data || [];
    } else {
      st.att = st.fb = st.photos = st.surveys = [];
    }
    render();
  }

  // ---------- 화면 ----------
  const attOf = (sid, day) => st.att.find(a => a.student_id === sid && a.day === day);
  const photoOf = (sid, kind) => st.photos.find(p => p.student_id === sid && p.kind === kind);
  const surveyOf = sid => st.surveys.find(s => s.student_id === sid);
  const fbOf = sid => st.fb.filter(f => f.student_id === sid);

  function attCell(sid, day) {
    const a = attOf(sid, day);
    if (a) return a.status === '지각'
      ? `<span class="late">지각 ${timeKST(a.checked_at)}</span>`
      : `출석 <span class="dim">${timeKST(a.checked_at)}</span>`;
    const date = st.cohort.dates?.[day - 1];
    return date && date <= todayKST() ? '<span class="dim">미체크</span>' : '';
  }

  function render() {
    const n = st.students.length;
    const surveyed = st.surveys.length;
    const photoDone = st.students.filter(s => photoOf(s.id, 'latte') && photoOf(s.id, 'cappuccino')).length;
    const avg = k => (surveyed ? (st.surveys.reduce((t, s) => t + s[k], 0) / surveyed).toFixed(2) : '-');
    $('#stats').innerHTML = `
      <div class="stat"><b>${n}</b><span>입장한 교육생</span></div>
      <div class="stat"><b>${st.fb.length}</b><span>기록된 피드백</span></div>
      <div class="stat"><b>${photoDone}/${n}</b><span>사진 2장 모두 제출</span></div>
      <div class="stat"><b>${surveyed}/${n}</b><span>만족도 제출</span></div>
      ${SURVEY.map(q => `<div class="stat"><b>${avg(q.key)}</b><span>[${q.section}] ${esc(q.text)}</span></div>`).join('')}`;

    const noSurvey = st.students.filter(s => !surveyOf(s.id)).map(s => s.name);
    const noPhoto = st.students.filter(s => !photoOf(s.id, 'latte') || !photoOf(s.id, 'cappuccino')).map(s => s.name);
    $('#missing').innerHTML = `
      <p><b>만족도 미제출 ${noSurvey.length}명</b> ${noSurvey.length ? esc(noSurvey.join(', ')) : '<span class="dim">모두 제출</span>'}</p>
      <p><b>사진 미제출 ${noPhoto.length}명</b> ${noPhoto.length ? esc(noPhoto.join(', ')) : '<span class="dim">모두 제출</span>'}</p>
      <div class="actions"><button class="btn" type="button" id="copyMissing" ${noSurvey.length ? '' : 'disabled'}>만족도 미제출자 이름 복사</button></div>`;
    $('#copyMissing').addEventListener('click', async () => {
      await copyText(noSurvey.join(', '));
      toast('미제출자 이름을 복사했어요');
    });

    $('#studentRows').innerHTML = st.students.length
      ? st.students.map(s => {
          const f = fbOf(s.id);
          const open = f.filter(x => !x.resolved).length;
          return `<tr data-id="${s.id}">
            <td><b>${esc(s.name)}</b></td>
            <td>${attCell(s.id, 1)}</td><td>${attCell(s.id, 2)}</td><td>${attCell(s.id, 3)}</td>
            <td>${f.length}개 <span class="dim">(연습 중 ${open})</span></td>
            <td>${photoOf(s.id, 'latte') ? '제출' : '<span class="dim">없음</span>'}</td>
            <td>${photoOf(s.id, 'cappuccino') ? '제출' : '<span class="dim">없음</span>'}</td>
            <td>${surveyOf(s.id) ? '제출' : '<b>미제출</b>'}</td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="8" class="dim">아직 입장한 교육생이 없어요. 기수 코드 <b>${esc(st.cohort.code)}</b>를 알려 주세요.</td></tr>`;
    $$('#studentRows tr[data-id]').forEach(tr => tr.addEventListener('click', () => openDetail(tr.dataset.id)));
  }

  // ---------- 교육생 상세 ----------
  async function openDetail(sid) {
    const s = st.students.find(x => x.id === sid);
    st.current = s;
    $('#dName').textContent = s.name;
    const f = fbOf(sid);
    const sv = surveyOf(sid);
    const photoHTML = await Promise.all(PHOTO_KINDS.map(async k => {
      const p = photoOf(sid, k.key);
      if (!p) return `<figure style="margin:0"><div class="photo-frame" style="display:grid;place-items:center"><span class="dim small">${k.label} 없음</span></div></figure>`;
      const { data } = await sb.storage.from(BUCKET).createSignedUrl(p.path, 3600);
      const dl = await sb.storage.from(BUCKET).createSignedUrl(p.path, 3600, { download: `${st.cohort.code}_${s.name}_${k.label}.jpg` });
      return `<figure style="margin:0;display:grid;gap:6px">
        <div class="photo-frame"><img src="${data?.signedUrl}" alt="${esc(s.name)} ${k.label}"></div>
        <figcaption><a href="${dl.data?.signedUrl}">${k.label} 내려받기</a></figcaption>
      </figure>`;
    }));

    $('#dBody').innerHTML = `
      <section>
        <h3>근태</h3>
        <p style="margin:0">1일차 ${attCell(sid, 1) || '-'} / 2일차 ${attCell(sid, 2) || '-'} / 3일차 ${attCell(sid, 3) || '-'}</p>
      </section>
      ${CATEGORIES.map(c => {
        const rows = f.filter(x => x.category === c.key);
        return `<section>
          <h3>${c.label} <span class="dim small">${rows.length}개</span></h3>
          <ul class="fb-list">${rows.length ? rows.map(x => `<li class="fb ${x.resolved ? 'resolved' : ''}">
            <div class="fb-meta">
              ${x.day ? `<span class="tag tag-day">${x.day}일차</span>` : ''}
              <span class="tag">${x.resolved ? '교정됨' : '연습 중'}</span>
              ${(x.items || []).map(i => `<span class="tag">${esc(i)}</span>`).join('')}
            </div>
            <p class="fb-memo">${esc(x.memo)}</p></li>`).join('') : '<li class="empty">기록 없음</li>'}</ul>
        </section>`;
      }).join('')}
      <section><h3>베스트 사진</h3><div class="detail-photos">${photoHTML.join('')}</div></section>
      <section>
        <h3>만족도 조사</h3>
        ${sv ? `<ul class="survey-list">${SURVEY.map(q => `<li>[${q.section}] ${esc(q.text)}: <b>${sv[q.key]}</b></li>`).join('')}
          <li>${esc(SURVEY_COMMENT)}<br><b>${esc(sv.comment)}</b></li></ul>` : '<p class="dim" style="margin:0">미제출</p>'}
      </section>`;
    $('#detail').showModal();
  }

  // ---------- 내보내기 ----------
  async function copyAll() {
    if (!st.students.length) return toast('교육생이 없어요');
    const head = `에스프레소 베리에이션 총평 자료\n기수 ${st.cohort.code} / ${st.students.length}명\n형식: 일차 | 피드백 항목 | 교정 여부 | 피드백 내용`;
    const body = st.students.map(s => buildReviewText(s.name, st.cohort.code, fbOf(s.id))).join('\n\n');
    await copyText(`${head}\n\n${body}`);
    toast(`${st.students.length}명 자료를 복사했어요`);
  }

  function csvCell(v) {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function exportCsv() {
    const header = ['기수', '이름',
      '1일차', '1일차 시각', '2일차', '2일차 시각', '3일차', '3일차 시각',
      '피드백 수', '교정됨', '라테 사진', '카푸치노 사진', '만족도 제출',
      ...SURVEY.map(q => `[${q.section}] ${q.text}`), SURVEY_COMMENT];
    const rows = st.students.map(s => {
      const att = [1, 2, 3].flatMap(d => {
        const a = attOf(s.id, d);
        const date = st.cohort.dates?.[d - 1];
        return a ? [a.status, timeKST(a.checked_at)] : [date && date <= todayKST() ? '미체크' : '', ''];
      });
      const f = fbOf(s.id);
      const sv = surveyOf(s.id);
      return [st.cohort.code, s.name, ...att, f.length, f.filter(x => x.resolved).length,
        photoOf(s.id, 'latte') ? 'O' : 'X', photoOf(s.id, 'cappuccino') ? 'O' : 'X', sv ? 'O' : 'X',
        ...SURVEY.map(q => (sv ? sv[q.key] : '')), sv ? sv.comment : ''];
    });
    const csv = '\uFEFF' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `실습노트_${st.cohort.code}_근태_만족도.csv`);
  }

  async function exportZip() {
    if (!st.photos.length) return toast('올라온 사진이 없어요');
    const btn = $('#zipBtn');
    btn.disabled = true;
    const zip = new JSZip();
    let done = 0;
    for (const p of st.photos) {
      const s = st.students.find(x => x.id === p.student_id);
      const label = PHOTO_KINDS.find(k => k.key === p.kind)?.label || p.kind;
      btn.textContent = `사진 모으는 중 ${++done}/${st.photos.length}`;
      const { data, error } = await sb.storage.from(BUCKET).download(p.path);
      if (!error && data) zip.file(`${st.cohort.code}_${s ? s.name : p.student_id}_${label}.jpg`, data);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `실습노트_${st.cohort.code}_사진.zip`);
    btn.disabled = false;
    btn.textContent = '사진 전체 ZIP';
  }

  // ---------- 새 기수 ----------
  function addDays(d, n) {
    const dt = new Date(`${d}T00:00:00+09:00`);
    dt.setDate(dt.getDate() + n);
    return dt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  }

  async function createCohort(e) {
    e.preventDefault();
    const code = $('#cCode').value.trim().toUpperCase();
    const dates = [$('#cD1').value, $('#cD2').value, $('#cD3').value];
    if (!code || dates.some(d => !d)) return toast('코드와 3일 날짜를 모두 입력해 주세요');
    const { data, error } = await sb.from('ev_cohorts')
      .insert({ code, title: $('#cTitle').value.trim() || '에스프레소 베리에이션', dates })
      .select().single();
    if (error) return toast(error.code === '23505' ? '이미 있는 기수 코드예요' : friendlyError(error));
    e.target.reset();
    $('#cTitle').value = '에스프레소 베리에이션';
    $('.new-cohort').open = false;
    toast(`${code} 기수를 만들었어요`);
    await loadCohorts(data.id);
  }

  function bind() {
    $('#adminLoginForm').addEventListener('submit', onLogin);
    $('#adminLogout').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
    $('#cohortSelect').addEventListener('change', e => loadCohort(e.target.value));
    $('#refreshBtn').addEventListener('click', () => st.cohort && loadCohort(st.cohort.id));
    $('#cohortForm').addEventListener('submit', createCohort);
    $('#cD1').addEventListener('change', e => {
      if (!e.target.value) return;
      if (!$('#cD2').value) $('#cD2').value = addDays(e.target.value, 1);
      if (!$('#cD3').value) $('#cD3').value = addDays(e.target.value, 2);
    });
    $('#copyAllBtn').addEventListener('click', copyAll);
    $('#csvBtn').addEventListener('click', exportCsv);
    $('#zipBtn').addEventListener('click', exportZip);
    $('#dClose').addEventListener('click', () => $('#detail').close());
    $('#dCopy').addEventListener('click', async () => {
      const s = st.current;
      await copyText(buildReviewText(s.name, st.cohort.code, fbOf(s.id)));
      toast(`${s.name}님 자료를 복사했어요`);
    });
  }
})();
