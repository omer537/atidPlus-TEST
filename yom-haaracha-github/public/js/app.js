/* =========================================================================
   אפליקציית הנבחן — מכונת מצבים: רישום → הצהרה → בחירת נושאים → מבחן.
   כל תשובה נשמרת אוטומטית. הטיימר מסתנכרן מהשרת בכל polling.
   ========================================================================= */
(function () {
  'use strict';

  var API = {
    async call(path, method, body) {
      var headers = { 'Content-Type': 'application/json' };
      if (App.token) headers['x-token'] = App.token;
      var res = await fetch('/api' + path, {
        method: method || 'GET',
        headers: headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      var data = null;
      try { data = await res.json(); } catch (e) {}
      if (!res.ok) throw Object.assign(new Error((data && data.error) || 'שגיאת שרת'), { status: res.status, data: data });
      return data;
    },
  };

  var App = {
    token: localStorage.getItem('yh_token') || null,
    view: 'login',
    subjectsAvailable: [],
    reg: { name: '', code: '', declaration: {}, subjects: [], math_level: '5' },
    state: null,
    renderedKey: null,
    timer: { state: 'none', remaining: 0, syncAt: 0 },
    itemStart: {},
    saveTimers: {},
    pollHandle: null,
    tickHandle: null,
  };
  window.App = App;

  var root = document.getElementById('root');
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var BRAND = '<div class="brand"><img class="logo" src="/img/logo.svg" alt="עתיד פלוס"><span class="wordmark">עתיד פלוס</span><span class="sub">יום הערכה</span></div>';

  // ---------------------------------------------------------------- אתחול
  async function init() {
    try {
      var subj = await API.call('/subjects');
      App.subjectsAvailable = (subj && subj.subjects) || [];
    } catch (e) { App.subjectsAvailable = []; }

    if (App.token) {
      try {
        App.state = await API.call('/state');
        App.view = 'exam';
        startLoops();
      } catch (e) {
        localStorage.removeItem('yh_token'); App.token = null; App.view = 'login';
      }
    }
    render();
  }

  // ---------------------------------------------------------------- ניתוב תצוגה
  function render() {
    if (App.view === 'login') return renderLogin();
    if (App.view === 'declaration') return renderDeclaration();
    if (App.view === 'subjects') return renderSubjects();
    if (App.view === 'exam') return renderExam();
  }

  // ---------------------------------------------------------------- מסך כניסה
  function renderLogin() {
    root.innerHTML = '';
    root.className = 'center-screen';
    var card = el(
      '<div class="card" style="max-width:440px;width:100%">' + BRAND +
      '<h2>ברוכים הבאים</h2>' +
      '<p class="lead">הזינו שם מלא וקוד אישי כדי להתחיל. אם כבר התחלתם והתנתקתם — הזינו שוב <b>אותו שם ואותו קוד</b>, ותחזרו בדיוק לאותה נקודה.</p>' +
      '<div id="err"></div>' +
      '<label class="field"><span>שם מלא</span><input id="name" type="text" autocomplete="off" placeholder="ישראל ישראלי"></label>' +
      '<label class="field"><span>קוד אישי</span><input id="code" type="text" autocomplete="off" placeholder="לדוגמה: 4821"></label>' +
      '<div class="btn-row"><button class="btn" id="go">כניסה / התחלה</button></div>' +
      '<p class="hint-text">הקוד האישי הוא סיסמה שאתם בוחרים עכשיו וזוכרים. הוא משמש לשחזור אם תתנתקו או תצאו לריאיון.</p>' +
      '</div>'
    );
    root.appendChild(card);
    // כניסת מנהל — פינה עליונה
    var adminBtn = el('<button class="btn ghost small" id="admin-entry" style="position:fixed;top:16px;inset-inline-start:16px;z-index:50">כניסת מנהל</button>');
    root.appendChild(adminBtn);
    adminBtn.onclick = function () { if (window.AdminApp) window.AdminApp.enter(); };
    document.getElementById('go').onclick = onLogin;
    document.getElementById('code').addEventListener('keydown', function (e) { if (e.key === 'Enter') onLogin(); });
  }

  // מאפשר למודול המנהל לחזור למסך הנבחן
  window.__showExamineeLogin = function () {
    App.token = localStorage.getItem('yh_token') || null;
    App.state = null; App.renderedKey = null; App.completingSetup = false;
    stopLoops();
    App.view = 'login';
    render();
  };

  async function onLogin() {
    var name = document.getElementById('name').value.trim();
    var code = document.getElementById('code').value.trim();
    var errBox = document.getElementById('err');
    errBox.innerHTML = '';
    if (!name || !code) { errBox.innerHTML = '<div class="msg error">יש למלא שם וקוד.</div>'; return; }
    App.reg.name = name; App.reg.code = code;
    // ניסיון שחזור (אם כבר נרשם)
    try {
      var r = await API.call('/login', 'POST', { name: name, code: code });
      App.token = r.token; localStorage.setItem('yh_token', r.token);
      App.state = r.state; App.view = 'exam'; startLoops(); render();
      return;
    } catch (e) {
      if (e.status !== 404) { errBox.innerHTML = '<div class="msg error">' + esc(e.message) + '</div>'; return; }
    }
    // נבחן חדש → ממשיכים לשאלון ההצהרה
    App.view = 'declaration'; render();
  }

  // ---------------------------------------------------------------- שאלון הצהרה
  function renderDeclaration() {
    root.className = 'wrap';
    var rows = App.subjectsAvailable.map(function (s) {
      var d = App.reg.declaration[s] || {};
      return '<div class="qcard" style="padding:14px 18px">' +
        '<label class="chip ' + (d.can ? 'selected' : '') + '" data-subj="' + esc(s) + '" style="margin-bottom:0">' +
        (d.can ? '✓ ' : '') + esc(s) + '</label>' +
        '<input type="text" class="decl-note" data-subj="' + esc(s) + '" placeholder="רמה / הערה (לא חובה)" ' +
        'value="' + esc(d.note || '') + '" style="margin-top:10px;' + (d.can ? '' : 'opacity:.4') + '">' +
        '</div>';
    }).join('');
    root.innerHTML = '';
    root.appendChild(el(
      '<div class="card">' + BRAND +
      '<div class="step-dots"><i></i><i class="active"></i><i></i></div>' +
      '<h2>שאלון הצהרה</h2>' +
      '<p class="lead">סמנו אילו מקצועות אתם מאמינים שאתם יכולים ללמד, ובאיזו רמה. זהו שלב הצהרה בלבד.</p>' +
      '<div class="chips" style="flex-direction:column;gap:10px">' + rows + '</div>' +
      '<div class="btn-row" style="margin-top:22px"><button class="btn" id="next">המשך לבחירת נושאים</button>' +
      '<button class="btn ghost" id="back">חזרה</button></div>' +
      '</div>'
    ));
    root.querySelectorAll('.chip[data-subj]').forEach(function (c) {
      c.onclick = function () {
        var s = c.getAttribute('data-subj');
        var d = App.reg.declaration[s] || {};
        d.can = !d.can; App.reg.declaration[s] = d; renderDeclaration();
      };
    });
    root.querySelectorAll('.decl-note').forEach(function (inp) {
      inp.oninput = function () {
        var s = inp.getAttribute('data-subj');
        App.reg.declaration[s] = App.reg.declaration[s] || {};
        App.reg.declaration[s].note = inp.value;
      };
    });
    document.getElementById('next').onclick = function () { App.view = 'subjects'; render(); };
    document.getElementById('back').onclick = function () { App.view = 'login'; render(); };
  }

  // ---------------------------------------------------------------- בחירת נושאים
  function renderSubjects() {
    root.className = 'wrap';
    var chips = App.subjectsAvailable.map(function (s) {
      var idx = App.reg.subjects.indexOf(s);
      var sel = idx >= 0;
      return '<div class="chip ' + (sel ? 'selected' : '') + '" data-subj="' + esc(s) + '">' +
        esc(s) + (sel ? ' <span class="order">#' + (idx + 1) + '</span>' : '') + '</div>';
    }).join('');
    var hasMath = App.reg.subjects.indexOf('מתמטיקה') >= 0;
    var mathBox = hasMath ?
      '<label class="field" style="margin-top:20px"><span>רמת מתמטיקה</span>' +
      '<select id="mathlvl">' +
      ['5', '4', '3'].map(function (l) { return '<option value="' + l + '"' + (App.reg.math_level === l ? ' selected' : '') + '>' + l + ' יחידות</option>'; }).join('') +
      '</select></label>' : '';
    root.innerHTML = '';
    root.appendChild(el(
      '<div class="card">' + BRAND +
      '<div class="step-dots"><i></i><i></i><i class="active"></i></div>' +
      '<h2>בחירת נושאים</h2>' +
      '<p class="lead">בחרו עד 4 מקצועות (הראשון שתבחרו הוא הנושא הראשי). אם תבחרו פחות מ-4, פרק אחד יחזור על הנושא הראשי.</p>' +
      '<div id="err"></div>' +
      '<div class="chips">' + chips + '</div>' + mathBox +
      '<div class="btn-row" style="margin-top:24px"><button class="btn" id="start">התחל מבחן</button>' +
      '<button class="btn ghost" id="back">חזרה</button></div>' +
      '</div>'
    ));
    root.querySelectorAll('.chip[data-subj]').forEach(function (c) {
      c.onclick = function () {
        var s = c.getAttribute('data-subj');
        var idx = App.reg.subjects.indexOf(s);
        if (idx >= 0) App.reg.subjects.splice(idx, 1);
        else { if (App.reg.subjects.length >= 4) return; App.reg.subjects.push(s); }
        renderSubjects();
      };
    });
    if (hasMath) document.getElementById('mathlvl').onchange = function (e) { App.reg.math_level = e.target.value; };
    document.getElementById('start').onclick = onRegister;
    document.getElementById('back').onclick = function () { App.view = 'declaration'; render(); };
  }

  async function onRegister() {
    var errBox = document.getElementById('err');
    if (App.reg.subjects.length === 0) { errBox.innerHTML = '<div class="msg error">יש לבחור לפחות מקצוע אחד.</div>'; return; }
    try {
      if (App.completingSetup) {
        // נבחן שנפתח לו משתמש מראש — משלים בחירה בלבד (כבר מחובר)
        var rc = await API.call('/complete-setup', 'POST', {
          declaration: App.reg.declaration, subjects: App.reg.subjects, math_level: App.reg.math_level,
        });
        App.completingSetup = false; App.state = rc.state; App.view = 'exam';
        if (!App.pollHandle) startLoops();
        render();
        return;
      }
      var r = await API.call('/register', 'POST', {
        name: App.reg.name, code: App.reg.code,
        declaration: App.reg.declaration, subjects: App.reg.subjects,
        math_level: App.reg.math_level,
      });
      App.token = r.token; localStorage.setItem('yh_token', r.token);
      App.state = r.state; App.view = 'exam'; startLoops(); render();
    } catch (e) {
      errBox.innerHTML = '<div class="msg error">' + esc(e.message) + '</div>';
    }
  }

  // ---------------------------------------------------------------- לולאות רקע
  function startLoops() {
    stopLoops();
    App.pollHandle = setInterval(poll, 5000);
    App.tickHandle = setInterval(tickTimer, 1000);
    attachAntiCopy();
  }
  function stopLoops() {
    if (App.pollHandle) clearInterval(App.pollHandle);
    if (App.tickHandle) clearInterval(App.tickHandle);
  }
  async function poll() {
    try {
      var s = await API.call('/state');
      App.state = s;
      if (App.view === 'exam') renderExam();
      else if (App.view !== 'declaration' && App.view !== 'subjects') renderExam();
    } catch (e) { /* התעלמות משגיאות רשת זמניות */ }
  }

  // ---------------------------------------------------------------- מסך המבחן
  function topBar(extraRight) {
    var name = (App.state && App.state.examinee && App.state.examinee.name) || '';
    return '<div class="exam-bar">' +
      '<img class="logo" src="/img/logo.svg" alt="עתיד פלוס" style="height:34px">' +
      (extraRight || '') +
      '<div class="who"><span class="name">' + esc(name) + '</span>' +
      '<button class="btn ghost small" id="logout">יציאה</button></div></div>';
  }
  function wireLogout() {
    var b = document.getElementById('logout');
    if (b) b.onclick = onLogout;
  }
  function onLogout() {
    if (!confirm('לצאת מהמערכת? תוכל/י לחזור עם אותו שם וקוד.')) return;
    localStorage.removeItem('yh_token'); App.token = null; App.state = null; App.renderedKey = null;
    stopLoops(); App.view = 'login'; render();
  }

  function renderExam() {
    var s = App.state;
    if (!s) return;
    root.className = 'wrap';

    // נבחן שנפתח לו משתמש מראש — משלים הצהרה ובחירת נושאים בעצמו
    if (s.phase === 'needs_setup') {
      App.reg.name = s.examinee.name; App.reg.code = s.examinee.code;
      App.completingSetup = true;
      App.view = 'declaration';
      render();
      return;
    }

    if (s.phase === 'chapter') {
      if (s.timer) syncTimer(s.timer);
      var key = s.slot.round + ':' + s.slot.chapter_id + ':' + s.slot.not_comfortable;
      if (key === App.renderedKey) { updateTimerDisplay(); return; } // רק עדכון טיימר — לשמר פוקוס
      App.renderedKey = key;
      renderChapter(s);
      return;
    }

    App.renderedKey = null;
    renderBigState(s.phase, s.message);
  }

  function renderBigState(kind, message) {
    var icons = {
      interview: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M8 12h8M8 8h8M8 16h5"/><rect x="3" y="4" width="18" height="16" rx="3"/></svg>',
      waiting: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
      submitted: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>',
      ended: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>',
    };
    var titles = { interview: 'סבב הריאיון שלך', waiting: 'ממתינים לסבב הבא', submitted: 'הפרק הוגש', ended: 'המבחן הסתיים' };
    var footer = (kind === 'waiting' || kind === 'submitted')
      ? '<p style="margin-top:18px;color:var(--faint);font-size:14px">המסך יתעדכן אוטומטית כשהבוחן ישחרר את הסבב הבא.</p>' : '';
    root.innerHTML = '';
    root.appendChild(el(
      '<div>' + topBar() +
      '<div class="card"><div class="big-state">' +
      '<div class="glyph">' + (icons[kind] || icons.waiting) + '</div>' +
      '<h2>' + (titles[kind] || 'ממתינים') + '</h2>' +
      '<p>' + esc(message || '') + '</p>' + footer +
      '</div></div></div>'
    ));
    wireLogout();
  }

  function renderChapter(s) {
    var ch = s.chapter;
    var savedMap = {};
    (s.answers || []).forEach(function (a) { savedMap[a.item_id] = a.answer; });
    App.itemStart = {};
    var t = Date.now();

    var src = ch.source ? (
      '<div class="source-box"><div class="src-label">קטע מוצג</div>' +
      '<div class="src-body">' + renderSource(ch.source) + '</div>' +
      (ch.source.note ? '<div class="src-note">' + window.renderMathText(ch.source.note) + '</div>' : '') +
      '</div>'
    ) : '';

    var items = ch.items.map(function (it) {
      App.itemStart[it.id] = t;
      return renderItem(it, savedMap[it.id]);
    }).join('');

    var name = (s.examinee && s.examinee.name) || '';
    root.innerHTML = '';
    root.appendChild(el(
      '<div>' +
      '<div class="exam-bar">' +
      '<img class="logo" src="/img/logo.svg" alt="עתיד פלוס" style="height:34px">' +
      '<div><div class="title">' + esc(ch.display_title || ch.topic || ch.subject) + '</div>' +
      '<div class="round-tag">סבב ' + s.slot.round + ' מתוך ' + s.rounds.total + '</div></div>' +
      '<div style="flex:1"></div>' +
      '<div class="timer" id="timer">--:--</div>' +
      '<span class="name" style="color:var(--muted);font-size:13px">' + esc(name) + '</span>' +
      '<button class="btn ghost small" id="logout">יציאה</button>' +
      '</div>' +
      '<div id="pause-banner" class="pause-banner hidden">המבחן הושהה על-ידי הבוחן. הטיימר עצר — המתן/י להמשך.</div>' +
      src +
      '<div id="items">' + items + '</div>' +
      '<div class="submit-bar">' +
      '<button class="btn big" id="submit-slot">הגש פרק</button>' +
      '<span class="txt">התשובות נשמרות אוטומטית לאורך כל הדרך. לחיצה על "הגש פרק" מסיימת את הפרק ומעבירה להמתנה לסבב הבא.</span>' +
      '</div>' +
      '</div>'
    ));
    wireItems(s);
    var sub = document.getElementById('submit-slot');
    if (sub) sub.onclick = function () { onSubmit(s.slot.round); };
    wireLogout();
    updateTimerDisplay();
  }

  async function onSubmit(round) {
    if (!confirm('להגיש את הפרק? לאחר ההגשה לא ניתן לערוך את התשובות בפרק זה.')) return;
    try {
      var r = await API.call('/submit-slot', 'POST', { round: round });
      App.state = r.state; App.renderedKey = null; renderExam();
    } catch (e) { flash(e.message, 'error'); }
  }

  function renderSource(source) {
    if (source.tex) return '<div style="text-align:center;font-size:1.15em">' + window.renderMathText('\\[' + source.tex + '\\]') + '</div>';
    if (source.text) return window.renderMathText(source.text);
    return '';
  }

  var TYPE_LABEL = {
    mc_apply: { t: 'יישום · נבדק אוטומטית', cls: '' },
    mc_error_dialogue: { t: 'זיהוי טעות בשיח', cls: '' },
    text_teach: { t: 'הוראה · תשובה במילים', cls: 'teach' },
    text_teach_error: { t: 'זיהוי טעות והוראה · במילים', cls: 'teach' },
  };

  function renderItem(it, saved) {
    var lbl = TYPE_LABEL[it.type] || { t: it.type, cls: '' };
    var head = '<span class="qtype ' + lbl.cls + '">' + lbl.t + '</span>';
    var body = '';
    if (it.stem) body += '<div class="stem">' + window.renderMathText(it.stem) + '</div>';
    if (it.dialogue) {
      body += '<div class="dialogue">' + it.dialogue.map(function (d) {
        return '<div class="line"><span class="speaker">' + esc(d.speaker) + ':</span>' + window.renderMathText(d.line) + '</div>';
      }).join('') + '</div>';
    }
    if (it.prompt) body += '<div class="prompt">' + window.renderMathText(it.prompt) + '</div>';

    if (it.options) {
      var opts = it.options.map(function (o) {
        var sel = saved === o.id;
        var label = o.tex ? window.renderMathText('\\(' + o.tex + '\\)') : window.renderMathText(o.text || '');
        return '<div class="option ' + (sel ? 'selected' : '') + '" data-item="' + esc(it.id) + '" data-opt="' + esc(o.id) + '">' +
          '<span class="mark"></span><span>' + label + '</span></div>';
      }).join('');
      body += '<div class="options" data-item="' + esc(it.id) + '">' + opts + '</div>';
    } else {
      body += '<textarea class="answer-text" data-item="' + esc(it.id) + '" placeholder="כתבו את הסברכם במילים...">' + esc(saved || '') + '</textarea>';
    }

    var actions = '<div class="q-actions">' +
      '<button class="btn ghost small act-swap" data-item="' + esc(it.id) + '">החלף שאלה</button>' +
      '<button class="btn ghost small act-nc" data-item="' + esc(it.id) + '">לא בנוח</button>' +
      '<span class="save-hint" data-hint="' + esc(it.id) + '"></span></div>';

    return '<div class="qcard" data-type="' + esc(it.type) + '">' + head + body + actions + '</div>';
  }

  function wireItems(s) {
    var round = s.slot.round, chapterId = s.slot.chapter_id;
    // רב-ברירה
    root.querySelectorAll('.option').forEach(function (opt) {
      opt.onclick = function () {
        var item = opt.getAttribute('data-item'), val = opt.getAttribute('data-opt');
        root.querySelectorAll('.option[data-item="' + item + '"]').forEach(function (o) { o.classList.remove('selected'); });
        opt.classList.add('selected');
        saveAnswer(round, chapterId, item, opt.closest('.qcard').getAttribute('data-type'), val, 0);
      };
    });
    // טקסט חופשי
    root.querySelectorAll('.answer-text').forEach(function (ta) {
      ta.oninput = function () {
        var item = ta.getAttribute('data-item');
        setHint(item, 'שומר...');
        clearTimeout(App.saveTimers[item]);
        App.saveTimers[item] = setTimeout(function () {
          var spent = Math.round((Date.now() - (App.itemStart[item] || Date.now())) / 1000);
          saveAnswer(round, chapterId, item, ta.closest('.qcard').getAttribute('data-type'), ta.value, spent);
        }, 800);
      };
    });
    // החלף שאלה / לא בנוח
    root.querySelectorAll('.act-swap').forEach(function (b) { b.onclick = function () { onSwap(round); }; });
    root.querySelectorAll('.act-nc').forEach(function (b) { b.onclick = function () { onNotComfortable(round); }; });
  }

  async function saveAnswer(round, chapterId, item, type, answer, spent) {
    try {
      await API.call('/save-answer', 'POST', { round: round, chapter_id: chapterId, item_id: item, type: type, answer: answer, time_spent_sec: spent });
      setHint(item, 'נשמר', true);
    } catch (e) { setHint(item, 'שגיאת שמירה — ננסה שוב', false); }
  }
  function setHint(item, text, ok) {
    var h = root.querySelector('.save-hint[data-hint="' + item + '"]');
    if (!h) return;
    h.textContent = text; h.classList.toggle('saved', !!ok);
  }

  async function onSwap(round) {
    try {
      var r = await API.call('/swap-question', 'POST', { round: round });
      if (r.swapped) { App.state = r.state; App.renderedKey = null; renderExam(); }
      else flash(r.message || 'אין שאלה חלופית כרגע.', 'warn');
    } catch (e) { flash(e.message, 'error'); }
  }
  async function onNotComfortable(round) {
    try {
      var r = await API.call('/not-comfortable', 'POST', { round: round });
      if (r.effect === 'level_down') flash('נרשם. הפרק הבא במתמטיקה יוצג ברמה ' + r.new_level + '.', 'info');
      else if (r.effect === 'swap') { App.state = r.state; App.renderedKey = null; renderExam(); }
      else flash(r.message || 'נרשם.', 'info');
    } catch (e) { flash(e.message, 'error'); }
  }
  function flash(text, kind) {
    var m = el('<div class="msg ' + (kind || 'info') + '" style="position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99;max-width:90%">' + esc(text) + '</div>');
    document.body.appendChild(m);
    setTimeout(function () { m.remove(); }, 4000);
  }

  // ---------------------------------------------------------------- טיימר
  function syncTimer(timer) {
    App.timer.state = timer.state;
    App.timer.remaining = timer.remaining_sec;
    App.timer.syncAt = Date.now();
  }
  function currentRemaining() {
    if (App.timer.state === 'running') {
      return Math.max(0, App.timer.remaining - Math.floor((Date.now() - App.timer.syncAt) / 1000));
    }
    return App.timer.remaining;
  }
  function tickTimer() { if (App.view === 'exam' && App.state && App.state.phase === 'chapter') updateTimerDisplay(); }
  function updateTimerDisplay() {
    var elm = document.getElementById('timer');
    if (!elm) return;
    var paused = App.timer.state === 'paused';
    var rem = currentRemaining();
    var mm = String(Math.floor(rem / 60)).padStart(2, '0');
    var ss = String(rem % 60).padStart(2, '0');
    elm.textContent = mm + ':' + ss;
    elm.classList.toggle('warn', !paused && rem <= 300 && rem > 60);
    elm.classList.toggle('crit', !paused && rem <= 60);

    var banner = document.getElementById('pause-banner');
    if (banner) banner.classList.toggle('hidden', !paused);

    var expired = rem <= 0 && !paused;
    var locked = paused || expired;
    root.querySelectorAll('.answer-text, .option, .act-swap, .act-nc, #submit-slot').forEach(function (n) {
      if (locked) { n.setAttribute('disabled', 'disabled'); n.style.pointerEvents = 'none'; n.style.opacity = '0.55'; }
      else { n.removeAttribute('disabled'); n.style.pointerEvents = ''; n.style.opacity = ''; }
    });
    if (expired && !document.getElementById('time-up')) {
      var bar = document.querySelector('.exam-bar');
      if (bar) bar.insertAdjacentHTML('afterend', '<div id="time-up" class="msg warn">הזמן הסתיים. התשובות שנשמרו נשמרו. המתינו להנחיות הבוחן.</div>');
    }
  }

  // ---------------------------------------------------------------- אנטי-העתקה קל
  var antiAttached = false;
  function attachAntiCopy() {
    if (antiAttached) return; antiAttached = true;
    document.addEventListener('paste', function (e) {
      var t = e.target;
      if (t && (t.classList.contains('answer-text') || t.tagName === 'TEXTAREA')) {
        e.preventDefault();
        reportEvent('paste_blocked', 'answer field');
        flash('הדבקה חסומה בשדות התשובה.', 'warn');
      }
    }, true);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && inChapter()) reportEvent('tabhide', 'tab hidden');
    });
    window.addEventListener('blur', function () { if (inChapter()) reportEvent('blur', 'window blur'); });
  }
  function inChapter() { return App.view === 'exam' && App.state && App.state.phase === 'chapter'; }
  function reportEvent(type, detail) { API.call('/event', 'POST', { type: type, detail: detail }).catch(function () {}); }

  init();
})();
