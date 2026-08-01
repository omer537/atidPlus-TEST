/* =========================================================================
   מסך המנהל — קונסולת ניהול חיה (מודל סבב-אחר-סבב).
   נכנסים מהכפתור "כניסת מנהל" או מהכתובת /examiner. חושף window.AdminApp={enter,leave}.
   ========================================================================= */
window.AdminApp = (function () {
  'use strict';

  var token = localStorage.getItem('yh_examiner_token') || null;
  var pollHandle = null;
  var root = document.getElementById('root');
  var availableSubjects = [];
  var addSubjects = [];
  var STATE = null;

  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtTime(sec) { if (sec == null) return '--:--'; var m = String(Math.floor(sec / 60)).padStart(2, '0'), s = String(sec % 60).padStart(2, '0'); return m + ':' + s; }

  async function call(path, method, body, raw) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['x-token'] = token;
    var res = await fetch('/api' + path, { method: method || 'GET', headers: headers, body: body ? JSON.stringify(body) : undefined });
    if (raw) return res;
    var data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw Object.assign(new Error((data && data.error) || 'שגיאה'), { status: res.status });
    return data;
  }

  // ------------------------------------------------- כניסה
  function renderLogin(errMsg) {
    if (pollHandle) clearInterval(pollHandle);
    root.className = 'center-screen';
    root.innerHTML = '';
    root.appendChild(el(
      '<div class="card" style="max-width:400px;width:100%">' +
      '<div class="brand"><img class="logo" src="/img/logo.svg" alt="עתיד פלוס"><span class="wordmark">עתיד פלוס</span><span class="sub">מסך מנהל</span></div>' +
      '<h2>כניסת מנהל</h2><p class="lead">הזינו את סיסמת הבוחן.</p>' +
      (errMsg ? '<div class="msg error">' + esc(errMsg) + '</div>' : '') +
      '<label class="field"><span>סיסמה</span><input id="pw" type="password" autocomplete="off"></label>' +
      '<div class="btn-row"><button class="btn" id="go">כניסה</button>' +
      '<button class="btn ghost" id="back-exam">חזרה למסך הנבחן</button></div></div>'
    ));
    document.getElementById('go').onclick = doLogin;
    document.getElementById('back-exam').onclick = leave;
    document.getElementById('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  }
  async function doLogin() {
    try {
      var r = await call('/examiner/login', 'POST', { password: document.getElementById('pw').value });
      token = r.token; localStorage.setItem('yh_examiner_token', token);
      start();
    } catch (e) { renderLogin('סיסמה שגויה.'); }
  }

  // ------------------------------------------------- מבנה המסך
  function renderShell() {
    root.className = 'wrap';
    root.innerHTML = '';
    root.appendChild(el(
      '<div>' +
      '<div class="exm-header">' +
      '<img class="logo" src="/img/logo.svg" alt="עתיד פלוס" style="height:42px">' +
      '<span class="wordmark" style="font-size:20px;font-weight:800">עתיד פלוס</span>' +
      '<span style="color:var(--muted);font-size:14px">· מסך מנהל</span>' +
      '<div class="spacer"></div>' +
      '<button class="btn ghost small" id="btn-health">תקינות בנק התוכן</button>' +
      '<button class="btn small" id="btn-roster" title="שמות, קודים אישיים וסבב ריאיון — לגיבוי אצלך">רשימת נבחנים וקודים</button>' +
      '<button class="btn small" id="btn-excel" title="כל התשובות כאקסל">הורד תשובות (Excel)</button>' +
      '<button class="btn ghost small" id="btn-export" title="גיבוי JSON לבדיקת AI">JSON</button>' +
      '<button class="btn ghost small" id="btn-logout">יציאה</button></div>' +
      '<div id="ended-banner"></div>' +
      // קונסולת הסבב
      '<div class="card"><div id="console"></div></div>' +
      // לוח תכנון — מי בריאיון בכל אחד מ-5 הסבבים
      '<div class="card"><div class="toolbar"><h2 class="section-title">לוח תכנון — מי בריאיון בכל סבב</h2>' +
      '<span class="spacer"></span><button class="btn ghost small" id="btn-autosplit">חלק לקבוצות</button></div>' +
      '<p class="hint-text">בטבלת הנבחנים למטה קובעים לכל אחד באיזה סבב הריאיון שלו (הכפתורים 1–5). כאן רואים את התמונה המלאה. אפשר לשנות לפני שסבב מתחיל; סבב שרץ/הסתיים נעול. הפרקים מסתדרים אוטומטית מסביב.</p>' +
      '<div class="plan-cols" id="planboard"></div></div>' +
      // מטריצה מלאה — נבחן × 5 סבבים
      '<div class="card"><div class="toolbar"><h2 class="section-title">מטריצה מלאה — נבחן × סבב</h2>' +
      '<span class="spacer"></span><button class="btn ghost small" id="btn-matrix-toggle">הסתר</button></div>' +
      '<div class="matrix-legend">' +
      '<span><span class="sw" style="background:rgba(69,184,78,0.5)"></span>נעשה</span>' +
      '<span><span class="sw" style="background:var(--teal)"></span>עכשיו</span>' +
      '<span><span class="sw" style="background:#3a4788"></span>ריאיון</span>' +
      '<span><span class="sw" style="border:1px dashed #6b76b0"></span>צפי (טרם נקבע)</span>' +
      '</div>' +
      '<p class="hint-text">עבר והווה מוצגים כפי שקרו בפועל; סבבים עתידיים הם <b>צפי</b> בלבד (נקבעים סופית כשהסבב מתחיל). לחיצה על תא פותחת את כרטיס הנבחן.</p>' +
      '<div style="overflow-x:auto" id="matrix"></div></div>' +
      // רשימת הנבחנים + סטטוס
      '<div class="card" style="margin-top:20px"><div class="toolbar"><h2 class="section-title">נבחנים וסטטוס</h2>' +
      '<span class="spacer"></span><span id="summary" class="health-list"></span></div>' +
      '<p class="hint-text" id="roster-hint"></p>' +
      '<div style="overflow-x:auto"><table class="grid" id="tbl"><thead><tr>' +
      '<th>שם</th><th>לריאיון?</th><th>סטטוס</th><th>עכשיו</th><th>זמן</th><th>התראות</th><th>פעולות</th>' +
      '</tr></thead><tbody id="tbody"></tbody></table></div></div>' +
      // ניהול נבחנים
      '<div class="card"><h2 class="section-title">ניהול נבחנים</h2>' +
      '<p class="hint-text">פתח/י משתמשים מראש (ביום עצמו הנבחן נכנס עם השם והקוד). אם לא תבחר/י מקצועות — הנבחן בוחר בעצמו בכניסה. זה גם המקום להוסיף נבחנים לבדיקה (וכפתור ✕ מסיר).</p>' +
      '<div style="display:flex;gap:24px;flex-wrap:wrap">' +
      '<div style="flex:1;min-width:260px"><b>הוספת נבחן יחיד</b>' +
      '<label class="field" style="margin-top:10px"><span>שם</span><input id="add-name" type="text"></label>' +
      '<label class="field"><span>קוד אישי (לא חובה)</span><input id="add-code" type="text" placeholder="ריק = הנבחן בוחר בכניסה"></label>' +
      '<label class="field"><span>סבב ריאיון (לא חובה)</span><select id="add-iround"><option value="">— ללא —</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>' +
      '<div class="chips" id="add-subjects" style="margin-bottom:10px"></div>' +
      '<button class="btn small" id="add-one">הוסף נבחן</button></div>' +
      '<div style="flex:1;min-width:260px"><b>הוספת רשימה שלמה</b>' +
      '<p class="hint-text">שורה לכל נבחן: <span style="font-family:var(--mono)">שם</span> (הקוד לא חובה: <span style="font-family:var(--mono)">שם, קוד</span> או <span style="font-family:var(--mono)">שם, קוד, סבב</span>)</p>' +
      '<textarea id="bulk-text" placeholder="דנה כהן, 1234, 2&#10;יוסי לוי, 5678&#10;..." style="min-height:120px"></textarea>' +
      '<button class="btn small" id="add-bulk" style="margin-top:8px">הוסף רשימה</button></div>' +
      '<div style="flex:1;min-width:260px"><b>העלאת תכנון ריאיונות</b>' +
      '<p class="hint-text">שורה לכל נבחן: <span style="font-family:var(--mono)">קוד או שם, סבב</span> — יסמן מראש מי לריאיון בכל סבב.</p>' +
      '<textarea id="plan-text" placeholder="1234, 1&#10;דנה כהן, 2&#10;..." style="min-height:120px"></textarea>' +
      '<button class="btn small" id="plan-load" style="margin-top:8px">טען תכנון</button></div>' +
      '</div><div id="add-msg" style="margin-top:12px"></div></div>' +
      // גיבוי
      '<div class="card"><h2 class="section-title">גיבוי ושחזור</h2>' +
      '<p class="hint-text">המערכת מגבה אוטומטית כל 5 דקות (וגם לפני כל פעולת איפוס), גם בשרת. כאן אפשר לגבות עכשיו ולהוריד גיבוי.</p>' +
      '<div class="btn-row"><button class="btn small" id="btn-backup-now">גבה עכשיו</button></div>' +
      '<div id="backup-list" class="health-list" style="margin-top:12px"></div></div>' +
      // אזור מסוכן
      '<div class="card"><h2 class="section-title">פעולות כלליות</h2>' +
      '<div class="btn-row"><button class="btn danger small" id="btn-end-exam">סיים את המבחן (לכולם)</button>' +
      '<button class="btn ghost small" id="btn-full-reset">אפס יום מלא (לחזרה גנרלית)</button></div>' +
      '<p class="hint-text">"סיים את המבחן" מעביר את כל הנבחנים למסך סיום. "אפס יום מלא" מוחק את כל ההתקדמות והתשובות ומתחיל מאפס — שומר את רשימת הנבחנים והתכנון. להשתמש רק לפני היום או אחרי חזרה גנרלית.</p>' +
      '<div id="health"></div></div>' +
      '</div>'
    ));
    document.getElementById('btn-logout').onclick = function () { localStorage.removeItem('yh_examiner_token'); token = null; if (pollHandle) clearInterval(pollHandle); leave(); };
    document.getElementById('btn-roster').onclick = downloadRoster;
    document.getElementById('btn-excel').onclick = downloadExcel;
    document.getElementById('btn-export').onclick = downloadExport;
    document.getElementById('btn-health').onclick = toggleHealth;
    document.getElementById('btn-backup-now').onclick = backupNow;
    document.getElementById('add-one').onclick = addOne;
    document.getElementById('add-bulk').onclick = addBulk;
    document.getElementById('plan-load').onclick = loadPlan;
    document.getElementById('btn-end-exam').onclick = endExam;
    document.getElementById('btn-full-reset').onclick = fullReset;
    document.getElementById('btn-autosplit').onclick = autosplit;
    var mt = document.getElementById('btn-matrix-toggle');
    if (mt) mt.onclick = function () { matrixHidden = !matrixHidden; this.textContent = matrixHidden ? 'הצג' : 'הסתר'; refresh(); };
    renderAddSubjects();
  }

  async function autosplit() {
    if (!confirm('לחלק אוטומטית לריאיון את מי שעדיין לא משובץ, שווה בשווה בין הסבבים הפתוחים?')) return;
    try { var r = await call('/examiner/autosplit-interviews', 'POST', {}); alert('שובצו ' + r.assigned + ' נבחנים לריאיון.'); refresh(); }
    catch (e) { alert(e.message); }
  }

  function renderPlanBoard(S) {
    var box = document.getElementById('planboard'); if (!box) return;
    var states = {}; S.rounds.forEach(function (r) { states[r.round] = r.state; });
    var byRound = {}; for (var i = 1; i <= S.total_rounds; i++) byRound[i] = [];
    S.examinees.forEach(function (e) { (e.marked_rounds || []).forEach(function (rn) { if (byRound[rn]) byRound[rn].push(e.name); }); });
    var html = '';
    for (var n = 1; n <= S.total_rounds; n++) {
      var st = states[n] || 'planned';
      var cls = st === 'running' ? 'running' : (st === 'ended' ? 'ended' : '');
      var lbl = st === 'running' ? 'פועל' : (st === 'ended' ? 'הסתיים' : 'מתוכנן');
      var names = byRound[n].length ? byRound[n].map(function (nm) { return '<span class="chip-name">' + esc(nm) + '</span>'; }).join('') : '<span style="color:var(--faint);font-size:12px">— ריק —</span>';
      html += '<div class="plan-col ' + cls + '"><div class="pc-head"><span>סבב ' + n + '</span><small>' + byRound[n].length + ' · ' + lbl + '</small></div>' + names + '</div>';
    }
    box.innerHTML = html;
  }

  // ------------------------------------------------- מטריצה מלאה
  var matrixHidden = false;
  function renderMatrix(M) {
    var box = document.getElementById('matrix'); if (!box) return;
    if (matrixHidden) { box.innerHTML = ''; return; }
    if (!M || !M.examinees.length) { box.innerHTML = '<p class="hint-text">אין נבחנים עדיין.</p>'; return; }
    var states = {}; M.rounds.forEach(function (r) { states[r.round] = r.state; });
    var head = '<th class="nm" style="min-width:130px">נבחן</th>';
    for (var n = 1; n <= M.total_rounds; n++) {
      var st = states[n] || 'planned';
      var rc = st === 'running' ? ' class="rc"' : '';
      var lbl = st === 'running' ? 'רץ עכשיו' : (st === 'ended' ? 'הסתיים' : 'מתוכנן');
      head += '<th' + rc + '>סבב ' + n + '<small>' + lbl + '</small></th>';
    }
    var rows = M.examinees.map(function (e) {
      var nm = '<td class="nm"><b>' + esc(e.name) + '</b>' +
        (e.needs_interview_unplanned ? ' <span style="color:var(--warn);font-size:11px" title="עדיין לא שובץ ריאיון">⚑ ריאיון?</span>' : '') +
        (e.left ? ' <small style="color:var(--danger)">(עזב)</small>' : '') +
        (!e.setup ? '<small>טרם בחר מקצועות</small>' : '') + '</td>';
      var tds = e.cells.map(function (c) {
        if (!c) return '<td class="mx idle">—</td>';
        var inner = c.label + (c.level ? ' <small style="opacity:.7">(' + esc(c.level) + ')</small>' : '');
        if (c.type === 'done') inner = '<span class="ck">✓</span> ' + esc(c.label);
        else inner = esc(c.label) + (c.level ? ' <small style="opacity:.7">' + esc(c.level) + '</small>' : '');
        var clickable = c.type !== 'idle';
        return '<td class="mx ' + c.type + '"' + (clickable ? ' data-c="' + esc(e.code) + '"' : '') + '>' + inner + '</td>';
      }).join('');
      return '<tr class="' + (e.left ? 'mx-left' : '') + '">' + nm + tds + '</tr>';
    }).join('');
    box.innerHTML = '<table class="matrix"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table>';
    box.querySelectorAll('td.mx[data-c]').forEach(function (td) {
      td.onclick = function () { openCard(td.getAttribute('data-c')); };
    });
  }

  // ------------------------------------------------- קונסולת הסבב
  function renderConsole(S) {
    var box = document.getElementById('console'); if (!box) return;
    var states = {}; S.rounds.forEach(function (r) { states[r.round] = r.state; });
    var running = S.running;
    var firstPlanned = null; for (var i = 1; i <= S.total_rounds; i++) { if (states[i] === 'planned') { firstPlanned = i; break; } }
    var latestActive = 0; for (var k = S.total_rounds; k >= 1; k--) { if (states[k] && states[k] !== 'planned') { latestActive = k; break; } }
    var planningRound = running || firstPlanned;
    window.__planningRound = running ? null : firstPlanned; // איפה מותר לסמן

    var strip = S.rounds.map(function (r) {
      var cls = r.state === 'running' ? 'running' : (r.state === 'ended' ? 'ended' : '');
      var lbl = r.state === 'running' ? 'פועל' : (r.state === 'ended' ? 'הסתיים' : 'ממתין');
      return '<div class="round-chip ' + cls + '">סבב ' + r.round + '<small>' + lbl + '</small></div>';
    }).join('');

    // שתי רשימות
    var interviewers = [], solvers = [];
    S.examinees.forEach(function (e) {
      if (running) {
        if (e.current && e.current.kind === 'interview') interviewers.push(e);
        else if (e.current && e.current.kind === 'chapter') solvers.push(e);
      } else if (planningRound) {
        if (e.setup && !e.interviewed && e.marked_rounds.indexOf(planningRound) >= 0) interviewers.push(e);
        else if (e.setup && !e.finished) solvers.push(e);
      }
    });
    function nameChips(arr, withNow) {
      if (!arr.length) return '<span style="color:var(--faint)">— אין —</span>';
      return arr.map(function (e) {
        var extra = '';
        if (withNow && e.current && e.current.kind === 'chapter') extra = ' · ' + esc(e.current.subject || '') + (e.timer && e.timer.state === 'running' ? ' (' + fmtTime(e.timer.remaining_sec) + ')' : '');
        return '<span class="chip-name">' + esc(e.name) + extra + '</span>';
      }).join('');
    }

    // כפתורי בקרה לפי מצב
    var controls = '';
    var title = '';
    if (running) {
      title = 'סבב ' + running + ' — פועל';
      controls = '<button class="btn" id="c-end">סיים סבב ' + running + '</button>' +
        '<button class="btn ghost" id="c-pause">⏸ השהה את כולם</button>' +
        '<button class="btn ghost" id="c-resume">▶ המשך לכולם</button>' +
        '<button class="btn ghost" id="c-resetall">אפס לכולם (טיימר מחדש)</button>' +
        '<button class="btn danger" id="c-reset" data-r="' + running + '">בטל/אפס סבב ' + running + '</button>';
    } else if (firstPlanned && (firstPlanned === 1 || states[firstPlanned - 1] === 'ended')) {
      title = 'סבב ' + firstPlanned + ' — מוכן. סמן/י בטבלה מי לריאיון, ואז לחצ/י התחל.';
      controls = '<button class="btn big" id="c-start" data-r="' + firstPlanned + '">התחל סבב ' + firstPlanned + '</button>';
      if (latestActive) controls += '<button class="btn danger ghost" id="c-reset" data-r="' + latestActive + '">בטל/אפס סבב ' + latestActive + '</button>';
    } else {
      title = 'כל הסבבים הסתיימו 🎉';
      if (latestActive) controls = '<button class="btn danger ghost" id="c-reset" data-r="' + latestActive + '">בטל/אפס סבב ' + latestActive + '</button>';
    }

    box.innerHTML =
      '<h2 class="section-title">ניהול הסבב</h2>' +
      '<div class="round-strip">' + strip + '</div>' +
      '<p style="font-weight:700;margin:14px 0 4px">' + esc(title) + '</p>' +
      '<div class="btn-row" id="console-controls">' + controls + '</div>' +
      '<div class="two-lists">' +
      '<div class="list-col"><div class="list-head interview">בריאיון (' + interviewers.length + ')</div>' + nameChips(interviewers, false) + '</div>' +
      '<div class="list-col"><div class="list-head chapter">בפרק (' + solvers.length + ')</div>' + nameChips(solvers, true) + '</div>' +
      '</div>';

    // כל handler קורא את הסבב מהכפתור עצמו (this) — לא ממשתנה משותף
    var s;
    if ((s = document.getElementById('c-start'))) s.onclick = function () { startRound(Number(this.getAttribute('data-r'))); };
    if ((s = document.getElementById('c-end'))) s.onclick = function () { endRound(); };
    if ((s = document.getElementById('c-reset'))) s.onclick = function () { resetRound(Number(this.getAttribute('data-r'))); };
    if ((s = document.getElementById('c-resetall'))) s.onclick = function () { resetAllCurrent(); };
    if ((s = document.getElementById('c-pause'))) s.onclick = function () { pauseAll(true); };
    if ((s = document.getElementById('c-resume'))) s.onclick = function () { pauseAll(false); };
  }

  // ------------------------------------------------- טבלת הנבחנים
  function attnOf(S, e) {
    if (e.left) return false;
    if (e.current && e.current.kind === 'chapter' && e.current.status !== 'done' && e.timer && e.timer.state === 'expired') return true;
    if (e.flags) return true;
    if (e.needs_interview && (e.marked_rounds || []).length === 0) return true;
    if (S.running && !e.setup) return true;
    return false;
  }

  function renderRoster(S) {
    var tb = document.getElementById('tbody'); if (!tb) return;
    var states = {}; S.rounds.forEach(function (r) { states[r.round] = r.state; });
    var hint = document.getElementById('roster-hint');
    if (hint) hint.innerHTML = S.running
      ? 'סבב <b>' + S.running + '</b> פועל. סבב שכבר התחיל/הסתיים נעול לסימון. לחצו "כרטיס" לטיפול פרטני בנבחן.'
      : 'קבעו לכל נבחן באיזה סבב הריאיון שלו (כפתורים 1–5). לחצו "כרטיס" לפרטים ולפעולות פרטניות.';

    var rows = S.examinees.slice().sort(function (a, b) { return (attnOf(S, b) ? 1 : 0) - (attnOf(S, a) ? 1 : 0); });

    tb.innerHTML = rows.map(function (e) {
      var ivCell;
      if (!e.setup) ivCell = '<span style="color:var(--faint);font-size:12px">טרם נרשם</span>';
      else if (e.interviewed) ivCell = '<span style="color:var(--ok)">התראיין ✓</span>';
      else {
        var btns = '';
        for (var n = 1; n <= S.total_rounds; n++) {
          var on = e.marked_rounds.indexOf(n) >= 0;
          var locked = states[n] && states[n] !== 'planned';
          btns += '<button class="' + (on ? 'on' : '') + '" data-c="' + esc(e.code) + '" data-r="' + n + '"' + (locked ? ' disabled' : '') + '>' + n + '</button>';
        }
        ivCell = '<div class="rbtns" title="באיזה סבב הריאיון שלו">' + btns + '</div>';
      }

      var doneTxt = e.chapters_done.length ? e.chapters_done.join(', ') : '—';
      var remTxt = e.remaining_chapters.length ? e.remaining_chapters.join(', ') : '—';
      var ivTxt = e.interviewed ? '<span style="color:var(--ok)">התראיין ✓</span>' : '<span style="color:var(--warn)">טרם התראיין</span>';
      var status = '<div style="font-size:12px;line-height:1.7"><div>עשה: ' + esc(doneTxt) + '</div><div>נותר: ' + esc(remTxt) + '</div><div>' + ivTxt + (e.finished ? ' · <span style="color:var(--ok)">סיים הכול</span>' : '') + (e.left ? ' · <span style="color:var(--faint)">עזב</span>' : '') + '</div></div>';

      var now = '—';
      if (e.in_interview) now = '<span class="pill interview">בריאיון</span>';
      else if (e.current) {
        if (e.current.kind === 'interview') now = '<span class="pill interview">בריאיון</span>';
        else if (e.current.status === 'done') now = '<span class="pill done">הגיש</span>';
        else now = '<span class="pill chapter">' + esc(e.current.subject || '') + (e.current.level ? ' · ' + e.current.level : '') + '</span>' + (e.current.not_comfortable ? ' <span title="לא בנוח" style="color:var(--warn)">⚑</span>' : '');
      } else if (!e.setup) now = '<span style="color:var(--faint)">ממתין לרישום</span>';

      var timeCell = (!e.in_interview && e.current && e.current.kind === 'chapter' && e.current.status !== 'done')
        ? '<span class="t-' + (e.timer.state || 'none') + ' pill mono">' + fmtTime(e.timer.remaining_sec) + '</span>' : '<span style="color:var(--faint)">—</span>';
      var flags = e.flags ? '<span class="stat"><span class="dot-flag"></span>' + e.flags + '</span>' : '<span style="color:var(--faint)">0</span>';
      var cardBtn = '<button class="btn ghost small open-card" data-c="' + esc(e.code) + '">כרטיס</button>';
      var cls = (attnOf(S, e) ? 'attn' : '') + (e.left ? ' left-row' : '');

      return '<tr class="' + cls.trim() + '"><td>' + esc(e.name) + '</td><td>' + ivCell + '</td><td>' + status + '</td><td>' + now + '</td><td>' + timeCell + '</td><td>' + flags + '</td><td>' + cardBtn + '</td></tr>';
    }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--faint);padding:30px">אין נבחנים עדיין. הוסיפו בחלק "ניהול נבחנים".</td></tr>';

    var iv = S.examinees.filter(function (e) { return e.interviewed; }).length;
    var need = S.examinees.filter(function (e) { return e.needs_interview; }).length;
    document.getElementById('summary').innerHTML = S.examinees.length + ' נבחנים · התראיינו: ' + iv + ' · ממתינים לריאיון: ' + need;

    tb.querySelectorAll('.rbtns button').forEach(function (b) {
      if (b.disabled) return;
      b.onclick = function () {
        var on = !b.classList.contains('on');
        call('/examiner/mark-interview', 'POST', { code: b.getAttribute('data-c'), round: Number(b.getAttribute('data-r')), on: on })
          .then(function (r) { if (r && r.warn) alert(r.warn); refresh(); }).catch(function (e) { alert(e.message); refresh(); });
      };
    });
    tb.querySelectorAll('.open-card').forEach(function (b) { b.onclick = function () { openCard(b.getAttribute('data-c')); }; });
  }

  // ------------------------------------------------- כרטיס נבחן (מודאל)
  function openCard(code) { window.__openCardCode = code; renderCard(code); }
  function closeCard() { window.__openCardCode = null; var m = document.getElementById('card-modal'); if (m) m.remove(); }
  function renderCard(code) {
    var e = STATE && STATE.examinees.find(function (x) { return x.code === code; });
    if (!e) { closeCard(); return; }
    var m = document.getElementById('card-modal');
    if (!m) { m = el('<div class="modal-back" id="card-modal"></div>'); document.body.appendChild(m); m.onclick = function (ev) { if (ev.target === m) closeCard(); }; }
    var tl = '';
    e.chapters_done.forEach(function (s) { tl += '<span class="tl done">✓ ' + esc(s) + '</span>'; });
    if (e.interviewed) tl += '<span class="tl done">✓ ריאיון</span>';
    if (e.in_interview) tl += '<span class="tl now">▶ בריאיון</span>';
    else if (e.current) { var lab = e.current.kind === 'interview' ? 'ריאיון' : esc(e.current.subject || ''); tl += '<span class="tl now">▶ ' + lab + (e.timer && e.timer.state === 'running' ? ' ' + fmtTime(e.timer.remaining_sec) : '') + '</span>'; }
    e.remaining_chapters.forEach(function (s) { tl += '<span class="tl pending">' + esc(s) + '</span>'; });
    if (!e.interviewed && !e.in_interview && !(e.current && e.current.kind === 'interview')) tl += '<span class="tl pending">ריאיון</span>';

    var actions =
      '<button class="btn" data-x="advance">קדם לפעילות הבאה</button>' +
      (e.in_interview ? '<button class="btn" data-x="ireturn">חזר מריאיון</button>' : '<button class="btn ghost" data-x="iout">שלח לריאיון עכשיו</button>') +
      '<button class="btn ghost" data-x="add_time">הוסף 2 דקות</button>' +
      '<button class="btn ghost" data-x="reset_slot">אפס משבצת</button>' +
      '<button class="btn ghost" data-x="reopen">פתח הגשה מחדש</button>' +
      (e.left ? '<button class="btn ghost" data-x="unleft">החזר לפעילות</button>' : '<button class="btn ghost" data-x="left">סמן: עזב</button>') +
      '<button class="btn danger" data-x="remove">הסר נבחן</button>';

    var ivText = (e.marked_rounds && e.marked_rounds.length) ? ('סבב ' + e.marked_rounds.join(', ')) : (e.interviewed ? 'התראיין ✓' : 'טרם נקבע');
    var editing = window.__cardEditing === code;
    var meta = editing
      ? '<div class="mc-edit" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px;background:rgba(255,255,255,.03);padding:10px;border-radius:10px">' +
          '<label class="field" style="margin:0;flex:1;min-width:150px"><span>שם</span><input id="edit-name" type="text" value="' + esc(e.name) + '"></label>' +
          '<label class="field" style="margin:0;flex:1;min-width:120px"><span>קוד אישי</span><input id="edit-pin" type="text" value="' + esc(e.pin || '') + '" placeholder="ריק = לפי שם בלבד"></label>' +
          '<button class="btn small" data-x="save_edit">שמור</button>' +
          '<button class="btn ghost small" data-x="cancel_edit">בטל</button>' +
        '</div>'
      : '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;background:rgba(35,179,164,.08);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:14px">' +
          '<div>קוד אישי <span style="color:var(--faint);font-size:12px">(סיסמה)</span>: <b style="font-size:16px;font-family:var(--mono)">' + esc(e.pin || '—') + '</b></div>' +
          '<div>סבב ריאיון: <b>' + esc(ivText) + '</b></div>' +
          '<div style="color:var(--muted)">מקצועות: ' + esc((e.subjects || []).join(', ') || 'טרם בחר') + '</div>' +
          '<span style="flex:1"></span>' +
          '<button class="btn ghost small" data-x="edit">ערוך שם/קוד</button></div>';

    m.innerHTML = '<div class="modal-card">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px"><h2 style="margin:0;font-size:20px">' + esc(e.name) + '</h2><span style="flex:1"></span><button class="btn ghost small" id="card-close">סגור</button></div>' +
      meta +
      '<div style="font-size:13px;color:var(--muted)">מסלול</div><div class="timeline">' + (tl || '<span style="color:var(--faint)">—</span>') + '</div>' +
      '<div style="font-size:13px;color:var(--muted);margin-top:12px">טיפול פרטני (לא משפיע על שאר הכיתה)</div>' +
      '<div class="mc-actions">' + actions + '</div></div>';
    document.getElementById('card-close').onclick = closeCard;
    m.querySelectorAll('.mc-actions button, .mc-edit button, [data-x="edit"]').forEach(function (b) { b.onclick = function () { cardAction(code, b.getAttribute('data-x')); }; });
  }
  async function cardAction(code, x) {
    try {
      if (x === 'edit') { window.__cardEditing = code; renderCard(code); return; }
      else if (x === 'cancel_edit') { window.__cardEditing = null; renderCard(code); return; }
      else if (x === 'save_edit') {
        var newName = document.getElementById('edit-name').value.trim();
        var newPin = document.getElementById('edit-pin').value.trim();
        await call('/examiner/edit-examinee', 'POST', { code: code, name: newName, pin: newPin });
        window.__cardEditing = null; refresh(); return;
      }
      else if (x === 'advance') { var r = await call('/examiner/advance-examinee', 'POST', { code: code }); if (r.warn) alert(r.warn); }
      else if (x === 'iout') await call('/examiner/interview-out', 'POST', { code: code });
      else if (x === 'ireturn') await call('/examiner/interview-return', 'POST', { code: code });
      else if (x === 'reopen') await call('/examiner/reopen-submit', 'POST', { code: code });
      else if (x === 'left') await call('/examiner/set-left', 'POST', { code: code, left: true });
      else if (x === 'unleft') await call('/examiner/set-left', 'POST', { code: code, left: false });
      else if (x === 'remove') { if (!confirm('להסיר את הנבחן? כל הנתונים שלו יימחקו.')) return; await call('/examiner/remove-examinee', 'POST', { code: code }); closeCard(); }
      else if (x === 'add_time') await call('/examiner/override', 'POST', { code: code, action: 'add_time', seconds: 120 });
      else if (x === 'reset_slot') await call('/examiner/override', 'POST', { code: code, action: 'reset_slot' });
      refresh();
    } catch (e) { alert(e.message); }
  }

  // ------------------------------------------------- פעולות סבב
  async function startRound(r) {
    try { var res = await call('/examiner/start-round', 'POST', { round: r }); alert('סבב ' + r + ' התחיל · ' + res.interviews + ' בריאיון · ' + res.chapters + ' בפרק.'); refresh(); }
    catch (e) { alert(e.message); }
  }
  async function endRound() {
    if (!confirm('לסיים את הסבב הנוכחי? כל הפרקים ייסגרו והנבחנים יעברו להמתנה לסבב הבא.')) return;
    try { await call('/examiner/end-round', 'POST', {}); refresh(); } catch (e) { alert(e.message); }
  }
  async function resetRound(r) {
    if (!confirm('לבטל/לאפס את סבב ' + r + '? המשבצות של הסבב יימחקו והוא יחזור למצב "מוכן". התשובות נשמרות. (נוצר גיבוי לפני.)')) return;
    try { await call('/examiner/reset-round', 'POST', { round: r }); refresh(); } catch (e) { alert(e.message); }
  }
  async function resetAllCurrent() {
    if (!confirm('לאפס את הטיימר והמשבצת של כל הנבחנים בסבב הנוכחי?')) return;
    try { await call('/examiner/reset-all-current', 'POST', {}); refresh(); } catch (e) { alert(e.message); }
  }
  async function pauseAll(pause) {
    try { var r = await call('/examiner/pause-all', 'POST', { pause: pause }); if (pause) alert('הושהו ' + r.affected + ' נבחנים.'); refresh(); }
    catch (e) { alert(e.message); }
  }
  async function endExam() {
    if (!confirm('לסיים את המבחן לכל הנבחנים? כולם יעברו למסך "המבחן הסתיים".')) return;
    try { await call('/examiner/end-exam', 'POST', { ended: true }); refresh(); } catch (e) { alert(e.message); }
  }
  async function fullReset() {
    if (!confirm('אפס יום מלא: למחוק את כל ההתקדמות והתשובות ולהתחיל מאפס? הנבחנים והתכנון יישמרו. (נוצר גיבוי לפני.)')) return;
    if (!confirm('בטוח? פעולה זו מוחקת את כל התשובות שנשמרו.')) return;
    try { await call('/examiner/full-reset', 'POST', {}); refresh(); } catch (e) { alert(e.message); }
  }

  async function renderExamState() {
    var box = document.getElementById('ended-banner'); if (!box) return;
    try {
      var s = await call('/examiner/exam-state');
      if (s.ended) {
        box.innerHTML = '';
        box.appendChild(el('<div class="msg warn" style="display:flex;align-items:center;gap:12px"><span>המבחן במצב "הסתיים" — כל הנבחנים רואים מסך סיום.</span><button class="btn ghost small" id="btn-reopen">החזר לפעילות</button></div>'));
        document.getElementById('btn-reopen').onclick = function () { call('/examiner/end-exam', 'POST', { ended: false }).then(renderExamState).catch(function (e) { alert(e.message); }); };
      } else box.innerHTML = '';
    } catch (e) {}
  }

  // ------------------------------------------------- ניהול נבחנים
  function renderAddSubjects() {
    var box = document.getElementById('add-subjects'); if (!box) return;
    box.innerHTML = availableSubjects.map(function (s) {
      var i = addSubjects.indexOf(s), sel = i >= 0;
      return '<div class="chip ' + (sel ? 'selected' : '') + '" data-s="' + esc(s) + '">' + esc(s) + (sel ? ' <span class="order">#' + (i + 1) + '</span>' : '') + '</div>';
    }).join('');
    box.querySelectorAll('.chip').forEach(function (c) {
      c.onclick = function () {
        var s = c.getAttribute('data-s'), i = addSubjects.indexOf(s);
        if (i >= 0) addSubjects.splice(i, 1); else { if (addSubjects.length >= 4) return; addSubjects.push(s); }
        renderAddSubjects();
      };
    });
  }
  async function addOne() {
    var name = document.getElementById('add-name').value.trim(), code = document.getElementById('add-code').value.trim();
    var iround = document.getElementById('add-iround').value, box = document.getElementById('add-msg');
    if (!name) { box.innerHTML = '<div class="msg error">יש למלא שם.</div>'; return; }
    try {
      await call('/examiner/add-examinee', 'POST', { name: name, code: code, subjects: addSubjects.slice(), interview_round: iround || undefined });
      box.innerHTML = '<div class="msg info">נוסף: ' + esc(name) + '.</div>';
      document.getElementById('add-name').value = ''; document.getElementById('add-code').value = ''; document.getElementById('add-iround').value = '';
      addSubjects = []; renderAddSubjects(); refresh();
    } catch (e) { box.innerHTML = '<div class="msg error">' + esc(e.message) + '</div>'; }
  }
  async function addBulk() {
    var text = document.getElementById('bulk-text').value, box = document.getElementById('add-msg');
    if (!text.trim()) { box.innerHTML = '<div class="msg error">הרשימה ריקה.</div>'; return; }
    try {
      var r = await call('/examiner/add-examinees-bulk', 'POST', { text: text });
      var msg = 'נוספו ' + r.added + '.'; if (r.skipped && r.skipped.length) msg += ' דילג על ' + r.skipped.length + '.';
      box.innerHTML = '<div class="msg ' + (r.added ? 'info' : 'warn') + '">' + esc(msg) + '</div>';
      document.getElementById('bulk-text').value = ''; refresh();
    } catch (e) { box.innerHTML = '<div class="msg error">' + esc(e.message) + '</div>'; }
  }
  async function loadPlan() {
    var text = document.getElementById('plan-text').value, box = document.getElementById('add-msg');
    if (!text.trim()) { box.innerHTML = '<div class="msg error">התכנון ריק.</div>'; return; }
    try {
      var r = await call('/examiner/set-interview-plan', 'POST', { text: text });
      var msg = 'סומנו ' + r.marked + ' לריאיון.'; if (r.skipped && r.skipped.length) msg += ' דילג על ' + r.skipped.length + '.';
      box.innerHTML = '<div class="msg ' + (r.marked ? 'info' : 'warn') + '">' + esc(msg) + '</div>';
      document.getElementById('plan-text').value = ''; refresh();
    } catch (e) { box.innerHTML = '<div class="msg error">' + esc(e.message) + '</div>'; }
  }

  // ------------------------------------------------- גיבוי / ייצוא / תקינות
  function fmtBytes(n) { return n < 1024 ? n + ' ב׳' : (n / 1024).toFixed(1) + ' KB'; }
  function fmtWhen(ms) { try { return new Date(ms).toLocaleString('he-IL'); } catch (e) { return ''; } }
  async function loadBackups() {
    var box = document.getElementById('backup-list'); if (!box) return;
    try {
      var r = await call('/examiner/backups');
      if (!r.files.length) { box.innerHTML = 'עדיין אין גיבויים.'; return; }
      box.innerHTML = '<div style="margin-bottom:6px;color:var(--muted)">גיבוי אחרון: ' + fmtWhen(r.files[0].at) + '</div>' +
        r.files.slice(0, 10).map(function (f) {
          var kind = f.name.indexOf('snapshot') === 0 ? 'עותק DB' : 'JSON';
          return '<div style="display:flex;align-items:center;gap:10px;padding:3px 0"><button class="dl-bk" data-bk="' + esc(f.name) + '" style="border:1px solid var(--border);background:rgba(8,14,36,.5);color:var(--muted);border-radius:8px;padding:3px 10px;cursor:pointer">הורד</button><span style="color:var(--faint)">' + kind + ' · ' + fmtBytes(f.size) + ' · ' + fmtWhen(f.at) + '</span></div>';
        }).join('');
      box.querySelectorAll('.dl-bk').forEach(function (b) { b.onclick = function () { downloadBackup(b.getAttribute('data-bk')); }; });
    } catch (e) { box.innerHTML = '<span class="bad">שגיאה בטעינת הגיבויים.</span>'; }
  }
  async function backupNow() { try { var r = await call('/examiner/backup-now', 'POST'); if (!r.ok) throw new Error(r.error || 'נכשל'); loadBackups(); } catch (e) { alert(e.message); } }
  async function downloadBlob(path, filename) {
    var res = await call(path, 'GET', null, true); if (!res.ok) throw new Error('הורדה נכשלה');
    var blob = await res.blob(), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  function downloadBackup(name) { downloadBlob('/examiner/backup/' + encodeURIComponent(name), name).catch(function (e) { alert(e.message); }); }
  function downloadRoster() { downloadBlob('/examiner/export-roster', 'examinees-roster.xlsx').catch(function (e) { alert(e.message); }); }
  function downloadExcel() { downloadBlob('/examiner/export-excel', 'assessment-answers.xlsx').catch(function (e) { alert(e.message); }); }
  function downloadExport() { downloadBlob('/examiner/export-all', 'assessment-answers.json').catch(function (e) { alert(e.message); }); }

  var healthShown = false;
  async function toggleHealth() {
    var box = document.getElementById('health');
    if (healthShown) { box.innerHTML = ''; healthShown = false; return; }
    healthShown = true;
    try {
      var h = await call('/examiner/content-health');
      var rows = h.chapters.map(function (c) { return '<div>' + (c.valid ? '<span class="ok">✓</span> ' : '<span class="bad">✗</span> ') + esc(c.chapter_id) + ' <span style="color:var(--faint)">(' + esc(c.subject) + ')</span></div>'; }).join('');
      var probs = (h.problems || []).filter(function (p) { return p.level === 'error'; });
      box.innerHTML = '<div style="margin-top:14px"><b>תקינות בנק התוכן</b><div class="health-list">' + rows + '</div>' +
        (probs.length ? '<div class="msg error" style="margin-top:10px">' + probs.length + ' בעיות. הרץ: npm run check-content</div>' : '<div class="msg info" style="margin-top:10px">כל הפרקים תקינים.</div>') + '</div>';
    } catch (e) { box.innerHTML = '<div class="msg error">' + esc(e.message) + '</div>'; }
  }

  // ------------------------------------------------- לולאה
  async function refresh() {
    try { STATE = await call('/examiner/status'); } catch (e) { if (e.status === 401) return renderLogin('פג תוקף. התחבר/י מחדש.'); return; }
    var M = null;
    if (!matrixHidden) { try { M = await call('/examiner/matrix'); } catch (e) { /* אל תשבור את הרענון */ } }
    try {
      renderConsole(STATE); renderPlanBoard(STATE); renderMatrix(M); renderRoster(STATE); renderExamState();
      if (window.__openCardCode) renderCard(window.__openCardCode);
    } catch (e) { /* לא לשבור את הלולאה בגלל שגיאת רינדור */ }
  }
  async function start() {
    try { availableSubjects = (await call('/subjects')).subjects || []; } catch (e) { availableSubjects = []; }
    renderShell();
    refresh(); loadBackups();
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = setInterval(refresh, 3000);
  }

  async function enter() {
    if (token) { try { await call('/examiner/status'); start(); return; } catch (e) { token = null; localStorage.removeItem('yh_examiner_token'); } }
    renderLogin();
  }
  function leave() {
    if (pollHandle) clearInterval(pollHandle);
    if (typeof window.__showExamineeLogin === 'function') window.__showExamineeLogin();
    else location.href = '/';
  }
  return { enter: enter, leave: leave };
})();
