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
      '<button class="btn small" id="btn-excel" title="כל התשובות כאקסל">הורד תשובות (Excel)</button>' +
      '<button class="btn ghost small" id="btn-export" title="גיבוי JSON לבדיקת AI">JSON</button>' +
      '<button class="btn ghost small" id="btn-logout">יציאה</button></div>' +
      '<div id="ended-banner"></div>' +
      // קונסולת הסבב
      '<div class="card"><div id="console"></div></div>' +
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
      '<label class="field"><span>קוד אישי</span><input id="add-code" type="text"></label>' +
      '<label class="field"><span>סבב ריאיון (לא חובה)</span><select id="add-iround"><option value="">— ללא —</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>' +
      '<div class="chips" id="add-subjects" style="margin-bottom:10px"></div>' +
      '<button class="btn small" id="add-one">הוסף נבחן</button></div>' +
      '<div style="flex:1;min-width:260px"><b>הוספת רשימה שלמה</b>' +
      '<p class="hint-text">שורה לכל נבחן: <span style="font-family:var(--mono)">שם, קוד</span> (אפשר להוסיף סבב: <span style="font-family:var(--mono)">שם, קוד, סבב</span>)</p>' +
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
    document.getElementById('btn-excel').onclick = downloadExcel;
    document.getElementById('btn-export').onclick = downloadExport;
    document.getElementById('btn-health').onclick = toggleHealth;
    document.getElementById('btn-backup-now').onclick = backupNow;
    document.getElementById('add-one').onclick = addOne;
    document.getElementById('add-bulk').onclick = addBulk;
    document.getElementById('plan-load').onclick = loadPlan;
    document.getElementById('btn-end-exam').onclick = endExam;
    document.getElementById('btn-full-reset').onclick = fullReset;
    renderAddSubjects();
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
  function renderRoster(S) {
    var tb = document.getElementById('tbody'); if (!tb) return;
    var planning = window.__planningRound; // סבב שאפשר לסמן אליו (null אם רץ סבב)
    var hint = document.getElementById('roster-hint');
    if (hint) hint.innerHTML = planning
      ? 'הסבב הבא להתחלה הוא <b>סבב ' + planning + '</b>. סמנו בעמודת "לריאיון?" מי יוצא לריאיון בסבב הזה, ואז לחצו "התחל סבב" למעלה.'
      : (S.running ? 'סבב <b>' + S.running + '</b> פועל. הסימון נעול עד לסיום הסבב. אפשר לבצע פעולות פרטניות לכל נבחן.' : '');

    tb.innerHTML = S.examinees.map(function (e) {
      // עמודת סימון לריאיון
      var markCell;
      if (!e.setup) markCell = '<span style="color:var(--faint)">טרם נרשם</span>';
      else if (e.interviewed) markCell = '<span style="color:var(--ok)">התראיין ✓</span>';
      else if (planning) {
        var checked = e.marked_rounds.indexOf(planning) >= 0 ? 'checked' : '';
        markCell = '<label class="mark-toggle"><input type="checkbox" class="iv-toggle" data-c="' + esc(e.code) + '" ' + checked + '> לריאיון</label>';
      } else markCell = e.marked_rounds.length ? ('מסומן לסבב ' + e.marked_rounds.join(',')) : '<span style="color:var(--faint)">—</span>';

      // סטטוס: עשה / נותר / ריאיון
      var doneTxt = e.chapters_done.length ? e.chapters_done.join(', ') : '—';
      var remTxt = e.remaining_chapters.length ? e.remaining_chapters.join(', ') : '—';
      var ivTxt = e.interviewed ? '<span style="color:var(--ok)">התראיין ✓</span>' : '<span style="color:var(--warn)">טרם התראיין</span>';
      var status = '<div style="font-size:12px;line-height:1.7">' +
        '<div>עשה: ' + esc(doneTxt) + '</div>' +
        '<div>נותר: ' + esc(remTxt) + '</div>' +
        '<div>' + ivTxt + (e.finished ? ' · <span style="color:var(--ok)">סיים הכול</span>' : '') + '</div></div>';

      // עכשיו
      var now = '—';
      if (e.current) {
        if (e.current.kind === 'interview') now = '<span class="pill interview">בריאיון</span>';
        else if (e.current.status === 'done') now = '<span class="pill done">הגיש</span>';
        else now = '<span class="pill chapter">' + esc(e.current.subject || '') + (e.current.level ? ' · ' + e.current.level : '') + '</span>' + (e.current.not_comfortable ? ' <span title="לא בנוח" style="color:var(--warn)">⚑</span>' : '');
      } else if (!e.setup) now = '<span style="color:var(--faint)">ממתין לרישום</span>';

      var timeCell = (e.current && e.current.kind === 'chapter' && e.current.status !== 'done')
        ? '<span class="t-' + (e.timer.state || 'none') + ' pill mono">' + fmtTime(e.timer.remaining_sec) + '</span>' : '<span style="color:var(--faint)">—</span>';
      var flags = e.flags ? '<span class="stat"><span class="dot-flag"></span>' + e.flags + '</span>' : '<span style="color:var(--faint)">0</span>';

      var actions = '<div class="mini-actions">' +
        '<button data-a="add_time" data-c="' + esc(e.code) + '" title="הוסף 2 דקות">+2 דק׳</button>' +
        '<button data-a="pause" data-c="' + esc(e.code) + '" title="השהה טיימר">השהה</button>' +
        '<button data-a="resume" data-c="' + esc(e.code) + '" title="המשך טיימר">המשך</button>' +
        '<button data-a="reset_slot" data-c="' + esc(e.code) + '" title="התחל לו את המשבצת מחדש">אפס לו</button>' +
        '<button class="fin" data-a="finish" data-c="' + esc(e.code) + '" title="סיים לו את המשבצת עכשיו">סיים לו</button>' +
        '<button class="fin" data-a="remove" data-c="' + esc(e.code) + '" title="הסר נבחן">✕</button>' +
        '</div>';

      return '<tr><td>' + esc(e.name) + '</td><td>' + markCell + '</td><td>' + status + '</td><td>' + now + '</td><td>' + timeCell + '</td><td>' + flags + '</td><td>' + actions + '</td></tr>';
    }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--faint);padding:30px">אין נבחנים עדיין. הוסיפו בחלק "ניהול נבחנים".</td></tr>';

    var iv = S.examinees.filter(function (e) { return e.interviewed; }).length;
    document.getElementById('summary').innerHTML = S.examinees.length + ' נבחנים · התראיינו: ' + iv + ' · ממתינים לריאיון: ' + S.examinees.filter(function (e) { return e.needs_interview; }).length;

    tb.querySelectorAll('.iv-toggle').forEach(function (chk) {
      chk.onchange = function () {
        call('/examiner/mark-interview', 'POST', { code: chk.getAttribute('data-c'), round: planning, on: chk.checked })
          .then(function (r) { if (r && r.warn) { alert(r.warn); } refresh(); })
          .catch(function (e) { alert(e.message); refresh(); });
      };
    });
    tb.querySelectorAll('.mini-actions button').forEach(function (btn) {
      btn.onclick = function () {
        var action = btn.getAttribute('data-a'), code = btn.getAttribute('data-c');
        if (action === 'remove') {
          if (!confirm('להסיר את הנבחן? כל הנתונים שלו יימחקו.')) return;
          call('/examiner/remove-examinee', 'POST', { code: code }).then(refresh).catch(function (e) { alert(e.message); });
          return;
        }
        var payload = { code: code, action: action };
        if (action === 'add_time') payload.seconds = 120;
        call('/examiner/override', 'POST', payload).then(refresh).catch(function (e) { alert(e.message); });
      };
    });
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
    if (!name || !code) { box.innerHTML = '<div class="msg error">יש למלא שם וקוד.</div>'; return; }
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
    renderConsole(STATE); renderRoster(STATE); renderExamState();
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
