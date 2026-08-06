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
  var QLIST = null;    // רשימת השאלות (מצב «לפי שאלה»)
  var QONE = null;     // שאלה אחת + כל התשובות אליה
  var QFILTER = false; // «רק מה שדורש תשומת לב»
  var VIEW = 'home';   // איזה מסך מוצג — קובע למה מקשי החצים מנווטים
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
    // ⚠ גוף השגיאה נשמר על האובייקט (`body`) ולא נזרק — יש endpoints שמחזירים
    // דגלים משמעותיים עם השגיאה (למשל `demo_block` מ-run-ai).
    if (!res.ok) throw Object.assign(new Error((data && data.error) || 'שגיאה'), { status: res.status, body: data || {} }, data || {});
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
    VIEW = 'login';
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
    VIEW = 'home';
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

      '<div class="card">' +
      '<h2 class="section-title">ייבוא יום קודם מקובץ</h2>' +
      '<p class="hint-text">ליום שכבר לא נמצא בשרת — בחרו את קובץ ה-JSON שהורדתם באותו יום ' +
      '(«הורד את כל התשובות» במסך המנהל). הקובץ נכנס כמחזור בדיקה רגיל לכל דבר. ' +
      'ייבוא חוזר של אותו קובץ לא ייצור מחזור כפול.</p>' +
      '<div class="btn-row" style="margin-top:12px;align-items:center;flex-wrap:wrap">' +
      '<input id="imp-name" type="text" placeholder="שם היום (למשל: יום הערכה 2.8)" style="max-width:240px">' +
      '<input id="imp-file" type="file" accept=".json,application/json" style="max-width:280px">' +
      '<button class="btn" id="btn-import">ייבא</button></div>' +
      '<div id="imp-msg"></div></div>' +

      '<div class="card"><h2 class="section-title">מחזורי בדיקה</h2><div class="gr-cohort-list">' + list + '</div>' +
      (cohorts.length > 1 ? '<div class="btn-row" style="margin-top:14px">' +
        '<button class="btn ghost small" id="btn-merged">ייצא את כל הימים לקובץ אחד</button>' +
        '<span class="hint-text" style="margin:0;align-self:center">גיליון לכל יום + גיליון «הכול». הדירוג נשאר בתוך כל יום — המבחנים לא זהים בין הימים.</span>' +
        '</div>' : '') +
      '</div>' +

      (cohorts.length ? mondayCardHtml(cohorts) : '');

    wireTopbar();
    wireMonday();
    // ⚠ תמיד עם הגנת null — אלמנט חסר שובר את כל הרינדור (ראו CLAUDE.md)
    var bs = document.getElementById('btn-snap'); if (bs) bs.onclick = doSnapshot;
    var bi = document.getElementById('btn-import'); if (bi) bi.onclick = doImport;
    var bm = document.getElementById('btn-merged');
    if (bm) bm.onclick = function () {
      var ids = cohorts.map(function (c) { return c.id; }).join(',');
      downloadBlob('/examiner/grading/export-merged?cohorts=' + ids, 'ציונים-כל-הימים.xlsx')
        .catch(function (e) { alert(e.message); });
    };
    root.querySelectorAll('.open-cohort').forEach(function (b) { b.onclick = function () { openCohort(Number(b.getAttribute('data-id'))); }; });
    root.querySelectorAll('.del-cohort').forEach(function (b) { b.onclick = function () { deleteCohort(Number(b.getAttribute('data-id'))); }; });
  }
  // ================================================= ייצוא למאנדיי
  // הקושי בהדבקה לבורד קיים הוא יישור שורות. הפתרון: הבורד קובע את הסדר —
  // המשתמש מדביק את עמודת השם משם, ואנחנו מחזירים בדיוק אותן שורות באותו סדר.
  var MND = null;      // תוצאת ההתאמה האחרונה
  var mndText = '';    // מה שהודבק — נשמר כדי שרינדור לא ימחק אותו

  function mondayCardHtml(cohorts) {
    // ⚠ אותו שם בשני מחזורים (צילום כפול / מועמדת שהגיעה לשני ימים) לא משויך
    // אוטומטית — בצדק. הסינון כאן הוא הדרך לפתור את זה מראש.
    var picker = cohorts.length > 1
      ? '<div class="mnd-cohorts">' + cohorts.map(function (c) {
        return '<label class="mark-toggle"><input type="checkbox" class="mnd-coh" value="' + c.id + '" checked> ' + esc(c.name) + '</label>';
      }).join('') + '</div>'
      : '';
    return '<div class="card" id="monday-card">' +
      '<h2 class="section-title">ייצוא למאנדיי</h2>' +
      '<p class="hint-text">במאנדיי: סמנו את <b>עמודת השם</b> של כל השורות ← Copy. הדביקו כאן ולחצו «התאם». ' +
      'תקבלו את אותן שורות <b>בדיוק באותו סדר</b> עם ארבע עמודות הציון — לחצו «העתק» ובמאנדיי עמדו על התא הראשון ' +
      'של עמודת «ציון» ועשו Paste. שורה שלא הותאמה יוצאת ריקה, כדי שהיישור יישמר.</p>' +
      (picker ? '<p class="hint-text" style="margin-bottom:4px">באילו מחזורים לחפש:</p>' + picker : '') +
      '<textarea id="mnd-in" rows="5" placeholder="שם אחד בכל שורה — בדיוק כפי שהועתק מהבורד" ' +
      'style="width:100%;font-family:var(--mono);font-size:13px">' + esc(mndText) + '</textarea>' +
      '<div class="btn-row" style="margin-top:10px"><button class="btn" id="mnd-go">התאם</button>' +
      '<label class="mark-toggle"><input type="checkbox" id="mnd-head"> כלול שורת כותרת</label></div>' +
      '<div id="mnd-out"></div></div>';
  }

  function mndCohorts() {
    var boxes = document.querySelectorAll('.mnd-coh');
    if (!boxes.length) return null;   // מחזור יחיד — השרת ייקח את הכול
    var ids = [];
    boxes.forEach(function (b) { if (b.checked) ids.push(Number(b.value)); });
    return ids;
  }

  function wireMonday() {
    var ta = document.getElementById('mnd-in');
    if (ta) ta.oninput = function () { mndText = ta.value; };
    var go = document.getElementById('mnd-go'); if (go) go.onclick = doMondayMatch;
    var hd = document.getElementById('mnd-head'); if (hd) hd.onchange = renderMonday;
    if (MND) renderMonday();
  }

  async function doMondayMatch() {
    var ta = document.getElementById('mnd-in');
    var out = document.getElementById('mnd-out');
    if (!ta || !out) return;
    mndText = ta.value;
    var lines = mndText.split('\n');
    // גוזמים שורות ריקות *בסוף* בלבד — ריקה באמצע היא שורה אמיתית בבורד.
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) { out.innerHTML = '<div class="msg warn">הדביקו קודם את עמודת השם מהבורד.</div>'; return; }
    var ids = mndCohorts();
    if (ids && !ids.length) { out.innerHTML = '<div class="msg warn">בחרו לפחות מחזור אחד לחיפוש.</div>'; return; }
    out.innerHTML = '<div class="msg info">מתאים…</div>';
    try {
      var body = { names: lines };
      if (ids) body.cohorts = ids;
      MND = await call('/examiner/grading/monday-match', 'POST', body);
      MND.cohorts = ids;   // נשמר לשליפה לפי מפתח בבחירה ידנית
      renderMonday();
    } catch (e) { out.innerHTML = '<div class="msg error">' + esc(e.message) + '</div>'; }
  }

  // ערך לתא: מספר או מחרוזת ריקה. אף פעם לא «טרם נבדק» — עמודת Number תדחה.
  function mndCell(v) { return v == null ? '' : String(v); }
  function mndTsv() {
    if (!MND) return '';
    var head = document.getElementById('mnd-head');
    var lines = (head && head.checked) ? [MND.columns.join('\t')] : [];
    MND.rows.forEach(function (r) {
      var v = r.values || {};
      lines.push([mndCell(v.final), mndCell(v.ravMelel), mndCell(v.quant), mndCell(v.english)].join('\t'));
    });
    return lines.join('\n');
  }

  function renderMonday() {
    var out = document.getElementById('mnd-out'); if (!out || !MND) return;
    var rows = MND.rows.map(function (r) {
      var v = r.values || {};
      var right;
      if (r.blank) right = '<span style="color:var(--faint)">— שורה ריקה —</span>';
      else if (r.matched) {
        right = '<b style="color:var(--ok)">' + esc(r.matched.name) + '</b>' +
          (r.matched.day ? ' <span style="font-size:11px;color:var(--muted)">· ' + esc(r.matched.day) + '</span>' : '') +
          (r.pending ? ' <span class="pill" style="color:var(--warn)">עדיין בלי ציון</span>' : '');
      } else if (r.suggestions.length) {
        right = '<select class="mnd-pick" data-i="' + r.line + '"><option value="">— לא נמצא —</option>' +
          r.suggestions.map(function (s) {
            return '<option value="' + esc(s.key) + '">' + esc(s.name) + (s.day ? ' · ' + esc(s.day) : '') + ' — ' + esc(s.reason) + '</option>';
          }).join('') + '</select>';
      } else right = '<span style="color:var(--danger)">לא נמצא</span>';

      var cls = r.blank ? '' : (r.matched ? '' : ' style="background:rgba(251,92,107,0.07)"');
      return '<tr' + cls + '><td style="color:var(--faint);font-size:11px">' + r.line + '</td>' +
        '<td>' + esc(r.raw || '') + '</td><td>' + right + '</td>' +
        '<td class="gr-final">' + (v.final == null ? '—' : v.final) + '</td>' +
        '<td>' + (v.ravMelel == null ? '—' : v.ravMelel) + '</td>' +
        '<td>' + (v.quant == null ? '—' : v.quant) + '</td>' +
        '<td>' + (v.english == null ? '—' : v.english) + '</td></tr>';
    }).join('');

    var problems = MND.unmatched + MND.pending;
    out.innerHTML =
      '<div class="msg ' + (problems ? 'warn' : 'ok') + '" style="margin-top:12px">' +
      '<b>' + MND.matched + ' מתוך ' + (MND.total - MND.blank) + ' הותאמו</b>' +
      (MND.unmatched ? ' · ' + MND.unmatched + ' לא נמצאו' : '') +
      (MND.pending ? ' · ' + MND.pending + ' עדיין בלי ציון (ייצאו ריקים)' : '') +
      (MND.blank ? ' · ' + MND.blank + ' שורות ריקות' : '') + '</div>' +
      '<div style="overflow-x:auto;max-height:44vh;margin-top:10px"><table class="grid"><thead><tr>' +
      '<th>#</th><th>השם שהודבק</th><th>הותאם ל…</th><th>ציון</th><th>רב-מלל</th><th>כמותי</th><th>אנגלית</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="btn-row" style="margin-top:14px">' +
      '<button class="btn" id="mnd-copy">העתק ' + MND.rows.length + ' שורות × 4 עמודות</button>' +
      '<button class="btn ghost small" id="mnd-csv">הורד כ-CSV</button></div>' +
      '<div id="mnd-fallback"></div>';

    out.querySelectorAll('.mnd-pick').forEach(function (sel) {
      sel.onchange = function () {
        var row = MND.rows.find(function (r) { return r.line === Number(sel.getAttribute('data-i')); });
        if (!row) return;
        var pick = row.suggestions.find(function (s) { return s.key === sel.value; });
        row.matched = pick || null;
        // הערכים של ההצעה לא הגיעו מהשרת — מושכים אותם בהתאמה חוזרת לשם המדויק.
        if (pick) applyPick(row, pick); else { row.values = { final: null, ravMelel: null, quant: null, english: null }; renderMonday(); }
      };
    });
    var bc = document.getElementById('mnd-copy'); if (bc) bc.onclick = copyMonday;
    var bv = document.getElementById('mnd-csv'); if (bv) bv.onclick = downloadMondayCsv;
  }

  // בחירה ידנית מההצעות — שולפים לפי *מפתח*, לא לפי שם. חיפוש חוזר לפי השם
  // היה מחזיר שוב «מעורפל», כי זו בדיוק הסיבה שההצעה הופיעה מלכתחילה.
  async function applyPick(row, pick) {
    try {
      var kb = { keys: [pick.key] };
      if (MND.cohorts) kb.cohorts = MND.cohorts;
      var r = await call('/examiner/grading/monday-match', 'POST', kb);
      var got = r.values && r.values[pick.key];
      row.values = got ? { final: got.final, ravMelel: got.ravMelel, quant: got.quant, english: got.english }
        : { final: null, ravMelel: null, quant: null, english: null };
      row.pending = !!(got && got.pending);
    } catch (e) { row.values = { final: null, ravMelel: null, quant: null, english: null }; }
    MND.matched = MND.rows.filter(function (x) { return x.matched; }).length;
    MND.unmatched = MND.rows.filter(function (x) { return !x.blank && !x.matched; }).length;
    renderMonday();
  }

  async function copyMonday() {
    var txt = mndTsv();
    try {
      await navigator.clipboard.writeText(txt);
      toast('הועתק ✓ במאנדיי: עמדו על התא הראשון של «ציון» ועשו Paste');
    } catch (e) {
      // ⚠ clipboard זמין רק ב-HTTPS/localhost. נפילה חזרה: תיבה לבחירה ידנית.
      var fb = document.getElementById('mnd-fallback'); if (!fb) return;
      fb.innerHTML = '<p class="hint-text" style="margin-top:10px">ההעתקה האוטומטית נחסמה בדפדפן. סמנו את התוכן והעתיקו ידנית (Cmd+C):</p>' +
        '<textarea id="mnd-raw" rows="8" readonly style="width:100%;font-family:var(--mono);font-size:12px"></textarea>';
      var raw = document.getElementById('mnd-raw');
      raw.value = txt; raw.focus(); raw.select();
    }
  }

  function downloadMondayCsv() {
    // BOM כדי ש-Excel יזהה עברית ב-UTF-8.
    var csv = '﻿' + MND.columns.join(',') + '\n' + MND.rows.map(function (r) {
      var v = r.values || {};
      return [mndCell(v.final), mndCell(v.ravMelel), mndCell(v.quant), mndCell(v.english)].join(',');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'monday-scores.csv'; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
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
  // ייבוא קובץ JSON של יום קודם — נקרא בדפדפן ונשלח כגוף הבקשה.
  function doImport() {
    var box = document.getElementById('imp-msg');
    var fileEl = document.getElementById('imp-file');
    var nameEl = document.getElementById('imp-name');
    if (!box || !fileEl) return;
    var file = fileEl.files && fileEl.files[0];
    if (!file) { box.innerHTML = '<div class="msg warn">בחרו קובץ JSON קודם.</div>'; return; }
    var name = (nameEl && nameEl.value.trim()) || file.name.replace(/\.json$/i, '');
    box.innerHTML = '<div class="msg info">קורא את הקובץ…</div>';
    var reader = new FileReader();
    reader.onerror = function () { box.innerHTML = '<div class="msg error">לא ניתן לקרוא את הקובץ.</div>'; };
    reader.onload = async function () {
      var parsed;
      try { parsed = JSON.parse(reader.result); }
      catch (e) { box.innerHTML = '<div class="msg error">הקובץ אינו JSON תקין.</div>'; return; }
      box.innerHTML = '<div class="msg info">מייבא…</div>';
      try {
        var r = await call('/examiner/grading/import', 'POST', { name: name, day_label: name, data: parsed });
        var msg = r.reused
          ? 'הקובץ הזה כבר יובא — נפתח המחזור הקיים.'
          : ('יובאו ' + r.examinees + ' נבחנים, ' + r.answers + ' תשובות, ' + r.teachItems + ' תשובות רב-מלל לבדיקה.');
        var warn = '';
        if (r.skipped_chapters) {
          warn += '<div class="msg warn">⚑ דולגו תשובות בפרקים שאינם בבנק התוכן: ' +
            esc(Object.keys(r.skipped_chapters).join(', ')) + '. הנבחנים האלה ינוקדו על פחות חומר.</div>';
        }
        if (r.suspicious_names) {
          warn += '<div class="msg warn">⚑ נרשמו עם מספר במקום שם: ' + esc(r.suspicious_names.join(', ')) +
            '. אפשר לתקן את השם במסך הנבחן/ת לפני שמפיקים את הגיליון.</div>';
        }
        box.innerHTML = '<div class="msg ok">' + esc(msg) + '</div>' + warn;
        openCohort(r.cohort_id);
      } catch (e) { box.innerHTML = '<div class="msg error">' + esc(e.message) + '</div>'; }
    };
    reader.readAsText(file, 'utf-8');
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
    VIEW = 'cohort';
    var c = COHORT.cohort;
    var failedCount = COHORT.failed || 0;
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

    // ⚠ ציוני הדגמה שכבר נכתבו למסד — הכי חשוב שהמשתמש יראה את זה, כי הם
    // נראים בכל מסך כמו ציונים אמיתיים.
    var demoN = COHORT.demoItems || 0;
    var demoRow = demoN
      ? '<div class="msg error"><b>⚠ ' + demoN + ' ציונים במחזור הזה הם ציוני הדגמה</b> — הם חושבו לפי אורך התשובה בלבד, ' +
        'בלי מפתח API, ואינם משקפים את התוכן. הגדירו מפתח ולחצו «בדוק מחדש ציוני הדגמה».</div>'
      : '';

    root.innerHTML = topbar(c.name) +
      demoBanner(COHORT.demo) + demoRow +
      '<div class="card">' +
      '<div class="toolbar"><button class="btn ghost small" id="btn-back">◀ כל המחזורים</button>' +
      '<h2 class="section-title" style="margin:0">' + esc(c.name) + '</h2><span class="spacer"></span>' +
      '<button class="btn ghost small" id="btn-testkey">בדוק חיבור</button>' +
      '<button class="btn small" id="btn-runai">הרץ בדיקת AI</button>' +
      (demoN ? '<button class="btn danger small" id="btn-redemo">בדוק מחדש ' + demoN + ' ציוני הדגמה</button>' : '') +
      (failedCount ? '<button class="btn ghost small" id="btn-retry">נסה שוב את מה שנכשל (' + failedCount + ')</button>' : '') +
      '<button class="btn small" id="btn-byq">בדיקה לפי שאלה ▸</button>' +
      '<button class="btn small" id="btn-sheet">בנה גיליון ציונים</button>' +
      '<button class="btn ghost small" id="btn-refresh">רענן</button></div>' +
      '<div id="key-msg"></div>' +
      '<div id="ai-progress"></div>' +
      '<p class="hint-text">לפני הרצה מלאה לחצו «בדוק חיבור» — קריאה אחת זולה שמאמתת שהמפתח עובד. ' +
      '«הרץ בדיקת AI» בודק את כל תשובות הרב-מלל שטרם נבדקו, מקובצות לפי שאלה (עד 8 תשובות בקריאה), ' +
      'ואפשר לעצור ולהמשיך. אחר כך עברו על התשובות — «לפי שאלה» הוא המסלול המהיר.</p>' +
      '<div style="overflow-x:auto"><table class="grid"><thead><tr>' +
      '<th>שם</th><th>מקצועות</th><th>בדיקת AI</th><th>נבדקו</th><th>ציון סופי</th><th>תחום מוביל</th><th>סטטוס</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';

    wireTopbar();
    // ⚠ תמיד עם הגנת null — אלמנט חסר שובר את כל הרינדור (ראו CLAUDE.md)
    var bb = document.getElementById('btn-back'); if (bb) bb.onclick = loadHome;
    var br = document.getElementById('btn-refresh'); if (br) br.onclick = function () { openCohort(c.id); };
    var ba = document.getElementById('btn-runai'); if (ba) ba.onclick = function () { runAi(false); };
    var bt = document.getElementById('btn-testkey'); if (bt) bt.onclick = testKey;
    var bry = document.getElementById('btn-retry'); if (bry) bry.onclick = function () { runAi(true); };
    var brd = document.getElementById('btn-redemo');
    if (brd) brd.onclick = function () {
      if (!confirm('לבדוק מחדש ' + demoN + ' ציוני הדגמה מול המודל האמיתי? הציונים הקיימים יוחלפו.')) return;
      runAi(false, { only_demo: true });
    };
    var bsh = document.getElementById('btn-sheet'); if (bsh) bsh.onclick = function () { openSheet(c.id); };
    var bq = document.getElementById('btn-byq'); if (bq) bq.onclick = openQuestions;
    root.querySelectorAll('.open-rev').forEach(function (b) { b.onclick = function () { openReview(b.getAttribute('data-c')); }; });
    if (COHORT.job && COHORT.job.running) renderProgress(COHORT.job);
  }
  // בדיקת חיבור — קריאה אחת זולה. חשוב לפני הרצה על מאות תשובות.
  async function testKey() {
    var box = document.getElementById('key-msg'); if (!box) return;
    box.innerHTML = '<div class="msg info">בודק חיבור…</div>';
    try {
      var r = await call('/examiner/grading/test-key');
      var cls = r.ok ? 'ok' : (r.demo ? 'warn' : 'error');
      box.innerHTML = '<div class="msg ' + cls + '">' + esc(r.message) +
        (r.ok ? ' · עומק חשיבה: ' + esc(r.effort) : '') + '</div>';
    } catch (e) { box.innerHTML = '<div class="msg error">' + esc(e.message) + '</div>'; }
  }
  async function runAi(onlyFailed, opts) {
    var body = { cohort_id: COHORT.cohort.id, only_failed: !!onlyFailed };
    if (opts && opts.only_demo) body.only_demo = true;
    if (opts && opts.confirm_demo) body.confirm_demo = true;
    try {
      var r = await call('/examiner/grading/run-ai', 'POST', body);
      if (r.nothing) {
        alert(onlyFailed ? 'אין פריטים שנכשלו.' : (body.only_demo ? 'אין ציוני הדגמה לבדוק מחדש.' : 'הכול כבר נבדק.'));
        return;
      }
      startProgress(COHORT.cohort.id);
    } catch (e) {
      // ⚠ הרצה בלי מפתח נחסמת בשרת. רק אישור מפורש של המשתמש פותח אותה,
      // כדי שאף אחד לא יגלה בדיעבד שהציונים היו לפי אורך התשובה.
      if (e.demo_block) {
        if (!confirm('אין מפתח API.\n\nהרצה עכשיו תיתן ציוני הדגמה לפי אורך התשובה בלבד — לא לפי התוכן.\n' +
          'זה שימושי רק כדי להתנסות במסך. אפשר יהיה לבדוק מחדש אחרי שתגדירו מפתח.\n\nלהריץ בכל זאת?')) return;
        return runAi(onlyFailed, Object.assign({}, opts, { confirm_demo: true }));
      }
      alert(e.message);
    }
  }
  // ההתקדמות נמדדת בתשובות (מה שמעניין), ובסוגריים מספר הקריאות למודל.
  function renderProgress(p) {
    var box = document.getElementById('ai-progress'); if (!box) return;
    var done = (p.done || 0) + (p.failed || 0);
    var total = p.total || 0;
    var pct = total ? Math.round((done / total) * 100) : 0;
    var groups = p.groups ? ' · ' + (p.groupsDone || 0) + '/' + p.groups + ' קריאות למודל' : '';
    var failed = p.failed ? ' · <span style="color:var(--warn)">' + p.failed + ' נכשלו</span>' : '';
    box.innerHTML = '<div class="gr-progress"><div class="gr-progress-bar" style="width:' + pct + '%"></div>' +
      '<span class="gr-progress-txt">בודק… ' + done + '/' + total + ' תשובות (' + pct + '%)' + groups + failed + '</span></div>';
  }
  function startProgress(id) {
    stopProgress();
    progressTimer = setInterval(async function () {
      try {
        var p = await call('/examiner/grading/progress/' + id);
        renderProgress({ done: p.done, failed: p.failed, total: p.total,
          groups: p.job && p.job.groups, groupsDone: p.job && p.job.groupsDone });
        if (!p.running) { stopProgress(); openCohort(id); }
      } catch (e) { stopProgress(); }
    }, 900);
  }
  function stopProgress() { if (progressTimer) { clearInterval(progressTimer); progressTimer = null; } }

  // ================================================= בדיקה «לפי שאלה»
  // כל התשובות לאותה שאלה זו מתחת לזו. מהיר ועקבי יותר מנבחן-נבחן, כי העין
  // מכיילת את עצמה על אותה שאלה במקום לקפוץ בין מקצועות.

  async function openQuestions() {
    stopProgress();
    try { QLIST = await call('/examiner/grading/questions/' + COHORT.cohort.id); }
    catch (e) { if (e.status === 401) return renderLogin('פג תוקף.'); alert(e.message); return; }
    renderQuestions();
    window.scrollTo(0, 0);
  }
  function renderQuestions() {
    root.className = 'wrap';
    VIEW = 'questions';
    var qs = QLIST.questions || [];
    var totAnswers = qs.reduce(function (n, q) { return n + q.total; }, 0);
    var totAttn = qs.reduce(function (n, q) { return n + q.attention; }, 0);
    var totApproved = qs.reduce(function (n, q) { return n + q.approved; }, 0);

    var rows = qs.map(function (q) {
      var done = q.aiDone >= q.total;
      var prog = q.approved + '/' + q.total;
      return '<tr>' +
        '<td style="font-size:12px;color:var(--muted)">' + esc(q.subject) + (q.level ? ' · ' + esc(q.level) : '') +
        (q.archived ? ' <span class="pill" title="פרק שירד מהאוויר — נענה ביום קודם">ארכיון</span>' : '') + '</td>' +
        '<td style="max-width:520px">' + rmath(q.question.slice(0, 150)) + (q.question.length > 150 ? '…' : '') + '</td>' +
        '<td>' + q.total + '</td>' +
        '<td>' + (done ? '<span style="color:var(--ok)">נבדק</span>' : q.aiDone + '/' + q.total) + '</td>' +
        '<td>' + (q.approved >= q.total ? '<span class="pill done">הושלם ✓</span>' : prog) + '</td>' +
        '<td>' + (q.attention ? '<span style="color:var(--warn)">⚑ ' + q.attention + '</span>' : '—') + '</td>' +
        '<td><button class="btn ghost small open-q" data-ch="' + esc(q.chapter_id) + '" data-it="' + esc(q.item_id) + '">פתח</button></td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--faint);padding:24px">אין שאלות רב-מלל במחזור.</td></tr>';

    root.innerHTML = topbar(QLIST.cohort.name) +
      demoBanner(QLIST.demo) +
      '<div class="card">' +
      '<div class="toolbar"><button class="btn ghost small" id="q-back">◀ למחזור</button>' +
      '<h2 class="section-title" style="margin:0">בדיקה לפי שאלה</h2><span class="spacer"></span>' +
      '<span style="font-size:13px;color:var(--muted)">' + qs.length + ' שאלות · ' + totAnswers + ' תשובות · ' +
      totApproved + ' אושרו · <span style="color:var(--warn)">⚑ ' + totAttn + ' דורשות תשומת לב</span></span></div>' +
      '<p class="hint-text">בכל שאלה מוצגות כל התשובות אליה יחד, ממוינות לפי ציון ה-AI — כך רואים מיד אם הסולם עקבי. ' +
      'אפשר לאשר שאלה שלמה בלחיצה אחת, ולסנן רק את מה שדורש עין אנושית.</p>' +
      '<div style="overflow-x:auto"><table class="grid"><thead><tr>' +
      '<th>מקצוע</th><th>שאלה</th><th>תשובות</th><th>בדיקת AI</th><th>אושרו</th><th>דורש עין</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';

    wireTopbar();
    var b = document.getElementById('q-back'); if (b) b.onclick = function () { openCohort(COHORT.cohort.id); };
    root.querySelectorAll('.open-q').forEach(function (btn) {
      btn.onclick = function () { openQuestion(btn.getAttribute('data-ch'), btn.getAttribute('data-it')); };
    });
  }

  async function openQuestion(chapterId, itemId) {
    stopProgress();
    try {
      QONE = await call('/examiner/grading/question/' + COHORT.cohort.id + '/' +
        encodeURIComponent(chapterId) + '/' + encodeURIComponent(itemId));
    } catch (e) { if (e.status === 401) return renderLogin('פג תוקף.'); alert(e.message); return; }
    renderQuestion();
    window.scrollTo(0, 0);
  }

  // תיבת 4 המחוונים — משותפת לשני מצבי הבדיקה.
  function critBox(order, labels, axis, ai, human, attrs, locked) {
    return '<div class="crit-box">' + order.map(function (k) {
      var ax = axis[k] === 'content' ? 'content' : 'teach';
      var eff = (human && human[k] != null) ? human[k] : (ai && ai[k] != null ? ai[k] : null);
      var aiV = (ai && ai[k] != null) ? ai[k] : null;
      var edited = (human && human[k] != null && aiV != null && human[k] !== aiV);
      var pips = '';
      for (var v = 1; v <= 5; v++) {
        pips += '<span class="pip' + (v === eff ? ' on ' + ax : '') + (locked ? ' pip-locked' : '') + '"' +
          (locked ? '' : ' data-k="' + k + '" data-v="' + v + '" ' + attrs) + '>' + v + '</span>';
      }
      return '<div class="crit-row">' +
        '<span class="crit-chip ' + ax + '">' + (ax === 'content' ? 'תוכן' : 'הוראה') + '</span>' +
        '<span class="crit-label">' + esc(labels[k] || k) + (edited ? ' <span class="crit-ai">(AI: ' + aiV + ')</span>' : '') + '</span>' +
        '<span class="pips">' + pips + '</span></div>';
    }).join('') + '</div>';
  }

  function renderQuestion() {
    root.className = 'wrap';
    VIEW = 'question';
    var q = QONE.question, nav = QONE.nav;
    var order = QONE.criteriaOrder || ['accuracy', 'depth', 'diagnosis_fit', 'clarity'];
    var labels = QONE.criteria || {}, axis = QONE.axis || {};
    var shown = QFILTER ? QONE.answers.filter(function (a) { return a.needsAttention; }) : QONE.answers;
    var attnCount = QONE.answers.filter(function (a) { return a.needsAttention; }).length;
    var openCount = QONE.answers.filter(function (a) { return a.status !== 'approved' && a.aiStatus === 'done'; }).length;

    var cards = shown.map(function (a) {
      var approved = a.status === 'approved';
      var locked = approved || a.examineeLocked;
      var attrs = 'data-code="' + esc(a.code) + '"';
      var mcTag = '';
      if (a.mc) {
        mcTag = a.mc.dontKnow ? '<span class="dk-badge">לא יודע/ת ⚑</span>'
          : (a.mc.correct ? '<span class="gr-ok">רב-ברירה נכונה ✓</span>' : '<span class="gr-bad">רב-ברירה שגויה ✗</span>');
      }
      return '<div class="card gr-teach' + (approved ? ' gr-approved' : '') + '" style="margin-bottom:14px">' +
        '<div class="gr-ch-head" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
        '<b>' + esc(a.name) + '</b>' + mcTag +
        (a.needsAttention ? '<span class="pill" style="background:rgba(247,183,49,0.16);color:var(--warn)">⚑ דורש עין</span>' : '') +
        (approved ? '<span class="pill done">ננעל ✓</span>' : (a.status === 'edited' ? '<span class="pill chapter">נערך</span>' : '')) +
        (a.aiStatus === 'failed' ? '<span class="pill" style="background:rgba(251,92,107,0.14);color:var(--danger)">בדיקה נכשלה</span>' : '') +
        confPill(a.aiConfidence) +
        '<span class="spacer"></span>' +
        (locked ? '' : '<button class="btn small q-approve" ' + attrs + '>אשר ✓</button>') +
        (approved && !a.examineeLocked ? '<button class="btn ghost small q-unapprove" ' + attrs + '>פתח לעריכה</button>' : '') +
        '</div>' +
        '<div class="gr-answer"><div class="gr-answer-body">' +
        (a.dontKnow ? '<span class="dk-badge">— לא יודע/ת —</span>' : (esc(a.answer) || '<span style="color:var(--faint)">— ריק —</span>')) +
        '</div></div>' +
        (a.aiConclusion ? '<div class="gr-concl">מסקנת ה-AI: <b>' + esc(a.aiConclusion) + '</b></div>' : '') +
        (a.aiAttention ? '<div class="attn-strip"><b>על מה לשים לב:</b> ' + esc(a.aiAttention) + '</div>' : '') +
        critBox(order, labels, axis, a.ai, a.human, attrs, locked) +
        '</div>';
    }).join('') || '<div class="card"><p class="hint-text" style="margin:0">אין תשובות להצגה בסינון הזה.</p></div>';

    root.innerHTML =
      '<div class="exam-bar">' +
      '<button class="btn ghost small" id="q1-back">◀ לרשימת השאלות</button>' +
      '<button class="btn ghost small" id="q1-prev"' + (nav.prev ? '' : ' disabled') + '>הקודמת ▶</button>' +
      '<div class="who" style="margin-inline-start:0"><span class="title">' + esc(q.subject) +
      (q.level ? ' · ' + esc(q.level) : '') + '</span>' +
      '<span class="round-tag">' + nav.index + '/' + nav.count + '</span></div>' +
      '<span class="spacer"></span>' +
      '<span style="font-size:13px;color:var(--muted)">' + QONE.answers.length + ' תשובות' +
      (attnCount ? ' · <span style="color:var(--warn)">⚑ ' + attnCount + '</span>' : '') + '</span>' +
      '<button class="btn ghost small" id="q1-next"' + (nav.next ? '' : ' disabled') + '>◀ הבאה</button>' +
      '</div>' +

      '<div class="card">' +
      (q.source ? '<button class="btn ghost small" id="q1-src" style="padding:3px 10px">הצג את הקטע</button>' +
        '<div class="source-box" id="q1-srcbox" style="display:none;margin-top:10px">' +
        '<div class="src-label">הקטע שהוצג לנבחנים</div><div class="src-body">' + rmath(q.source) + '</div></div>' : '') +
      (q.mcText ? '<div class="gr-mc" style="margin-top:10px"><div class="gr-mc-q">שאלת הרב-ברירה המזווגת: ' + rmath(q.mcText) + '</div>' +
        (q.mcCorrectText ? '<div class="gr-mc-a" style="color:var(--faint)">התשובה הנכונה: ' + rmath(q.mcCorrectText) + '</div>' : '') + '</div>' : '') +
      '<div class="prompt" style="margin-top:12px;font-weight:600">' + rmath(q.text) + '</div>' +
      '<div class="toolbar" style="margin-top:14px">' +
      '<label style="display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer">' +
      '<input type="checkbox" id="q1-filter"' + (QFILTER ? ' checked' : '') + '> רק מה שדורש תשומת לב' +
      (attnCount ? ' (' + attnCount + ')' : '') + '</label>' +
      '<span class="spacer"></span>' +
      (openCount ? '<button class="btn small" id="q1-approve-all">אשר את כל מה שלא נגעתי בו (' + openCount + ')</button>' : '') +
      '</div></div>' +
      cards;

    var back = document.getElementById('q1-back'); if (back) back.onclick = openQuestions;
    var prev = document.getElementById('q1-prev'); if (prev && nav.prev) prev.onclick = function () { openQuestion(nav.prev.chapter_id, nav.prev.item_id); };
    var next = document.getElementById('q1-next'); if (next && nav.next) next.onclick = function () { openQuestion(nav.next.chapter_id, nav.next.item_id); };
    var src = document.getElementById('q1-src');
    if (src) src.onclick = function () { var s = document.getElementById('q1-srcbox'); if (s) s.style.display = s.style.display === 'none' ? 'block' : 'none'; };
    var flt = document.getElementById('q1-filter'); if (flt) flt.onclick = function () { QFILTER = flt.checked; renderQuestion(); };
    var apAll = document.getElementById('q1-approve-all'); if (apAll) apAll.onclick = approveAllInQuestion;

    root.querySelectorAll('.pip[data-k]').forEach(function (p) {
      p.onclick = function () {
        setScoreQ(p.getAttribute('data-code'), p.getAttribute('data-k'), Number(p.getAttribute('data-v')));
      };
    });
    root.querySelectorAll('.q-approve').forEach(function (b) { b.onclick = function () { approveQ(b.getAttribute('data-code'), true); }; });
    root.querySelectorAll('.q-unapprove').forEach(function (b) { b.onclick = function () { approveQ(b.getAttribute('data-code'), false); }; });
  }

  function findAnswer(code) {
    return (QONE.answers || []).find(function (a) { return a.code === code; }) || null;
  }
  async function setScoreQ(code, k, v) {
    var a = findAnswer(code); if (!a) return;
    var base = a.human || a.ai || {};
    var merged = {}; Object.keys(base).forEach(function (x) { merged[x] = base[x]; }); merged[k] = v;
    a.human = merged; a.status = 'edited';
    renderQuestion();
    var body = { cohort_id: COHORT.cohort.id, code: code, chapter_id: QONE.question.chapter_id, item_id: QONE.question.item_id, scores: {} };
    body.scores[k] = v;
    try { var r = await call('/examiner/grading/item', 'POST', body); a.status = r.status; }
    catch (e) { alert(e.message); }
  }
  async function approveQ(code, approve) {
    var a = findAnswer(code); if (!a) return;
    try {
      var r = await call('/examiner/grading/item', 'POST', {
        cohort_id: COHORT.cohort.id, code: code,
        chapter_id: QONE.question.chapter_id, item_id: QONE.question.item_id, approve: approve,
      });
      a.status = r.status;
      renderQuestion();
      if (approve) toast('אושר ✓');
    } catch (e) { alert(e.message); }
  }
  async function approveAllInQuestion() {
    if (!confirm('לאשר את ציוני ה-AI לכל התשובות בשאלה הזאת שעדיין לא נגעת בהן? (מה שערכת או אישרת ידנית לא ישתנה.)')) return;
    try {
      var r = await call('/examiner/grading/approve-bulk', 'POST', {
        cohort_id: COHORT.cohort.id, scope: 'question',
        chapter_id: QONE.question.chapter_id, item_id: QONE.question.item_id, only_untouched: true,
      });
      // ⚠ הודעה צפה ולא בתוך המסך — openQuestion מרנדר מחדש ומוחק כל תיבה פנימית.
      await openQuestion(QONE.question.chapter_id, QONE.question.item_id);
      toast('אושרו ' + r.approved + ' תשובות ✓');
    } catch (e) { alert(e.message); }
  }

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
    VIEW = 'review';
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
    var pendingCount = data.rows.filter(function (r) { return r.pending; }).length;
    var rows = data.rows.map(function (r, i) {
      // ⚠ ציון לא מוצג עד שתשובות הרב-מלל נוקדו — אחרת רק הרב-ברירה נספרה
      // וכולם נראים 5.0, כמו תוצאה אמיתית.
      var g = function (v) { return r.pending ? '<span style="color:var(--faint);font-size:11px">טרם נבדק</span>' : num(v); };
      return '<tr' + (r.include ? '' : ' style="opacity:.5"') + '>' +
        '<td><input type="checkbox" class="sh-inc" data-c="' + esc(r.code) + '"' + (r.include ? ' checked' : '') + '></td>' +
        '<td>' + (r.pending ? '·' : (r.rank || (i + 1))) + '</td>' +
        // שם ניתן לעריכה — נדרש למי שנרשם עם מספר טלפון במקום שם.
        '<td><b class="sh-name" contenteditable="true" spellcheck="false" data-c="' + esc(r.code) + '" title="לחצו כדי לתקן שם">' + esc(r.name) + '</b>' +
        (r.partial ? ' <span style="color:var(--warn);font-size:11px" title="מבחן חלקי">⚑</span>' : '') + '</td>' +
        '<td class="gr-final">' + g(r.final) + '</td>' +
        '<td>' + g(r.ravMelel) + '</td>' +
        '<td>' + (r.quant == null ? '—' : g(r.quant)) + '</td>' +
        '<td>' + (r.english == null ? '—' : g(r.english)) + '</td>' +
        '<td style="font-size:12px;color:var(--teal)">' + (r.pending || !r.bonus ? '—' : '+' + r.bonus.toFixed(2).replace(/0$/, '')) + '</td>' +
        '<td style="font-size:12px;color:var(--muted);max-width:200px">' + esc(r.subjectsLabel || '—') + '</td>' +
        '<td style="font-size:12px;color:var(--muted);max-width:220px">' + esc(r.recommendation || '') + '</td></tr>';
    }).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--faint);padding:20px">אין נתונים.</td></tr>';
    m.innerHTML = '<div class="modal-card" style="max-width:1040px">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px"><h2 style="margin:0;font-size:20px">גיליון ציונים — ' + esc(data.cohort.name) + '</h2><span style="flex:1"></span><button class="btn ghost small" id="sh-close">סגור</button></div>' +
      // ⚠ לפרט *למה* כל אחד תקוע — פריט שנכשל דורש ציון ידני, לא סבלנות.
      (pendingCount
        ? '<div class="msg warn"><b>' + pendingCount + ' נבחנים עדיין בלי ציון:</b><br>' +
          data.rows.filter(function (r) { return r.pending; }).slice(0, 8).map(function (r) {
            return '· ' + esc(r.name) + ' — ' + esc(r.pendingReason || 'תשובות הרב-מלל טרם נבדקו');
          }).join('<br>') +
          (pendingCount > 8 ? '<br>· ועוד ' + (pendingCount - 8) + '…' : '') + '</div>'
        : '') +
      '<p class="hint-text">הציון = רב-מלל + בונוס על המקצוע החזק. סמנו מי נכלל בגיליון. להכנסה למאנדיי — «ייצוא למאנדיי» במסך הראשי (מתאים את השורות לסדר של הבורד).</p>' +
      '<div style="overflow-x:auto;max-height:52vh;margin-top:10px"><table class="grid"><thead><tr>' +
      '<th>כלול</th><th>דרג</th><th>שם</th><th>ציון</th><th>רב-מלל</th><th>כמותי</th><th>אנגלית</th><th>בונוס</th><th>מקצועות</th><th>המלצה</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="btn-row" style="margin-top:16px"><button class="btn" id="sh-export">ייצא ל-Excel (monday)</button>' +
      '<button class="btn ghost small" id="sh-export-all">ייצא הכול (כולל לא-כלולים)</button></div></div>';
    document.getElementById('sh-close').onclick = function () { m.remove(); };
    document.getElementById('sh-export').onclick = function () { downloadBlob('/examiner/grading/export-sheet/' + data.cohort.id, 'grades-' + data.cohort.id + '.xlsx').catch(function (e) { alert(e.message); }); };
    document.getElementById('sh-export-all').onclick = function () { downloadBlob('/examiner/grading/export-sheet/' + data.cohort.id + '?all=1', 'grades-all-' + data.cohort.id + '.xlsx').catch(function (e) { alert(e.message); }); };
    m.querySelectorAll('.sh-name').forEach(function (nb) {
      var before = nb.textContent;
      nb.onblur = function () {
        var v = nb.textContent.trim();
        if (!v) { nb.textContent = before; return; }
        if (v === before) return;
        call('/examiner/grading/examinee-flags', 'POST', { cohort_id: data.cohort.id, code: nb.getAttribute('data-c'), name: v })
          .then(function () { before = v; toast('השם עודכן ✓'); })
          .catch(function (e) { nb.textContent = before; alert(e.message); });
      };
      // Enter מסיים עריכה במקום להוסיף שורה
      nb.onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); nb.blur(); } };
    });
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
    if (document.getElementById('sheet-modal')) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    // ⚠ החצים מנווטים לפי המסך שמוצג בפועל. בלי זה, חץ במסך «לפי שאלה» היה
    // קופץ לנבחן אחר לפי REV שנשאר מביקורת קודמת.
    if (VIEW === 'review' && REV) {
      if (e.key === 'ArrowLeft' && REV.nav.next) openReview(REV.nav.next);
      else if (e.key === 'ArrowRight' && REV.nav.prev) openReview(REV.nav.prev);
    } else if (VIEW === 'question' && QONE) {
      if (e.key === 'ArrowLeft' && QONE.nav.next) openQuestion(QONE.nav.next.chapter_id, QONE.nav.next.item_id);
      else if (e.key === 'ArrowRight' && QONE.nav.prev) openQuestion(QONE.nav.prev.chapter_id, QONE.nav.prev.item_id);
    }
  });

  return { enter: enter, leave: leave };
})();
