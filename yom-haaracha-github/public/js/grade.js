/* =========================================================================
   מסך בדיקה — מערכת בדיקה, ציונים ודירוג (נפרד מהניהול החי).
   נכנסים מ-/grade. חושף window.GradeApp = { enter, leave }.
   זרימה: כניסה → רשימת מחזורים → סקירת מחזור → עמוד ביקורת לנבחן.
   ========================================================================= */
window.GradeApp = (function () {
  'use strict';

  var token = localStorage.getItem('yh_examiner_token') || null;
  var root = document.getElementById('root');
  var COHORT = null;   // נתוני המחזור הנוכחי (סקירה)
  var REV = null;      // נתוני הביקורת של הנבחן הנוכחי
  var progressTimer = null;

  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rmath(s) { return (typeof window.renderMathText === 'function') ? window.renderMathText(String(s == null ? '' : s)) : esc(s); }
  function num(x) { return (x == null || isNaN(x)) ? '—' : Number(x).toFixed(1); }

  async function call(path, method, body, raw) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['x-token'] = token;
    var res = await fetch('/api' + path, { method: method || 'GET', headers: headers, body: body ? JSON.stringify(body) : undefined });
    if (raw) return res;
    var data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw Object.assign(new Error((data && data.error) || 'שגיאה'), { status: res.status });
    return data;
  }
  async function downloadBlob(path, filename) {
    var res = await call(path, 'GET', null, true); if (!res.ok) throw new Error('הורדה נכשלה');
    var blob = await res.blob(), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // ------------------------------------------------- כניסה
  function renderLogin(errMsg) {
    stopProgress();
    root.className = 'center-screen';
    root.innerHTML = '';
    root.appendChild(el(
      '<div class="card" style="max-width:400px;width:100%">' +
      '<div class="brand"><img class="logo" src="/img/logo.svg" alt="עתיד פלוס"><span class="wordmark">עתיד פלוס</span><span class="sub">מסך בדיקה</span></div>' +
      '<h2>כניסת בודק</h2><p class="lead">הזינו את סיסמת הבוחן (אותה סיסמה של מסך המנהל).</p>' +
      (errMsg ? '<div class="msg error">' + esc(errMsg) + '</div>' : '') +
      '<label class="field"><span>סיסמה</span><input id="pw" type="password" autocomplete="off"></label>' +
      '<div class="btn-row"><button class="btn" id="go">כניסה</button>' +
      '<button class="btn ghost" id="back-exam">חזרה למסך הנבחן</button></div></div>'
    ));
    document.getElementById('go').onclick = doLogin;
    document.getElementById('back-exam').onclick = function () { location.href = '/'; };
    document.getElementById('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  }
  async function doLogin() {
    try {
      var r = await call('/examiner/login', 'POST', { password: document.getElementById('pw').value });
      token = r.token; localStorage.setItem('yh_examiner_token', token);
      loadHome();
    } catch (e) { renderLogin('סיסמה שגויה.'); }
  }

  // ------------------------------------------------- כותרת עליונה
  function topbar(subtitle) {
    return '<div class="exm-header">' +
      '<img class="logo" src="/img/logo.svg" alt="עתיד פלוס" style="height:42px">' +
      '<span class="wordmark" style="font-size:20px;font-weight:800">עתיד פלוס</span>' +
      '<span style="color:var(--muted);font-size:14px">· מסך בדיקה' + (subtitle ? ' — ' + esc(subtitle) : '') + '</span>' +
      '<div class="spacer"></div>' +
      '<button class="btn ghost small" id="btn-admin">מסך מנהל</button>' +
      '<button class="btn ghost small" id="btn-exam">מסך נבחן</button>' +
      '<button class="btn ghost small" id="btn-logout">יציאה</button></div>';
  }
  function wireTopbar() {
    var a = document.getElementById('btn-admin'); if (a) a.onclick = function () { location.href = '/examiner'; };
    var e = document.getElementById('btn-exam'); if (e) e.onclick = function () { location.href = '/'; };
    var l = document.getElementById('btn-logout'); if (l) l.onclick = function () { localStorage.removeItem('yh_examiner_token'); token = null; renderLogin(); };
  }
  function demoBanner(demo) {
    if (!demo) return '';
    return '<div class="msg warn">מצב הדגמה — לא הוגדר מפתח Claude API. ציוני ה«למד» הם הדגמה מבנית בלבד. אפשר להתנסות בכל המסך; לבדיקה אמיתית יש להגדיר מפתח (ראו מדריך ההפעלה).</div>';
  }

  // ------------------------------------------------- בית: רשימת מחזורים
  async function loadHome() {
    stopProgress();
    var data;
    try { data = await call('/examiner/grading/cohorts'); }
    catch (e) { if (e.status === 401) return renderLogin('פג תוקף. התחבר/י מחדש.'); root.innerHTML = '<div class="msg error">' + esc(e.message) + '</div>'; return; }
    renderHome(data);
  }
  function renderHome(data) {
    root.className = 'wrap';
    var cohorts = data.cohorts || [];
    var list = cohorts.length ? cohorts.map(function (c) {
      var when = '';
      try { when = new Date(c.created_at).toLocaleString('he-IL'); } catch (e) {}
      var prog = c.teachItems ? Math.round((c.aiDone / c.teachItems) * 100) : 0;
      return '<div class="gr-cohort" data-id="' + c.id + '">' +
        '<div class="gr-cohort-main">' +
        '<div class="gr-cohort-name">' + esc(c.name) + (c.status === 'finalized' ? ' <span class="pill done">הושלם</span>' : '') + '</div>' +
        '<div class="gr-cohort-meta">' + when + ' · ' + c.examinees + ' נבחנים · בדיקת AI ' + prog + '% · ננעלו ' + c.locked + (c.running ? ' · <span style="color:var(--teal)">רץ עכשיו…</span>' : '') + '</div>' +
        '</div>' +
        '<div class="gr-cohort-act"><button class="btn small open-cohort" data-id="' + c.id + '">פתח</button>' +
        '<button class="btn ghost small del-cohort" data-id="' + c.id + '" title="מחק מחזור">מחק</button></div>' +
        '</div>';
    }).join('') : '<p class="hint-text">עדיין אין מחזורי בדיקה. לחצו «צלם מצב לבדיקה» כדי להתחיל — יילקח עותק של התשובות שבמערכת כרגע.</p>';

    root.innerHTML = topbar('') +
      demoBanner(data.demo) +
      '<div class="card">' +
      '<h2 class="section-title">התחלת בדיקה</h2>' +
      '<p class="hint-text">«צלם מצב לבדיקה» לוקח עותק קפוא של כל התשובות שבמערכת כרגע, ומעביר אותו למערכת הבדיקה. פעולה זו לא נוגעת בנתוני יום המבחן ובגיבויים. מומלץ לצלם אחרי סיום היום.</p>' +
      '<div class="btn-row" style="margin-top:12px;align-items:center">' +
      '<input id="snap-name" type="text" placeholder="שם המחזור (למשל: יום הערכה 3.8)" style="max-width:280px">' +
      '<button class="btn" id="btn-snap">צלם מצב לבדיקה</button></div>' +
      '<div id="snap-msg"></div></div>' +
      '<div class="card"><h2 class="section-title">מחזורי בדיקה</h2><div class="gr-cohort-list">' + list + '</div></div>';

    wireTopbar();
    document.getElementById('btn-snap').onclick = doSnapshot;
    root.querySelectorAll('.open-cohort').forEach(function (b) { b.onclick = function () { openCohort(Number(b.getAttribute('data-id'))); }; });
    root.querySelectorAll('.del-cohort').forEach(function (b) { b.onclick = function () { deleteCohort(Number(b.getAttribute('data-id'))); }; });
  }
  async function doSnapshot() {
    var box = document.getElementById('snap-msg');
    var name = document.getElementById('snap-name').value.trim();
    box.innerHTML = '<div class="msg info">מצלם…</div>';
    try {
      var r = await call('/examiner/grading/snapshot', 'POST', { name: name });
      if (r.reused) box.innerHTML = '<div class="msg info">מחזור עם אותם נתונים כבר קיים — נפתח.</div>';
      openCohort(r.cohort_id);
    } catch (e) { box.innerHTML = '<div class="msg error">' + esc(e.message) + '</div>'; }
  }
  async function deleteCohort(id) {
    if (!confirm('למחוק את מחזור הבדיקה הזה? כל הציונים וההערות שלו יימחקו. (התשובות המקוריות ביום המבחן לא מושפעות.)')) return;
    try { await call('/examiner/grading/delete-cohort', 'POST', { cohort_id: id }); loadHome(); }
    catch (e) { alert(e.message); }
  }

  // ------------------------------------------------- סקירת מחזור
  async function openCohort(id) {
    stopProgress();
    try { COHORT = await call('/examiner/grading/cohort/' + id); }
    catch (e) { if (e.status === 401) return renderLogin('פג תוקף.'); alert(e.message); return; }
    renderCohort();
    if (COHORT.job && COHORT.job.running) startProgress(id);
  }
  function renderCohort() {
    root.className = 'wrap';
    var c = COHORT.cohort;
    var rows = COHORT.examinees.map(function (e) {
      var review = e.teachTotal ? (e.reviewed + '/' + e.teachTotal) : '—';
      var aiTxt = e.teachTotal ? (e.aiDone >= e.teachTotal ? '<span style="color:var(--ok)">נבדק</span>' : (e.aiDone + '/' + e.teachTotal)) : '<span style="color:var(--faint)">אין «למד»</span>';
      var lockTxt = e.locked ? '<span class="pill done">ננעל ✓</span>' : (e.reviewed >= e.teachTotal && e.teachTotal ? '<span class="pill chapter">מוכן לנעילה</span>' : '<span style="color:var(--faint)">בבדיקה</span>');
      return '<tr' + (e.locked ? ' class="gr-locked"' : '') + '>' +
        '<td><b>' + esc(e.name) + '</b>' + (e.partial ? ' <span style="color:var(--warn);font-size:11px" title="מבחן חלקי">⚑ חלקי</span>' : '') + '</td>' +
        '<td style="font-size:12px;color:var(--muted)">' + esc((e.subjects || []).join(', ')) + '</td>' +
        '<td>' + aiTxt + '</td>' +
        '<td>' + review + '</td>' +
        '<td class="gr-final">' + num(e.final) + '</td>' +
        '<td style="font-size:12px">' + esc(e.topDomain || '—') + '</td>' +
        '<td>' + lockTxt + '</td>' +
        '<td><button class="btn ghost small open-rev" data-c="' + esc(e.code) + '">פתח לבדיקה</button></td></tr>';
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--faint);padding:24px">אין נבחנים במחזור.</td></tr>';

    root.innerHTML = topbar(c.name) +
      demoBanner(COHORT.demo) +
      '<div class="card">' +
      '<div class="toolbar"><button class="btn ghost small" id="btn-back">◀ כל המחזורים</button>' +
      '<h2 class="section-title" style="margin:0">' + esc(c.name) + '</h2><span class="spacer"></span>' +
      '<button class="btn small" id="btn-runai">הרץ בדיקת AI</button>' +
      '<button class="btn small" id="btn-sheet">בנה גיליון ציונים</button>' +
      '<button class="btn ghost small" id="btn-refresh">רענן</button></div>' +
      '<div id="ai-progress"></div>' +
      '<p class="hint-text">«הרץ בדיקת AI» בודק את כל תשובות ה«למד» שטרם נבדקו (אפשר לעצור ולהמשיך). אחר כך פתחו כל נבחן לבדיקה — אשרו בוי או שנו במחוון. הרב-ברירה כבר מנוקדת אוטומטית.</p>' +
      '<div style="overflow-x:auto"><table class="grid"><thead><tr>' +
      '<th>שם</th><th>מקצועות</th><th>בדיקת AI</th><th>נבדקו</th><th>ציון סופי</th><th>תחום מוביל</th><th>סטטוס</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';

    wireTopbar();
    document.getElementById('btn-back').onclick = loadHome;
    document.getElementById('btn-refresh').onclick = function () { openCohort(c.id); };
    document.getElementById('btn-runai').onclick = runAi;
    document.getElementById('btn-sheet').onclick = function () { openSheet(c.id); };
    root.querySelectorAll('.open-rev').forEach(function (b) { b.onclick = function () { openReview(b.getAttribute('data-c')); }; });
    if (COHORT.job && COHORT.job.running) renderProgress(COHORT.job.done + COHORT.job.failed, COHORT.job.total);
  }
  async function runAi() {
    try {
      var r = await call('/examiner/grading/run-ai', 'POST', { cohort_id: COHORT.cohort.id });
      if (r.nothing) { alert('הכול כבר נבדק.'); return; }
      startProgress(COHORT.cohort.id);
    } catch (e) { alert(e.message); }
  }
  function renderProgress(done, total) {
    var box = document.getElementById('ai-progress'); if (!box) return;
    var pct = total ? Math.round((done / total) * 100) : 0;
    box.innerHTML = '<div class="gr-progress"><div class="gr-progress-bar" style="width:' + pct + '%"></div>' +
      '<span class="gr-progress-txt">בודק… ' + done + '/' + total + ' (' + pct + '%)</span></div>';
  }
  function startProgress(id) {
    stopProgress();
    progressTimer = setInterval(async function () {
      try {
        var p = await call('/examiner/grading/progress/' + id);
        renderProgress(p.done + p.failed, p.total);
        if (!p.running) { stopProgress(); openCohort(id); }
      } catch (e) { stopProgress(); }
    }, 900);
  }
  function stopProgress() { if (progressTimer) { clearInterval(progressTimer); progressTimer = null; } }

  // ------------------------------------------------- עמוד ביקורת לנבחן
  async function openReview(code) {
    stopProgress();
    try { REV = await call('/examiner/grading/examinee/' + COHORT.cohort.id + '/' + encodeURIComponent(code)); }
    catch (e) { if (e.status === 401) return renderLogin('פג תוקף.'); alert(e.message); return; }
    renderReview();
    window.scrollTo(0, 0);
  }
  function scoreBar() {
    var r = REV.rollup || {};
    return '<span class="gr-scores">' +
      '<span class="gr-s"><small>הוראה</small><b>' + num(r.teaching) + '</b></span>' +
      '<span class="gr-s"><small>תוכן</small><b>' + num(r.content) + '</b></span>' +
      '<span class="gr-s final"><small>סופי</small><b>' + num(r.final) + '</b></span></span>';
  }
  function renderReview() {
    root.className = 'wrap';
    var ex = REV.examinee, nav = REV.nav;
    var locked = ex.locked;
    root.innerHTML =
      '<div class="exam-bar">' +
      '<button class="btn ghost small" id="rv-back">◀ למחזור</button>' +
      '<button class="btn ghost small" id="rv-prev"' + (nav.prev ? '' : ' disabled') + '>הקודם ▶</button>' +
      '<div class="who" style="margin-inline-start:0"><span class="title">' + esc(ex.name) + '</span>' +
      '<span class="round-tag">' + nav.index + '/' + nav.count + '</span></div>' +
      '<span class="spacer"></span>' +
      scoreBar() +
      '<button class="btn ghost small" id="rv-next"' + (nav.next ? '' : ' disabled') + '>◀ הבא</button>' +
      '<button class="btn small" id="rv-lock">' + (locked ? 'פתח לעריכה' : 'אשר ונעל ✓') + '</button>' +
      '</div>' +
      (ex.partial ? '<div class="msg warn">מבחן חלקי — הנבחן לא השלים את כל הפרקים / עזב. הציון מחושב על מה שקיים.</div>' : '') +
      (locked ? '<div class="msg info">הנבחן נעול. הציונים אושרו. «פתח לעריכה» כדי לשנות.</div>' : '') +
      '<div id="rv-body"></div>' +
      '<div class="card"><label class="field" style="margin:0"><span>הערה כללית לנבחן (נכנסת לגיליון הציונים)</span>' +
      '<textarea id="rv-note" style="min-height:70px"' + (locked ? ' disabled' : '') + '>' + esc(ex.note || '') + '</textarea></label></div>';

    document.getElementById('rv-back').onclick = function () { openCohort(COHORT.cohort.id); };
    document.getElementById('rv-prev').onclick = function () { if (nav.prev) openReview(nav.prev); };
    document.getElementById('rv-next').onclick = function () { if (nav.next) openReview(nav.next); };
    document.getElementById('rv-lock').onclick = function () { lockExaminee(!locked); };
    var noteEl = document.getElementById('rv-note');
    if (noteEl) noteEl.addEventListener('blur', function () { saveCandNote(noteEl.value); });
    renderReviewBody();
  }
  function effScore(t, k) { if (t.human && t.human[k] != null) return t.human[k]; return (t.ai && t.ai[k] != null) ? t.ai[k] : null; }
  function confPill(conf) {
    var m = { high: ['ביטחון גבוה', 'chapter'], medium: ['ביטחון בינוני', 'chapter'], low: ['ביטחון נמוך', 'warn'] };
    var v = m[conf] || ['', 'done'];
    if (!conf) return '';
    return '<span class="pill ' + (conf === 'low' ? '' : 'chapter') + '" style="' + (conf === 'low' ? 'background:rgba(247,183,49,0.14);color:var(--warn)' : '') + '">' + v[0] + '</span>';
  }
  function renderReviewBody() {
    var box = document.getElementById('rv-body'); if (!box) return;
    var locked = REV.examinee.locked;
    var order = REV.criteriaOrder || ['accuracy', 'depth', 'diagnosis_fit', 'clarity'];
    var labels = REV.criteria || {};
    var axis = REV.axis || {};
    var html = REV.chapters.map(function (ch) {
      var head = '<div class="gr-ch-head"><b>' + esc(ch.subject || ch.chapter_id) + '</b>' + (ch.level ? ' <span style="color:var(--faint)">· רמה ' + esc(ch.level) + '</span>' : '') +
        (ch.source ? ' <button class="btn ghost small gr-src-btn" data-ch="' + esc(ch.chapter_id) + '" style="padding:3px 10px">הצג קטע</button>' : '') + '</div>' +
        (ch.source ? '<div class="source-box gr-src" id="src-' + esc(ch.chapter_id) + '" style="display:none"><div class="src-label">הקטע שהוצג</div><div class="src-body">' + rmath(ch.source) + '</div></div>' : '');
      var items = ch.items.map(function (it) {
        if (it.mc) {
          var ok = it.mc.correct;
          var badge = it.dont_know ? '<span class="dk-badge">לא יודע/ת ⚑</span>' : (ok ? '<span class="gr-ok">נכון ✓</span>' : '<span class="gr-bad">לא נכון ✗</span>');
          return '<div class="gr-mc">' +
            '<div class="gr-mc-q">' + rmath(it.question) + '</div>' +
            '<div class="gr-mc-a">בחר/ה: <span class="' + (ok ? 'gr-ok' : 'gr-bad') + '">' + rmath(it.mc.chosen) + '</span> ' + badge +
            (!ok && it.mc.correctText ? ' <span style="color:var(--faint)">· הנכונה: ' + rmath(it.mc.correctText) + '</span>' : '') + '</div></div>';
        }
        if (it.teach) {
          var t = it.teach;
          var itemApproved = t.status === 'approved';
          var pipsLocked = locked || itemApproved;
          var critHtml = order.map(function (k) {
            var ax = axis[k] === 'content' ? 'content' : 'teach';
            var eff = effScore(t, k);
            var aiV = t.ai && t.ai[k] != null ? t.ai[k] : null;
            var edited = (t.human && t.human[k] != null && aiV != null && t.human[k] !== aiV);
            var pips = '';
            for (var v = 1; v <= 5; v++) {
              pips += '<span class="pip' + (v === eff ? ' on ' + ax : '') + (pipsLocked ? ' pip-locked' : '') + '"' + (pipsLocked ? '' : ' data-k="' + k + '" data-v="' + v + '" data-ch="' + esc(ch.chapter_id) + '" data-it="' + esc(it.item_id) + '"') + '>' + v + '</span>';
            }
            return '<div class="crit-row">' +
              '<span class="crit-chip ' + ax + '">' + (ax === 'content' ? 'תוכן' : 'הוראה') + '</span>' +
              '<span class="crit-label">' + esc(labels[k] || k) + (edited ? ' <span class="crit-ai">(AI: ' + aiV + ')</span>' : '') + '</span>' +
              '<span class="pips">' + pips + '</span></div>';
          }).join('');
          var statusChip = itemApproved ? '<span class="pill done">ננעל ✓</span>' : (t.status === 'edited' ? '<span class="pill chapter">נערך</span>' : '');
          var aiFail = (t.aiStatus === 'failed') ? '<span class="pill" style="background:rgba(251,92,107,0.14);color:var(--danger)">בדיקה נכשלה — בדוק ידנית</span>' : '';
          return '<div class="qcard teach gr-teach' + (itemApproved ? ' gr-approved' : '') + '">' +
            '<span class="qtype teach">שאלת «למד»</span> ' + statusChip + ' ' + aiFail +
            '<div class="prompt">' + rmath(it.question) + '</div>' +
            '<div class="gr-answer"><div class="gr-answer-lbl">תשובת המועמד/ת</div><div class="gr-answer-body">' + (it.dont_know ? '<span class="dk-badge">— לא יודע/ת —</span>' : esc(t.answer) || '<span style="color:var(--faint)">— ריק —</span>') + '</div></div>' +
            (t.aiConclusion ? '<div class="gr-concl">מסקנת ה-AI: <b>' + esc(t.aiConclusion) + '</b> ' + confPill(t.aiConfidence) + '</div>' : '') +
            (t.aiAttention ? '<div class="attn-strip"><b>על מה לשים לב:</b> ' + esc(t.aiAttention) + '</div>' : '') +
            '<div class="crit-box">' + critHtml + '</div>' +
            '<div class="gr-item-foot">' +
            (locked ? ''
              : (itemApproved
                ? '<button class="btn ghost small gr-unapprove" data-ch="' + esc(ch.chapter_id) + '" data-it="' + esc(it.item_id) + '">פתח לעריכה</button>'
                : '<button class="btn small gr-approve" data-ch="' + esc(ch.chapter_id) + '" data-it="' + esc(it.item_id) + '">אשר שאלה ✓</button>')) +
            '<input class="gr-item-note" placeholder="הערה לשאלה (לא חובה)" data-ch="' + esc(ch.chapter_id) + '" data-it="' + esc(it.item_id) + '" value="' + esc(t.note || '') + '"' + (locked || itemApproved ? ' disabled' : '') + '></div>' +
            '</div>';
        }
        return '';
      }).join('');
      return '<div class="card gr-chapter">' + head + items + '</div>';
    }).join('');
    box.innerHTML = html;

    // חיווט
    box.querySelectorAll('.gr-src-btn').forEach(function (b) { b.onclick = function () { var s = document.getElementById('src-' + b.getAttribute('data-ch')); if (s) s.style.display = s.style.display === 'none' ? 'block' : 'none'; }; });
    if (!locked) {
      box.querySelectorAll('.pip[data-k]').forEach(function (p) {
        p.onclick = function () { setScore(p.getAttribute('data-ch'), p.getAttribute('data-it'), p.getAttribute('data-k'), Number(p.getAttribute('data-v'))); };
      });
      box.querySelectorAll('.gr-approve').forEach(function (b) { b.onclick = function () { approveItem(b.getAttribute('data-ch'), b.getAttribute('data-it'), true); }; });
      box.querySelectorAll('.gr-unapprove').forEach(function (b) { b.onclick = function () { approveItem(b.getAttribute('data-ch'), b.getAttribute('data-it'), false); }; });
      box.querySelectorAll('.gr-item-note').forEach(function (inp) { inp.addEventListener('blur', function () { saveItemNote(inp.getAttribute('data-ch'), inp.getAttribute('data-it'), inp.value); }); });
    }
  }
  function findItem(chId, itId) {
    var ch = REV.chapters.find(function (c) { return c.chapter_id === chId; });
    if (!ch) return null;
    return ch.items.find(function (i) { return i.item_id === itId && i.teach; });
  }
  async function setScore(chId, itId, k, v) {
    var it = findItem(chId, itId); if (!it) return;
    var base = (it.teach.human) ? it.teach.human : it.teach.ai;
    var merged = Object.assign({}, base); merged[k] = v;
    it.teach.human = merged; it.teach.status = 'edited';
    updateScoreBar(null); // חיווי מיידי (ייעודכן מהשרת)
    renderReviewBody();
    try {
      var r = await call('/examiner/grading/item', 'POST', { cohort_id: COHORT.cohort.id, code: REV.examinee.code, chapter_id: chId, item_id: itId, scores: (function () { var o = {}; o[k] = v; return o; })() });
      REV.rollup = r.rollup; it.teach.status = r.status; updateScoreBar(r.rollup);
    } catch (e) { alert(e.message); }
  }
  async function approveItem(chId, itId, approve) {
    var it = findItem(chId, itId); if (!it) return;
    try {
      var r = await call('/examiner/grading/item', 'POST', { cohort_id: COHORT.cohort.id, code: REV.examinee.code, chapter_id: chId, item_id: itId, approve: approve });
      it.teach.status = r.status; REV.rollup = r.rollup; renderReviewBody(); updateScoreBar(r.rollup);
      if (approve) toast('השאלה ננעלה ✓');
    } catch (e) { alert(e.message); }
  }
  async function saveItemNote(chId, itId, note) {
    var it = findItem(chId, itId); if (!it || it.teach.note === note) return;
    it.teach.note = note;
    try { await call('/examiner/grading/item', 'POST', { cohort_id: COHORT.cohort.id, code: REV.examinee.code, chapter_id: chId, item_id: itId, note: note }); }
    catch (e) { /* שקט */ }
  }
  async function saveCandNote(note) {
    if (REV.examinee.note === note) return;
    REV.examinee.note = note;
    try { await call('/examiner/grading/examinee-flags', 'POST', { cohort_id: COHORT.cohort.id, code: REV.examinee.code, note: note }); }
    catch (e) {}
  }
  function updateScoreBar(rollup) {
    if (rollup) REV.rollup = rollup;
    var bar = root.querySelector('.gr-scores');
    if (bar) bar.outerHTML = scoreBar();
  }
  function toast(msg) {
    var t = document.getElementById('gr-toast');
    if (t && t.parentNode) t.remove();
    t = document.createElement('div');
    t.id = 'gr-toast';
    t.textContent = msg;
    t.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:99999;background:#45b84e;color:#04220a;font-weight:700;padding:11px 22px;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.4);font-size:15px;transition:opacity .4s';
    document.body.appendChild(t);
    setTimeout(function () { if (t) t.style.opacity = '0'; }, 1700);
    setTimeout(function () { if (t && t.parentNode) t.remove(); }, 2200);
  }
  async function lockExaminee(locked) {
    var name = REV.examinee.name;
    try {
      var r = await call('/examiner/grading/lock', 'POST', { cohort_id: COHORT.cohort.id, code: REV.examinee.code, locked: locked });
      REV.examinee.locked = r.locked; REV.rollup = r.rollup;
      renderReview();
      toast(locked ? '«' + name + '» ננעל ✓' : 'נפתח לעריכה');
    } catch (e) { alert(e.message); }
  }

  // ------------------------------------------------- גיליון ציונים
  async function openSheet(id) {
    var data;
    try { data = await call('/examiner/grading/sheet/' + id); } catch (e) { alert(e.message); return; }
    renderSheet(data);
  }
  function renderSheet(data) {
    var m = document.getElementById('sheet-modal');
    if (!m) { m = el('<div class="modal-back" id="sheet-modal"></div>'); document.body.appendChild(m); m.onclick = function (ev) { if (ev.target === m) m.remove(); }; }
    var rows = data.rows.map(function (r, i) {
      return '<tr' + (r.include ? '' : ' style="opacity:.5"') + '>' +
        '<td><input type="checkbox" class="sh-inc" data-c="' + esc(r.code) + '"' + (r.include ? ' checked' : '') + '></td>' +
        '<td>' + (i + 1) + '</td>' +
        '<td><b>' + esc(r.name) + '</b>' + (r.partial ? ' <span style="color:var(--warn);font-size:11px">⚑</span>' : '') + '</td>' +
        '<td class="gr-final">' + num(r.final) + '</td>' +
        '<td>' + num(r.teaching) + '</td><td>' + num(r.content) + '</td>' +
        '<td style="font-size:12px">' + esc(r.topDomain || '—') + '</td>' +
        '<td style="font-size:12px;color:var(--muted);max-width:220px">' + esc(r.recommendation || '') + '</td></tr>';
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--faint);padding:20px">אין נתונים.</td></tr>';
    m.innerHTML = '<div class="modal-card" style="max-width:820px">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px"><h2 style="margin:0;font-size:20px">גיליון ציונים — ' + esc(data.cohort.name) + '</h2><span style="flex:1"></span><button class="btn ghost small" id="sh-close">סגור</button></div>' +
      '<p class="hint-text">סמנו מי נכלל בגיליון (מי שכבר קיבל ציון סופי במחזור קודם מסומן אוטומטית כלא-כלול). הייצוא ל-Excel מסודר לפי שם בעמודה הראשונה — מתאים להעלאה ל-monday.</p>' +
      '<div style="overflow-x:auto;max-height:52vh;margin-top:10px"><table class="grid"><thead><tr><th>כלול</th><th>#</th><th>שם</th><th>סופי</th><th>הוראה</th><th>תוכן</th><th>תחום מוביל</th><th>המלצה</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="btn-row" style="margin-top:16px"><button class="btn" id="sh-export">ייצא ל-Excel (monday)</button>' +
      '<button class="btn ghost small" id="sh-export-all">ייצא הכול (כולל לא-כלולים)</button></div></div>';
    document.getElementById('sh-close').onclick = function () { m.remove(); };
    document.getElementById('sh-export').onclick = function () { downloadBlob('/examiner/grading/export-sheet/' + data.cohort.id, 'grades-' + data.cohort.id + '.xlsx').catch(function (e) { alert(e.message); }); };
    document.getElementById('sh-export-all').onclick = function () { downloadBlob('/examiner/grading/export-sheet/' + data.cohort.id + '?all=1', 'grades-all-' + data.cohort.id + '.xlsx').catch(function (e) { alert(e.message); }); };
    m.querySelectorAll('.sh-inc').forEach(function (cb) {
      cb.onclick = function () { call('/examiner/grading/examinee-flags', 'POST', { cohort_id: data.cohort.id, code: cb.getAttribute('data-c'), include: cb.checked }).catch(function (e) { alert(e.message); }); cb.closest('tr').style.opacity = cb.checked ? '1' : '.5'; };
    });
  }

  // ------------------------------------------------- מחזור חיים
  function enter() {
    if (token) { call('/examiner/grading/cohorts').then(function (d) { renderHome(d); }).catch(function () { renderLogin(); }); }
    else renderLogin();
  }
  function leave() { stopProgress(); location.href = '/'; }

  // ניווט מקלדת: → הקודם, ← הבא (RTL)
  document.addEventListener('keydown', function (e) {
    if (!REV || document.getElementById('sheet-modal')) return;
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft' && REV.nav.next) { openReview(REV.nav.next); }
    else if (e.key === 'ArrowRight' && REV.nav.prev) { openReview(REV.nav.prev); }
  });

  return { enter: enter, leave: leave };
})();
