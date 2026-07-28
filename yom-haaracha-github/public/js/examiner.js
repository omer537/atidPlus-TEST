/* =========================================================================
   מסך המנהל (בוחן) — מודול משובץ באותו ממשק.
   נכנסים אליו מהכפתור "כניסת מנהל" בפינת מסך הנבחן, או מהכתובת /examiner.
   חושף window.AdminApp = { enter, leave }.
   ========================================================================= */
window.AdminApp = (function () {
  'use strict';

  var token = localStorage.getItem('yh_examiner_token') || null;
  var pollHandle = null;
  var root = document.getElementById('root');
  var availableSubjects = [];
  var addSubjects = [];

  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  async function call(path, method, body, raw) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['x-token'] = token;
    var res = await fetch('/api' + path, { method: method || 'GET', headers: headers, body: body ? JSON.stringify(body) : undefined });
    if (raw) return res;
    var data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw Object.assign(new Error((data && data.error) || 'שגיאה'), { status: res.status });
    return data;
  }

  function fmtTime(sec) {
    if (sec == null) return '--:--';
    var m = String(Math.floor(sec / 60)).padStart(2, '0'), s = String(sec % 60).padStart(2, '0');
    return m + ':' + s;
  }

  // ------------------------------------------------- כניסה
  function renderLogin(errMsg) {
    if (pollHandle) clearInterval(pollHandle);
    root.className = 'center-screen';
    root.innerHTML = '';
    root.appendChild(el(
      '<div class="card" style="max-width:400px;width:100%">' +
      '<div class="brand"><img class="logo" src="/img/logo.svg" alt="עתיד פלוס"><span class="wordmark">עתיד פלוס</span><span class="sub">מסך בוחן</span></div>' +
      '<h2>כניסת בוחן</h2><p class="lead">הזינו את סיסמת הבוחן.</p>' +
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
    var pw = document.getElementById('pw').value;
    try {
      var r = await call('/examiner/login', 'POST', { password: pw });
      token = r.token; localStorage.setItem('yh_examiner_token', token);
      start();
    } catch (e) { renderLogin('סיסמה שגויה.'); }
  }

  // ------------------------------------------------- מסך ראשי
  function renderShell() {
    root.className = 'wrap';
    root.innerHTML = '';
    root.appendChild(el(
      '<div>' +
      '<div class="exm-header">' +
      '<img class="logo" src="/img/logo.svg" alt="עתיד פלוס" style="height:42px">' +
      '<span class="wordmark" style="font-size:20px;font-weight:800">עתיד פלוס</span>' +
      '<span style="color:var(--muted);font-size:14px">· מסך בוחן</span>' +
      '<div class="spacer"></div>' +
      '<button class="btn ghost small" id="btn-health">תקינות בנק התוכן</button>' +
      '<button class="btn small" id="btn-excel" title="כל התשובות כקובץ אקסל — לצפייה ולשליחה">הורד תשובות (Excel)</button>' +
      '<button class="btn ghost small" id="btn-export" title="גיבוי JSON — לבדיקת ה-AI">JSON</button>' +
      '<button class="btn ghost small" id="btn-logout">יציאה</button></div>' +
      '<div id="ended-banner"></div>' +
      '<div class="card"><h2 class="section-title">שחרור קודי סבב</h2>' +
      '<p class="hint-text">לחיצה על סבב פותחת לכל הנבחנים בבת אחת את המשבצת הבאה שלהם (פרק או ריאיון). משחררים סבב אחד בכל פעם, לפי קצב היום.</p>' +
      '<div class="round-controls" id="rounds"></div>' +
      '<div class="global-controls">' +
      '<button class="btn ghost small" id="btn-pause">⏸ השהה את כולם</button>' +
      '<button class="btn ghost small" id="btn-resume">▶ המשך לכולם</button>' +
      '<button class="btn danger small" id="btn-end">סיים את המבחן</button></div>' +
      '<p class="hint-text">"השהה את כולם" עוצר את הטיימר לכל הנבחנים (למשל להפסקה) — "המשך" מחזיר. "סיים את המבחן" סוגר את המבחן לכולם לפני הזמן — להשתמש רק בסוף.</p>' +
      '<p class="hint-text" id="iv-dist"></p>' +
      '</div>' +
      // תכנון ריאיונות — קיבולת פר-סבב + מי משובץ (לפי שם)
      '<div class="card"><h2 class="section-title">תכנון ריאיונות</h2>' +
      '<p class="hint-text">הגדר/י לכל סבב כמה מראיינים יש (קיבולת), וראה/י לפי שם מי משובץ לכל סבב. את השיבוץ קובעים בעמודת "ריאיון בסבב" בטבלת הנבחנים למטה (מראש או בלייב). אם מספר המשובצים עובר את הקיבולת — יופיע סימון אדום.</p>' +
      '<div class="planner-grid" id="planner-rounds"></div>' +
      '<div class="btn-row" style="margin-top:12px"><button class="btn small" id="btn-balance">אזן אוטומטית (למי שאין סבב)</button>' +
      '<button class="btn ghost small" id="btn-balance-all">אזן הכל מחדש</button></div>' +
      '<p class="hint-text" id="planner-unassigned"></p></div>' +
      // ניהול נבחנים — פתיחת משתמשים מראש
      '<div class="card"><h2 class="section-title">ניהול נבחנים</h2>' +
      '<p class="hint-text">אפשר לפתוח לנבחנים משתמשים מראש. ביום עצמו הם ייכנסו עם השם והקוד שקבעת. אם לא תבחר להם מקצועות — הם יבחרו בעצמם בכניסה (מומלץ). זה גם המקום להוסיף כמה נבחנים כדי לבדוק את המערכת.</p>' +
      '<div style="display:flex;gap:24px;flex-wrap:wrap">' +
      '<div style="flex:1;min-width:280px">' +
      '<b>הוספת נבחן יחיד</b>' +
      '<label class="field" style="margin-top:10px"><span>שם</span><input id="add-name" type="text" autocomplete="off"></label>' +
      '<label class="field"><span>קוד אישי</span><input id="add-code" type="text" autocomplete="off"></label>' +
      '<label class="field"><span>סבב ריאיון</span><select id="add-iround"><option value="">אוטומטי (מאוזן)</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>' +
      '<label class="field"><span>מקצועות (לא חובה — אפשר להשאיר לנבחן)</span></label>' +
      '<div class="chips" id="add-subjects" style="margin-bottom:10px"></div>' +
      '<button class="btn small" id="add-one">הוסף נבחן</button>' +
      '</div>' +
      '<div style="flex:1;min-width:280px">' +
      '<b>הוספת רשימה שלמה</b>' +
      '<p class="hint-text">שורה לכל נבחן: <span style="font-family:var(--mono)">שם, קוד</span> — ואפשר להוסיף סבב ריאיון (אופציונלי): <span style="font-family:var(--mono)">שם, קוד, סבב</span></p>' +
      '<textarea id="bulk-text" placeholder="דנה כהן, 1234, 2&#10;יוסי לוי, 5678&#10;..." style="min-height:150px"></textarea>' +
      '<button class="btn small" id="add-bulk" style="margin-top:8px">הוסף את הרשימה</button>' +
      '</div>' +
      '</div><div id="add-msg" style="margin-top:12px"></div></div>' +
      // גיבוי ושחזור
      '<div class="card"><h2 class="section-title">גיבוי ושחזור</h2>' +
      '<p class="hint-text">המערכת מגבה את כל הנתונים <b>אוטומטית כל 5 דקות</b> — גם כשהיא רצה בשרת (הגיבויים נשמרים על הדיסק הקבוע). כל גיבוי כולל קובץ JSON קריא ועותק מלא של בסיס הנתונים לשחזור מהיר. כאן אפשר לגבות עכשיו ולהוריד גיבוי אל המחשב שלך.</p>' +
      '<div class="btn-row"><button class="btn small" id="btn-backup-now">גבה עכשיו</button></div>' +
      '<div id="backup-list" class="health-list" style="margin-top:12px"></div></div>' +
      '<div id="health"></div>' +
      '<div class="card" style="margin-top:20px"><div class="toolbar"><h2 class="section-title">סטטוס נבחנים</h2>' +
      '<span class="spacer"></span><span id="summary" class="health-list"></span></div>' +
      '<p class="hint-text">כאן רואים בזמן אמת איפה כל נבחן, כמה זמן נותר, כמה תשובות שמר, והתראות (מעבר טאב או ניסיון הדבקה). הכפתורים הקטנים בשורה הם עקיפות לאותו נבחן בלבד: +2ד׳ · השהה · המשך · אפס · סיים.</p>' +
      '<div style="overflow-x:auto"><table class="grid" id="tbl"><thead><tr>' +
      '<th>שם</th><th>מקצועות</th><th>ריאיון בסבב</th><th>סבב נוכחי</th><th>זמן</th><th>תשובות</th><th>התראות</th><th>עקיפות</th>' +
      '</tr></thead><tbody id="tbody"></tbody></table></div></div>' +
      '</div>'
    ));
    document.getElementById('btn-export').onclick = downloadExport;
    document.getElementById('btn-excel').onclick = downloadExcel;
    document.getElementById('btn-health').onclick = toggleHealth;
    document.getElementById('btn-logout').onclick = function () { localStorage.removeItem('yh_examiner_token'); token = null; if (pollHandle) clearInterval(pollHandle); leave(); };
    document.getElementById('btn-pause').onclick = function () { pauseAll(true); };
    document.getElementById('btn-resume').onclick = function () { pauseAll(false); };
    document.getElementById('btn-end').onclick = endExam;
    document.getElementById('add-one').onclick = addOne;
    document.getElementById('add-bulk').onclick = addBulk;
    document.getElementById('btn-backup-now').onclick = backupNow;
    document.getElementById('btn-balance').onclick = function () { balanceInterviews('unassigned'); };
    document.getElementById('btn-balance-all').onclick = function () {
      if (confirm('לאזן מחדש את כל שיבוצי הריאיון? זה יחליף שיבוצים ידניים קיימים.')) balanceInterviews('all');
    };
    renderAddSubjects();
  }

  function renderPlanner(data) {
    var box = document.getElementById('planner-rounds');
    if (!box) return;
    // לא לרנדר מחדש בזמן שמקלידים בשדה קיבולת (כדי לא לאבד הקלדה)
    if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('cap')) return;
    var caps = data.interview_caps || [];
    var byRound = {};
    for (var r = 1; r <= data.total_rounds; r++) byRound[r] = [];
    data.examinees.forEach(function (ex) { if (ex.interview_round) (byRound[ex.interview_round] = byRound[ex.interview_round] || []).push(ex); });
    var cards = '';
    for (var n = 1; n <= data.total_rounds; n++) {
      var cap = caps[n - 1] !== undefined ? caps[n - 1] : 8;
      var list = byRound[n] || [];
      var over = list.length > cap;
      var names = list.length
        ? list.map(function (ex) { return '<span class="chip-name" title="קוד ' + esc(ex.code) + '">' + esc(ex.name) + '</span>'; }).join('')
        : '<span style="color:var(--faint)">— אין —</span>';
      cards += '<div class="round-plan' + (over ? ' over' : '') + '">' +
        '<div class="rp-head">סבב ' + n + '</div>' +
        '<div class="rp-cap">קיבולת: <input type="number" class="cap" data-r="' + n + '" min="0" value="' + cap + '"></div>' +
        '<div class="rp-count' + (over ? ' over' : '') + '">' + list.length + ' / ' + cap + (over ? '  ⚠ חריגה' : '') + '</div>' +
        '<div class="rp-names">' + names + '</div></div>';
    }
    box.innerHTML = cards;
    box.querySelectorAll('input.cap').forEach(function (inp) { inp.onchange = saveCaps; });
    var unassigned = data.examinees.filter(function (ex) { return !ex.interview_round; }).length;
    var u = document.getElementById('planner-unassigned');
    if (u) u.innerHTML = unassigned
      ? '⚠ ' + unassigned + ' נבחנים ללא שיבוץ ריאיון — שבצ/י אותם בטבלה למטה, או לחצ/י "אזן אוטומטית".'
      : 'כל הנבחנים משובצים לריאיון.';
  }

  function saveCaps() {
    var caps = [];
    document.querySelectorAll('#planner-rounds input.cap').forEach(function (inp) {
      caps[Number(inp.getAttribute('data-r')) - 1] = Math.max(0, Number(inp.value) || 0);
    });
    call('/examiner/set-interview-caps', 'POST', { caps: caps }).then(renderStatus).catch(function (e) { alert(e.message); });
  }

  async function balanceInterviews(mode) {
    try { var r = await call('/examiner/balance-interviews', 'POST', { mode: mode }); alert('שובצו ' + r.assigned + ' נבחנים.'); renderStatus(); }
    catch (e) { alert(e.message); }
  }

  function fmtBytes(n) { return n < 1024 ? n + ' ב׳' : (n / 1024).toFixed(1) + ' KB'; }
  function fmtWhen(ms) { try { return new Date(ms).toLocaleString('he-IL'); } catch (e) { return ''; } }

  async function loadBackups() {
    var box = document.getElementById('backup-list');
    if (!box) return;
    try {
      var r = await call('/examiner/backups');
      if (!r.files.length) { box.innerHTML = 'עדיין אין גיבויים. הגיבוי האוטומטי הראשון ייווצר תוך דקות, או לחצ/י "גבה עכשיו".'; return; }
      var rows = r.files.slice(0, 12).map(function (f) {
        var kind = f.name.indexOf('snapshot') === 0 ? 'עותק DB' : 'JSON';
        return '<div style="display:flex;align-items:center;gap:10px;padding:4px 0">' +
          '<button class="mini-actions" style="border:1px solid var(--border);background:rgba(8,14,36,.5);color:var(--muted);border-radius:8px;padding:3px 10px;cursor:pointer" data-bk="' + esc(f.name) + '">הורד</button>' +
          '<span style="color:var(--faint)">' + kind + ' · ' + fmtBytes(f.size) + ' · ' + fmtWhen(f.at) + '</span></div>';
      }).join('');
      box.innerHTML = '<div style="margin-bottom:6px;color:var(--muted)">גיבוי אחרון: ' + fmtWhen(r.files[0].at) + ' · גיבוי כל ' + r.interval_min + ' דק׳</div>' + rows;
      box.querySelectorAll('button[data-bk]').forEach(function (b) {
        b.onclick = function () { downloadBackup(b.getAttribute('data-bk')); };
      });
    } catch (e) { box.innerHTML = '<span class="bad">שגיאה בטעינת הגיבויים.</span>'; }
  }

  async function backupNow() {
    try { var r = await call('/examiner/backup-now', 'POST'); if (!r.ok) throw new Error(r.error || 'נכשל'); loadBackups(); }
    catch (e) { alert('הגיבוי נכשל: ' + e.message); }
  }

  async function downloadBackup(name) {
    try {
      var res = await call('/examiner/backup/' + encodeURIComponent(name), 'GET', null, true);
      if (!res.ok) throw new Error('הורדה נכשלה');
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { alert(e.message); }
  }

  function renderAddSubjects() {
    var box = document.getElementById('add-subjects');
    if (!box) return;
    box.innerHTML = availableSubjects.map(function (s) {
      var i = addSubjects.indexOf(s), sel = i >= 0;
      return '<div class="chip ' + (sel ? 'selected' : '') + '" data-s="' + esc(s) + '">' + esc(s) + (sel ? ' <span class="order">#' + (i + 1) + '</span>' : '') + '</div>';
    }).join('');
    box.querySelectorAll('.chip').forEach(function (c) {
      c.onclick = function () {
        var s = c.getAttribute('data-s'), i = addSubjects.indexOf(s);
        if (i >= 0) addSubjects.splice(i, 1);
        else { if (addSubjects.length >= 4) return; addSubjects.push(s); }
        renderAddSubjects();
      };
    });
  }

  async function addOne() {
    var name = document.getElementById('add-name').value.trim();
    var code = document.getElementById('add-code').value.trim();
    var iround = document.getElementById('add-iround').value;
    var box = document.getElementById('add-msg');
    if (!name || !code) { box.innerHTML = '<div class="msg error">יש למלא שם וקוד.</div>'; return; }
    try {
      await call('/examiner/add-examinee', 'POST', {
        name: name, code: code,
        subjects: addSubjects.slice(),
        interview_round: iround || undefined,
      });
      box.innerHTML = '<div class="msg info">נוסף: ' + esc(name) + ' (קוד ' + esc(code) + ').</div>';
      document.getElementById('add-name').value = ''; document.getElementById('add-code').value = '';
      document.getElementById('add-iround').value = ''; addSubjects = []; renderAddSubjects();
      renderStatus();
    } catch (e) { box.innerHTML = '<div class="msg error">' + esc(e.message) + '</div>'; }
  }

  async function addBulk() {
    var text = document.getElementById('bulk-text').value;
    var box = document.getElementById('add-msg');
    if (!text.trim()) { box.innerHTML = '<div class="msg error">הרשימה ריקה.</div>'; return; }
    try {
      var r = await call('/examiner/add-examinees-bulk', 'POST', { text: text });
      var msg = 'נוספו ' + r.added + ' נבחנים.';
      if (r.skipped && r.skipped.length) msg += ' דילג על ' + r.skipped.length + ': ' + esc(r.skipped.join(' · '));
      box.innerHTML = '<div class="msg ' + (r.added ? 'info' : 'warn') + '">' + msg + '</div>';
      document.getElementById('bulk-text').value = '';
      renderStatus();
    } catch (e) { box.innerHTML = '<div class="msg error">' + esc(e.message) + '</div>'; }
  }

  async function pauseAll(pause) {
    if (pause && !confirm('להשהות את הטיימר לכל הנבחנים?')) return;
    try { const r = await call('/examiner/pause-all', 'POST', { pause: pause }); alert((pause ? 'הושהו ' : 'הומשכו ') + r.affected + ' נבחנים.'); renderStatus(); }
    catch (e) { alert(e.message); }
  }
  async function endExam() {
    if (!confirm('לסיים את המבחן לכל הנבחנים? כולם יעברו מיד למסך "המבחן הסתיים". פעולה זו נועדה לסוף היום.')) return;
    try { await call('/examiner/end-exam', 'POST', { ended: true }); renderExamState(); renderStatus(); }
    catch (e) { alert(e.message); }
  }
  async function reopenExam() {
    if (!confirm('להחזיר את המבחן לפעילות?')) return;
    try { await call('/examiner/end-exam', 'POST', { ended: false }); renderExamState(); }
    catch (e) { alert(e.message); }
  }
  async function renderExamState() {
    const box = document.getElementById('ended-banner');
    if (!box) return;
    try {
      const s = await call('/examiner/exam-state');
      if (s.ended) {
        box.innerHTML = '';
        box.appendChild(el('<div class="msg warn" style="display:flex;align-items:center;gap:12px">' +
          '<span>המבחן במצב "הסתיים" — כל הנבחנים רואים מסך סיום.</span>' +
          '<button class="btn ghost small" id="btn-reopen">החזר לפעילות</button></div>'));
        document.getElementById('btn-reopen').onclick = reopenExam;
      } else { box.innerHTML = ''; }
    } catch (e) {}
  }

  async function renderRounds() {
    var data;
    try { data = await call('/examiner/rounds'); } catch (e) { if (e.status === 401) return renderLogin('פג תוקף. התחבר/י מחדש.'); return; }
    var box = document.getElementById('rounds');
    if (!box) return;
    box.innerHTML = data.rounds.map(function (r) {
      return '<button class="round-btn ' + (r.released ? 'released' : '') + '" data-round="' + r.round + '">' +
        'סבב ' + r.round + '<small>' + (r.released ? 'שוחרר ✓' : 'לא שוחרר') + '</small></button>';
    }).join('');
    box.querySelectorAll('.round-btn').forEach(function (b) {
      b.onclick = function () {
        var round = Number(b.getAttribute('data-round'));
        if (b.classList.contains('released')) return;
        if (!confirm('לשחרר את קוד סבב ' + round + ' לכל הנבחנים?')) return;
        call('/examiner/release-round', 'POST', { round: round }).then(renderRounds).catch(function (e) { alert(e.message); });
      };
    });
  }

  async function renderStatus() {
    var data;
    try { data = await call('/examiner/status'); } catch (e) { if (e.status === 401) return renderLogin('פג תוקף. התחבר/י מחדש.'); return; }
    var tb = document.getElementById('tbody'); if (!tb) return;
    var stuck = 0;
    tb.innerHTML = data.examinees.map(function (ex) {
      var cur = ex.current;
      var curCell = '—';
      var done = cur && cur.status === 'done';
      if (cur) {
        if (cur.kind === 'interview') curCell = '<span class="pill interview">ריאיון</span>';
        else if (done) curCell = '<span class="pill done">הוגש</span>';
        else curCell = '<span class="pill chapter">' + esc(cur.subject || '') + (cur.level ? ' · ' + cur.level : '') + '</span>' +
          (cur.not_comfortable ? ' <span title="סימן לא בנוח" style="color:var(--warn)">⚑</span>' : '');
      }
      var tcls = 't-' + (ex.timer.state || 'none');
      var timeCell = done ? '<span style="color:var(--faint)">—</span>' : '<span class="' + tcls + ' pill mono">' + fmtTime(ex.timer.remaining_sec) + '</span>';
      if (ex.timer.state === 'expired') stuck++;
      var flags = ex.flags ? '<span class="stat"><span class="dot-flag"></span>' + ex.flags + '</span>' : '<span style="color:var(--faint)">0</span>';
      var ivSel = '<select class="iround" data-c="' + esc(ex.code) + '">' +
        [1, 2, 3, 4, 5].map(function (n) { return '<option value="' + n + '"' + (ex.interview_round === n ? ' selected' : '') + '>סבב ' + n + '</option>'; }).join('') +
        '</select>';
      var actions = '<div class="mini-actions">' +
        '<button data-a="add_time" data-c="' + esc(ex.code) + '" title="הוסף 2 דקות">+2ד׳</button>' +
        '<button data-a="pause" data-c="' + esc(ex.code) + '" title="השהה">⏸</button>' +
        '<button data-a="resume" data-c="' + esc(ex.code) + '" title="המשך">▶</button>' +
        '<button data-a="reset_slot" data-c="' + esc(ex.code) + '" title="אפס משבצת (טיימר מחדש)">↺</button>' +
        '<button class="fin" data-a="finish" data-c="' + esc(ex.code) + '" title="סיים לנבחן זה עכשיו">סיים</button>' +
        '<button class="fin" data-a="remove" data-c="' + esc(ex.code) + '" title="הסר נבחן">✕</button>' +
        '</div>';
      return '<tr><td>' + esc(ex.name) + '</td>' +
        '<td style="color:var(--muted);font-size:13px">' + esc((ex.subjects || []).join(', ')) + '</td>' +
        '<td>' + ivSel + '</td>' +
        '<td>' + curCell + '</td><td>' + timeCell + '</td>' +
        '<td>' + ex.answered + '</td><td>' + flags + '</td><td>' + actions + '</td></tr>';
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--faint);padding:30px">אין נבחנים רשומים עדיין. אפשר להוסיף נבחנים בחלק "ניהול נבחנים" למעלה.</td></tr>';

    document.getElementById('summary').innerHTML =
      data.examinees.length + ' נבחנים · סבב אחרון ששוחרר: ' + (data.latest_released || '—') + ' מתוך ' + data.total_rounds;

    // פיזור סבבי הריאיון לפי הקיבולות בפועל
    var caps = data.interview_caps || [];
    var dist = {};
    for (var n = 1; n <= data.total_rounds; n++) dist[n] = 0;
    data.examinees.forEach(function (ex) { if (ex.interview_round) dist[ex.interview_round]++; });
    var distEl = document.getElementById('iv-dist');
    if (distEl) distEl.innerHTML = 'ריאיונות: ' + Object.keys(dist).map(function (k) {
      var cap = caps[k - 1] !== undefined ? caps[k - 1] : 8;
      var over = dist[k] > cap;
      return 'סבב ' + k + ' <b' + (over ? ' style="color:var(--danger)"' : '') + '>' + dist[k] + '/' + cap + (over ? ' ⚠' : '') + '</b>';
    }).join(' · ');

    // פאנל תכנון הריאיונות
    renderPlanner(data);

    tb.querySelectorAll('.mini-actions button').forEach(function (b) {
      b.onclick = function () {
        var action = b.getAttribute('data-a'), code = b.getAttribute('data-c');
        if (action === 'remove') {
          if (!confirm('להסיר את הנבחן הזה? כל התשובות שלו יימחקו.')) return;
          call('/examiner/remove-examinee', 'POST', { code: code }).then(renderStatus).catch(function (e) { alert(e.message); });
          return;
        }
        var payload = { code: code, action: action };
        if (action === 'add_time') payload.seconds = 120;
        call('/examiner/override', 'POST', payload).then(renderStatus).catch(function (e) { alert(e.message); });
      };
    });
    tb.querySelectorAll('select.iround').forEach(function (sel) {
      sel.onchange = function () {
        call('/examiner/set-interview-round', 'POST', { code: sel.getAttribute('data-c'), round: Number(sel.value) })
          .then(function (r) {
            if (r && r.over) alert('שים לב: בסבב ' + r.round + ' יש כעת ' + r.count + ' ריאיונות מול קיבולת של ' + r.cap + ' מראיינים. השינוי נשמר, אך יש חריגה.');
            renderStatus();
          }).catch(function (e) { alert(e.message); });
      };
    });
  }

  async function downloadExcel() {
    try {
      var res = await call('/examiner/export-excel', 'GET', null, true);
      if (!res.ok) throw new Error('הורדה נכשלה');
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'assessment-answers.xlsx'; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { alert(e.message); }
  }

  async function downloadExport() {
    try {
      var res = await call('/examiner/export-all', 'GET', null, true);
      if (!res.ok) throw new Error('הורדה נכשלה');
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'assessment-answers.json'; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { alert(e.message); }
  }

  var healthShown = false;
  async function toggleHealth() {
    var box = document.getElementById('health');
    if (healthShown) { box.innerHTML = ''; healthShown = false; return; }
    healthShown = true;
    try {
      var h = await call('/examiner/content-health');
      var rows = h.chapters.map(function (c) {
        return '<div>' + (c.valid ? '<span class="ok">✓</span> ' : '<span class="bad">✗</span> ') +
          esc(c.chapter_id) + ' <span style="color:var(--faint)">(' + esc(c.subject) + ')</span></div>';
      }).join('');
      var probs = (h.problems || []).filter(function (p) { return p.level === 'error'; });
      box.innerHTML = '';
      box.appendChild(el('<div class="card" style="margin-top:20px"><h2 style="font-size:16px">תקינות בנק התוכן</h2>' +
        '<p class="lead">מקצועות זמינים: ' + esc(h.subjects.join(', ')) + '</p>' +
        '<div class="health-list">' + rows + '</div>' +
        (probs.length ? '<div class="msg error" style="margin-top:14px">' + probs.length + ' בעיות שמונעות עלייה לאוויר. הרץ במסוף: npm run check-content</div>'
          : '<div class="msg info" style="margin-top:14px">כל הפרקים תקינים.</div>') + '</div>'));
    } catch (e) { box.innerHTML = '<div class="msg error">' + esc(e.message) + '</div>'; }
  }

  async function start() {
    try { availableSubjects = (await call('/subjects')).subjects || []; } catch (e) { availableSubjects = []; }
    renderShell();
    renderRounds();
    renderStatus();
    renderExamState();
    loadBackups();
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = setInterval(function () { renderStatus(); }, 3000);
  }

  // אתחול
  async function enter() {
    if (token) {
      try { await call('/examiner/rounds'); start(); return; } catch (e) { token = null; localStorage.removeItem('yh_examiner_token'); }
    }
    renderLogin();
  }
  function leave() {
    if (pollHandle) clearInterval(pollHandle);
    if (typeof window.__showExamineeLogin === 'function') window.__showExamineeLogin();
    else location.href = '/';
  }
  return { enter: enter, leave: leave };
})();
