(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const LS_KEY = 'ev_student_v1';

  const state = {
    student: null,      // { id, name }
    cohort: null,       // { code, title, dates }
    dayIdx: 0,
    cat: 'espresso',
    selected: new Set(),
    feedback: [],
    attendance: [],
    photos: {},         // kind -> { path, url }
    survey: null,
    filter: 'all',
  };

  init();

  // ---------- 시작 ----------
  async function init() {
    bindStatic();
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    const { data: { session } } = await sb.auth.getSession();
    if (saved && session) {
      const { data } = await sb
        .from('ev_students')
        .select('id, name, ev_cohorts(code, title, dates)')
        .eq('id', saved.id)
        .maybeSingle();
      if (data) {
        setStudent({ id: data.id, name: data.name }, data.ev_cohorts);
        return enterApp();
      }
    }
    showLogin(saved);
  }

  function showLogin(saved) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    if (saved) {
      $('#codeInput').value = saved.code || '';
      $('#nameInput').value = saved.name || '';
    }
  }

  function setStudent(student, cohort) {
    state.student = student;
    state.cohort = cohort;
    localStorage.setItem(LS_KEY, JSON.stringify({ id: student.id, name: student.name, code: cohort.code }));
  }

  async function onLogin(e) {
    e.preventDefault();
    const code = $('#codeInput').value.trim();
    const name = $('#nameInput').value.trim();
    const errEl = $('#loginError');
    errEl.hidden = true;
    if (!code || !name) {
      errEl.textContent = '기수 코드와 이름을 모두 입력해 주세요.';
      errEl.hidden = false;
      return;
    }
    const btn = $('#loginBtn');
    btn.disabled = true;
    btn.textContent = '입장하는 중';
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) {
        const { error } = await sb.auth.signInAnonymously();
        if (error) throw error;
      }
      const { data, error } = await sb.rpc('ev_join_cohort', { p_code: code, p_name: name });
      if (error) throw error;
      setStudent({ id: data.student_id, name: data.name }, { code: data.code, title: data.title, dates: data.dates });
      enterApp();
    } catch (err) {
      errEl.textContent = friendlyError(err);
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = '입장하기';
    }
  }

  async function onLogout() {
    if (!confirm('나가기를 하면 이 기기에서 입장이 해제돼요. 기록은 남아 있고, 같은 기수 코드와 이름으로 다시 들어오면 이어서 볼 수 있어요.')) return;
    localStorage.removeItem(LS_KEY);
    await sb.auth.signOut();
    location.reload();
  }

  async function enterApp() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    state.dayIdx = dayIndexOf(state.cohort.dates);
    renderHero();
    renderCatTabs();
    renderChips();
    await loadAll();
  }

  async function loadAll() {
    const id = state.student.id;
    const [att, fb, ph, sv] = await Promise.all([
      sb.from('ev_attendance').select('*').eq('student_id', id),
      sb.from('ev_feedback').select('*').eq('student_id', id).order('created_at', { ascending: false }),
      sb.from('ev_photos').select('*').eq('student_id', id),
      sb.from('ev_surveys').select('*').eq('student_id', id).maybeSingle(),
    ]);
    const firstErr = [att, fb, ph, sv].find(r => r.error);
    if (firstErr) toast(friendlyError(firstErr.error));
    state.attendance = att.data || [];
    state.feedback = fb.data || [];
    state.survey = sv.data || null;
    state.photos = {};
    for (const p of ph.data || []) {
      const { data } = await sb.storage.from(BUCKET).createSignedUrl(p.path, 3600);
      state.photos[p.kind] = { path: p.path, url: data?.signedUrl };
    }
    renderAttendance();
    renderRecent();
    renderReview();
    renderFinish();
  }

  // ---------- 상단 ----------
  function renderHero() {
    $('#studentName').textContent = state.student.name;
    const dates = state.cohort.dates || [];
    const today = todayKST();
    let title;
    if (state.dayIdx) title = `${state.dayIdx}일차`;
    else if (dates.length && today < dates[0]) title = '교육 전';
    else title = '교육 종료';
    $('#dayTitle').textContent = title;
    const passed = dates.filter(d => d <= today).length;
    $$('#dayTrack span').forEach((el, i) => el.classList.toggle('on', i < passed));
    $('#dayLabels').innerHTML = dates.map((d, i) => `<span>${i + 1}일차 ${shortDate(d)}</span>`).join('');
  }

  // ---------- 근태 ----------
  function renderAttendance() {
    const box = $('#attendanceBox');
    if (!state.dayIdx) { box.innerHTML = ''; return; }
    const rec = state.attendance.find(a => a.day === state.dayIdx);
    if (rec) {
      box.innerHTML = `<div class="attendance done">
        <p><b>${state.dayIdx}일차 ${esc(rec.status)}</b></p>
        <p class="muted small">${timeKST(rec.checked_at)} 체크</p>
      </div>`;
      return;
    }
    box.innerHTML = `<div class="attendance">
      <p class="muted small">오늘 출석을 체크해 주세요</p>
      <p class="now">지금 ${nowKST()}</p>
      <p class="muted small">수업은 9시에 시작해요. 9시가 지나서 도착했다면 지각을 눌러 주세요.</p>
      <div class="row">
        <button class="btn btn-primary" type="button" data-att="출석">출석</button>
        <button class="btn" type="button" data-att="지각">지각</button>
      </div>
    </div>`;
    box.querySelectorAll('[data-att]').forEach(b => b.addEventListener('click', () => checkIn(b.dataset.att)));
  }

  async function checkIn(status) {
    if (!confirm(`${state.dayIdx}일차를 ${status}(으)로 체크할까요? 체크한 뒤에는 바꿀 수 없어요.`)) return;
    const { data, error } = await sb
      .from('ev_attendance')
      .insert({ student_id: state.student.id, day: state.dayIdx, status })
      .select()
      .single();
    if (error) return toast(friendlyError(error));
    state.attendance.push(data);
    renderAttendance();
    toast(`${status}(으)로 체크했어요`);
  }

  // ---------- 기록 ----------
  function renderCatTabs() {
    $('#catTabs').innerHTML = CATEGORIES.map(c =>
      `<button type="button" role="tab" data-cat="${c.key}" aria-selected="${c.key === state.cat}">${c.label}</button>`
    ).join('');
    $$('#catTabs button').forEach(b => b.addEventListener('click', () => {
      state.cat = b.dataset.cat;
      state.selected.clear();
      renderCatTabs();
      renderChips();
      renderRecent();
    }));
  }

  function renderChips() {
    const cat = CATEGORIES.find(c => c.key === state.cat);
    $('#chipArea').innerHTML = cat.groups.map(g => `
      <div class="chip-group">
        ${g.group ? `<span class="chip-group-label">${g.group}</span>` : ''}
        <div class="chips">
          ${g.items.map(i => {
            const v = itemValue(g.group, i);
            return `<button type="button" class="chip" data-v="${esc(v)}" aria-pressed="${state.selected.has(v)}">${esc(i)}</button>`;
          }).join('')}
        </div>
      </div>`).join('');
    $$('#chipArea .chip').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.v;
      if (state.selected.has(v)) state.selected.delete(v); else state.selected.add(v);
      b.setAttribute('aria-pressed', state.selected.has(v));
    }));
  }

  async function saveFeedback(e) {
    e.preventDefault();
    const memo = $('#memoInput').value.trim();
    if (!memo) {
      $('#memoInput').focus();
      return toast('피드백 내용을 적어 주세요');
    }
    const btn = $('#fbSave');
    btn.disabled = true;
    const { data, error } = await sb.from('ev_feedback').insert({
      student_id: state.student.id,
      category: state.cat,
      items: [...state.selected],
      memo,
      day: state.dayIdx || null,
    }).select().single();
    btn.disabled = false;
    if (error) return toast(friendlyError(error));
    state.feedback.unshift(data);
    state.selected.clear();
    $('#memoInput').value = '';
    renderChips();
    renderRecent();
    renderReview();
    renderFinish();
    toast('기록했어요');
  }

  function fbItemHTML(f, showCat = false) {
    const tags = [
      f.day ? `<span class="tag tag-day">${f.day}일차</span>` : '',
      showCat ? `<span class="tag">${CAT_LABEL[f.category]}</span>` : '',
      ...(f.items || []).map(i => `<span class="tag">${esc(i)}</span>`),
    ].join('');
    return `<li class="fb ${f.resolved ? 'resolved' : ''}" data-id="${f.id}">
      <div class="fb-meta">${tags}</div>
      <p class="fb-memo">${esc(f.memo)}</p>
      <div class="fb-actions">
        <button type="button" class="toggle" data-act="resolve" aria-pressed="${f.resolved}"><span class="box"></span>교정됨</button>
        <button type="button" class="link-btn" data-act="delete">삭제</button>
      </div>
    </li>`;
  }

  function bindFbActions(root) {
    root.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
      const id = b.closest('.fb').dataset.id;
      const f = state.feedback.find(x => x.id === id);
      if (!f) return;
      if (b.dataset.act === 'resolve') {
        const resolved = !f.resolved;
        const { error } = await sb.from('ev_feedback')
          .update({ resolved, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (error) return toast(friendlyError(error));
        f.resolved = resolved;
        toast(resolved ? '교정됨으로 표시했어요' : '다시 연습 중으로 돌렸어요');
      } else {
        if (!confirm('이 기록을 삭제할까요?')) return;
        const { error } = await sb.from('ev_feedback').delete().eq('id', id);
        if (error) return toast(friendlyError(error));
        state.feedback = state.feedback.filter(x => x.id !== id);
      }
      renderRecent();
      renderReview();
      renderFinish();
    }));
  }

  function renderRecent() {
    const list = state.feedback.filter(f => f.category === state.cat);
    $('#recentTitle').textContent = `${CAT_LABEL[state.cat]} 기록 ${list.length}개`;
    const ul = $('#recentList');
    ul.innerHTML = list.length
      ? list.slice(0, 5).map(f => fbItemHTML(f)).join('')
      : `<li class="empty">아직 기록이 없어요. 피드백을 받으면 바로 남겨 두세요.</li>`;
    bindFbActions(ul);
  }

  // ---------- 모아보기 ----------
  function renderReview() {
    const body = $('#reviewBody');
    const pass = f => state.filter === 'all' || (state.filter === 'open' ? !f.resolved : f.resolved);
    body.innerHTML = CATEGORIES.map(c => {
      const all = state.feedback.filter(f => f.category === c.key);
      const shown = all.filter(pass);
      const open = all.filter(f => !f.resolved).length;
      const counts = {};
      all.forEach(f => (f.items || []).forEach(i => { counts[i] = (counts[i] || 0) + 1; }));
      const top = Object.entries(counts).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4);
      return `<section class="cat-block">
        <div class="section-head">
          <h2 class="section-title">${c.label}</h2>
          <span class="muted small">연습 중 ${open} / 전체 ${all.length}</span>
        </div>
        ${top.length ? `<div class="freq"><span class="muted">자주 받은 피드백</span>${top.map(([k, n]) => `<span>${esc(k)} ${n}회</span>`).join('')}</div>` : ''}
        <ul class="fb-list">${shown.length ? shown.map(f => fbItemHTML(f)).join('') : '<li class="empty">해당하는 기록이 없어요.</li>'}</ul>
      </section>`;
    }).join('');
    bindFbActions(body);
  }

  // ---------- 마무리 ----------
  function renderFinish() {
    const total = state.feedback.length;
    const done = state.feedback.filter(f => f.resolved).length;
    $('#finishSummary').textContent = total
      ? `3일 동안 피드백 ${total}개를 기록했고, 그중 ${done}개를 교정했어요. 남은 ${total - done}개는 매장에서 연습할 과제예요.`
      : '아직 기록한 피드백이 없어요.';
    renderPhotos();
    renderSurvey();
  }

  function renderPhotos() {
    const area = $('#photoArea');
    area.innerHTML = PHOTO_KINDS.map(k => {
      const p = state.photos[k.key];
      return `<div class="photo-block">
        <h3>${k.label}</h3>
        <div class="photo-grid">
          <figure>
            <div class="photo-frame"><img src="${k.sample}" alt="${k.label} 예시 사진"></div>
            <figcaption>예시</figcaption>
          </figure>
          <figure class="upload ${p ? 'has-photo' : ''}" data-kind="${k.key}">
            <label class="photo-frame">
              <input type="file" accept="image/*" hidden>
              ${p && p.url ? `<img src="${p.url}" alt="내 ${k.label} 사진">` : `<span class="upload-empty">사진 올리기</span>`}
            </label>
            <figcaption>${p ? '내 사진 (눌러서 바꾸기)' : '내 사진'}</figcaption>
          </figure>
        </div>
      </div>`;
    }).join('');
    area.querySelectorAll('.upload input').forEach(inp => inp.addEventListener('change', () => {
      const file = inp.files && inp.files[0];
      if (file) uploadPhoto(inp.closest('.upload').dataset.kind, file);
    }));
  }

  async function compressImage(file, max = 1600, quality = 0.85) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('이 사진 형식은 열 수 없어요. 카메라 설정에서 JPG로 찍거나 스크린샷으로 올려 주세요.'));
        i.src = url;
      });
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function uploadPhoto(kind, file) {
    const fig = document.querySelector(`.upload[data-kind="${kind}"] .photo-frame`);
    const busy = document.createElement('div');
    busy.className = 'busy';
    busy.textContent = '올리는 중';
    fig.appendChild(busy);
    try {
      const blob = await compressImage(file);
      const path = `${state.student.id}/${kind}-${Date.now()}.jpg`;
      const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const old = state.photos[kind]?.path;
      const { error } = await sb.from('ev_photos')
        .upsert({ student_id: state.student.id, kind, path, created_at: new Date().toISOString() }, { onConflict: 'student_id,kind' });
      if (error) throw error;
      if (old && old !== path) await sb.storage.from(BUCKET).remove([old]);
      const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
      state.photos[kind] = { path, url: data?.signedUrl };
      toast('사진을 올렸어요');
    } catch (err) {
      toast(err.message?.includes('형식') ? err.message : friendlyError(err));
    }
    renderPhotos();
  }

  function renderSurvey() {
    const area = $('#surveyArea');
    if (state.survey) {
      area.innerHTML = `<div class="notice"><p><b>제출했어요.</b> 3일 동안 수고 많으셨어요.</p>
        <p class="muted small">${dateKST(state.survey.submitted_at)} ${timeKST(state.survey.submitted_at)} 제출</p></div>`;
      return;
    }
    const dates = state.cohort.dates || [];
    const open = state.dayIdx === 3 || (dates.length && todayKST() > dates[dates.length - 1]);
    if (!open) {
      area.innerHTML = `<div class="notice"><p>만족도 조사는 3일차에 열려요.</p></div>`;
      return;
    }
    area.innerHTML = `<form id="surveyForm" novalidate>
      ${SURVEY.map(q => `<fieldset class="q" style="border:0;margin:0;padding-left:0;padding-right:0">
        <span class="q-section">${q.section}</span>
        <legend class="q-text" style="padding:0">${esc(q.text)}</legend>
        <div class="scale">
          ${[1, 2, 3, 4, 5].map(v => `<label><input type="radio" name="${q.key}" value="${v}"><span>${v}</span></label>`).join('')}
        </div>
        <div class="scale-ends"><span>${SCALE_LOW}</span><span>${SCALE_HIGH}</span></div>
      </fieldset>`).join('')}
      <div class="q">
        <label class="field"><span>${esc(SURVEY_COMMENT)}</span>
          <textarea id="surveyComment" rows="5"></textarea>
        </label>
      </div>
      <button id="surveySubmit" class="btn btn-primary btn-block" type="submit">만족도 조사 제출</button>
    </form>`;
    $('#surveyForm').addEventListener('submit', submitSurvey);
  }

  async function submitSurvey(e) {
    e.preventDefault();
    const form = e.target;
    const row = { student_id: state.student.id };
    for (const q of SURVEY) {
      const v = form.querySelector(`input[name="${q.key}"]:checked`);
      if (!v) return toast('모든 문항에 답해 주세요');
      row[q.key] = Number(v.value);
    }
    row.comment = $('#surveyComment').value.trim();
    if (!row.comment) {
      $('#surveyComment').focus();
      return toast('교육 총평을 남겨 주세요');
    }
    if (!confirm('제출한 뒤에는 수정할 수 없어요. 제출할까요?')) return;
    $('#surveySubmit').disabled = true;
    const { data, error } = await sb.from('ev_surveys').insert(row).select().single();
    if (error) {
      $('#surveySubmit').disabled = false;
      return toast(friendlyError(error));
    }
    state.survey = data;
    renderSurvey();
    toast('만족도 조사를 제출했어요');
  }

  // ---------- 화면 전환 ----------
  function go(view) {
    $$('.view').forEach(v => { v.hidden = v.id !== `view-${view}`; });
    $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    window.scrollTo({ top: 0 });
  }

  function bindStatic() {
    $('#loginForm').addEventListener('submit', onLogin);
    $('#logoutBtn').addEventListener('click', onLogout);
    $('#fbForm').addEventListener('submit', saveFeedback);
    $$('.tabbar button').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-goto]');
      if (t) go(t.dataset.goto);
    });
    $$('#reviewFilter .chip').forEach(b => b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      $$('#reviewFilter .chip').forEach(x => x.setAttribute('aria-pressed', x === b));
      renderReview();
    }));
    // 다음 날 앱을 다시 열었을 때 일차 갱신
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.cohort) {
        const d = dayIndexOf(state.cohort.dates);
        if (d !== state.dayIdx) {
          state.dayIdx = d;
          renderHero();
          renderAttendance();
          renderSurvey();
        }
      }
    });
  }
})();
