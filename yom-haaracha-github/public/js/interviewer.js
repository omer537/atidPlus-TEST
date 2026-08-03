/* =========================================================================
   מסך המראיין — קורא בלבד על הלו"ז (מבקש החלפה; המנהל מאשר).
   כניסה: סיסמת מראיינים משותפת + בחירת שם מהרשימה.
   ========================================================================= */
window.InterviewerApp = (function () {
  'use strict';

  var token = localStorage.getItem('yh_interviewer_token') || null;
  var root = document.getElementById('root');
  var pollHandle = null;
  var DATA = null;

  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function two(n) { return String(n).padStart(2, '0'); }
  function clock(ms) { if (!ms) return '--:--'; var d = new Date(ms); return two(d.getHours()) + ':' + two(d.getMinutes()); }
  function fmtLeft(sec) {
    if (sec == null || sec < 0) return '--:--';
    return two(Math.floor(sec / 60)) + ':' + two(sec % 60);
  }

  async function call(path, method, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['x-token'] = token;
    var res = await fetch('/api' + path, { method: method || 'GET', headers: headers, body: body ? JSON.stringify(body) : undefined });
    var data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw Object.assign(new Error((data && data.error) || 'שגיאה'), { status: res.status });
    return data;
  }

  var BRAND = '<div class="brand"><img class="logo" src="/img/logo.svg" alt="עתיד פלוס"><span class="wordmark">עתיד פלוס</span><span class="sub">מסך מראיין</span></div>';

  // ------------------------------------------------- כניסה
  async function renderLogin(errMsg) {
    if (pollHandle) clearInterval(pollHandle);
    root.className = 'center-screen';
    var list = [];
    try { list = (await call('/interviewers-public')).interviewers || []; } catch (e) { list = []; }
    var opts = '<option value="">— בחרו את שמכם —</option>' + list.map(function (v) {
      return '<option value="' + v.id + '">' + esc(v.name) + (v.room ? ' · ' + esc(v.room) : '') + '</option>';
    }).join('');
    root.innerHTML = '';
    root.appendChild(el(
      '<div class="card" style="max-width:420px;width:100%">' + BRAND +
      '<h2>כניסת מראיין/ת</h2>' +
      '<p class="lead">בחרו את שמכם והזינו את סיסמת המראיינים.</p>' +
      (errMsg ? '<div class="msg error">' + esc(errMsg) + '</div>' : '') +
      (list.length ? '' : '<div class="msg warn">עדיין לא הוגדרו מראיינים ליום הזה. המנהל צריך להוסיף מראיינים וחדרים.</div>') +
      '<label class="field"><span>השם שלי</span><select id="iv-who">' + opts + '</select></label>' +
      '<label class="field"><span>סיסמת מראיינים</span><input id="iv-pw" type="password" autocomplete="off"></label>' +
      '<div class="btn-row"><button class="btn" id="iv-go">כניסה</button></div>' +
      '</div>'
    ));
    document.getElementById('iv-go').onclick = doLogin;
    document.getElementById('iv-pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  }

  async function doLogin() {
    var id = document.getElementById('iv-who').value;
    var pw = document.getElementById('iv-pw').value;
    if (!id) { renderLogin('יש לבחור שם מהרשימה.'); return; }
    try {
      var r = await call('/interviewer/login', 'POST', { password: pw, interviewer_id: Number(id) });
      token = r.token; localStorage.setItem('yh_interviewer_token', token);
      start();
    } catch (e) { renderLogin(e.message); }
  }

  // ------------------------------------------------- המסך
  function render() {
    var D = DATA; if (!D) return;
    root.className = 'wrap';
    var iv = D.interviewer;

    // הסבב הנוכחי — מתי התחיל ומתי מסתיים
    var cur = D.current;
    var curHtml;
    var roomBig = iv.room
      ? '<div class="iv-myroom"><span class="lbl">החדר שלך</span><b>' + esc(iv.room) + '</b></div>'
      : '<div class="iv-myroom empty"><span class="lbl">החדר שלך</span><b>טרם הוגדר</b></div>';
    if (!D.running) {
      curHtml = roomBig + '<div class="iv-round-box"><div class="big">אין סבב פעיל</div><div class="sub">ממתינים שהמנהל יתחיל את הסבב הבא.</div></div>';
    } else {
      var leftSec = cur && cur.ends_at ? Math.max(0, Math.floor((cur.ends_at - D.server_now) / 1000)) : null;
      curHtml = roomBig + '<div class="iv-round-box"><div class="big">סבב ' + D.running + ' — פועל</div>' +
        '<div class="iv-times">' +
        '<span><small>התחיל</small><b>' + clock(cur && cur.started_at) + '</b></span>' +
        '<span><small>מסתיים</small><b>' + clock(cur && cur.ends_at) + '</b></span>' +
        '<span><small>נותר</small><b id="iv-left">' + fmtLeft(leftSec) + '</b></span>' +
        '</div></div>';
    }

    // הלו"ז שלי
    var byRound = {};
    (D.schedule || []).forEach(function (s) { (byRound[s.round] = byRound[s.round] || []).push(s); });
    var roundsHtml = (D.rounds || []).map(function (r) {
      var mine = byRound[r.round] || [];
      if (!mine.length) return '';
      var stateLbl = r.state === 'running' ? 'רץ עכשיו' : (r.state === 'ended' ? 'הסתיים' : 'מתוכנן');
      var cls = r.state === 'running' ? ' running' : (r.state === 'ended' ? ' ended' : '');
      return '<div class="iv-slot' + cls + '">' +
        '<div class="iv-slot-head">סבב ' + r.round + ' <small>' + stateLbl + '</small></div>' +
        mine.map(function (s) {
          var badge = s.in_interview ? '<span class="pill interview">אצלי כרגע</span>'
            : (s.interviewed ? '<span class="pill done">הסתיים</span>'
              : (r.state === 'running' ? '<span class="pill chapter">עכשיו</span>' : '<span class="pill">ממתין</span>'));
          return '<div class="iv-person-row">' +
            '<div class="iv-nm"><b>' + esc(s.name) + '</b>' + (s.left ? ' <small style="color:var(--danger)">(עזב)</small>' : '') + ' ' + badge +
            (iv.room ? '<div style="font-size:11px;color:var(--muted);margin-top:2px">אצלך · ' + esc(iv.room) + '</div>' : '') + '</div>' +
            (s.brief ? '<div class="iv-brief">' + esc(s.brief) + '</div>' : '<div class="iv-brief empty">— אין בריף —</div>') +
            '<button class="btn ghost small iv-swap" data-r="' + r.round + '" data-c="' + esc(s.code) + '" data-n="' + esc(s.name) + '">בקש החלפה</button>' +
            '</div>';
        }).join('') + '</div>';
    }).join('') || '<p class="hint-text">עדיין לא שובצו לך ריאיונות. המנהל משבץ — המסך יתעדכן לבד.</p>';

    // בקשות שלי
    var swaps = (D.my_swaps || []).filter(function (s) { return s.status === 'pending'; });
    var swapHtml = swaps.length
      ? '<div class="msg info">' + swaps.length + ' בקשות החלפה ממתינות לאישור המנהל.</div>' : '';

    root.innerHTML = '';
    root.appendChild(el(
      '<div>' +
      '<div class="exm-header">' +
      '<img class="logo" src="/img/logo.svg" alt="עתיד פלוס" style="height:42px">' +
      '<span class="wordmark" style="font-size:20px;font-weight:800">עתיד פלוס</span>' +
      '<span style="color:var(--muted);font-size:14px">· מסך מראיין</span>' +
      '<div class="spacer"></div>' +
      '<span class="iv-me"><b>' + esc(iv.name) + '</b>' + (iv.room ? '<span class="iv-room-tag">' + esc(iv.room) + '</span>' : '') + '</span>' +
      '<button class="btn ghost small" id="iv-out">יציאה</button></div>' +
      (iv.brief ? '<div class="card"><b>הנחיות עבורך</b><p class="hint-text" style="margin-top:6px">' + esc(iv.brief) + '</p></div>' : '') +
      '<div class="card">' + curHtml + '</div>' +
      swapHtml +
      '<div class="card"><h2 class="section-title">הלו״ז שלי</h2>' +
      '<p class="hint-text">מי מרואיין אצלך בכל סבב, עם בריף קצר. המסך מתעדכן לבד. שינוי בלו״ז נעשה דרך המנהל — לחצו «בקש החלפה».</p>' +
      roundsHtml + '</div>' +
      '<div id="iv-msg"></div>' +
      '</div>'
    ));
    document.getElementById('iv-out').onclick = function () {
      localStorage.removeItem('yh_interviewer_token'); token = null;
      if (pollHandle) clearInterval(pollHandle);
      renderLogin();
    };
    root.querySelectorAll('.iv-swap').forEach(function (b) {
      b.onclick = function () { askSwap(Number(b.getAttribute('data-r')), b.getAttribute('data-n'), b.getAttribute('data-c')); };
    });
  }

  async function askSwap(round, name, code) {
    var txt = prompt('מה תרצה/י לשנות בלו״ז?\n(' + name + ' · סבב ' + round + ')\n\nהבקשה תישלח למנהל לאישור.', '');
    if (txt === null || !txt.trim()) return;
    try {
      await call('/interviewer/swap-request', 'POST', { round: round, code: code, requested_change: name + ': ' + txt.trim() });
      var box = document.getElementById('iv-msg');
      if (box) box.innerHTML = '<div class="msg info">הבקשה נשלחה למנהל.</div>';
      refresh();
    } catch (e) { alert(e.message); }
  }

  // שעון מקומי בין הרענונים (כדי שהזמן ירוץ חלק)
  function tick() {
    if (!DATA || !DATA.current || !DATA.current.ends_at) return;
    var box = document.getElementById('iv-left'); if (!box) return;
    DATA.server_now += 1000;
    box.textContent = fmtLeft(Math.max(0, Math.floor((DATA.current.ends_at - DATA.server_now) / 1000)));
  }

  async function refresh() {
    try { DATA = await call('/interviewer/schedule'); }
    catch (e) { if (e.status === 401) { token = null; localStorage.removeItem('yh_interviewer_token'); return renderLogin('פג תוקף. התחבר/י מחדש.'); } return; }
    try { render(); } catch (e) { /* לא לשבור את הלולאה */ }
  }

  function start() {
    refresh();
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = setInterval(refresh, 5000);
    setInterval(tick, 1000);
  }

  async function enter() {
    if (token) { try { await call('/interviewer/schedule'); start(); return; } catch (e) { token = null; localStorage.removeItem('yh_interviewer_token'); } }
    renderLogin();
  }
  return { enter: enter };
})();
