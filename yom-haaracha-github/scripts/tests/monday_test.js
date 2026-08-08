'use strict';
/* שליחה ישירה למאנדיי — נבדק מול **שרת מאנדיי מדומה** שרץ מקומית.
   כך אנחנו מאמתים את הדבר החשוב באמת: *מה בדיוק נשלח* — בלי טוקן אמיתי,
   בלי לגעת בבורד של אף אחד, ובלי עלות.

   הרצה:
     1) שרת מדומה + שרת האפליקציה שמצביע אליו:
        node scripts/tests/monday_test.js            (מרים הכול לבד)
*/
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const APP = 'http://localhost:3000/api';
const PW = process.env.PW || 'demo123';
const FAKE_PORT = 4711;
const DB = '/tmp/monday_test.db';
const fail = [];
function head(t) { console.log('\n=== ' + t + ' ==='); }
function check(c, m) { if (!c) { fail.push(m); console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); }
async function j(u, m, b, t) {
  const h = { 'content-type': 'application/json' }; if (t) h['x-token'] = t;
  const r = await fetch(APP + u, { method: m || 'GET', headers: h, body: b ? JSON.stringify(b) : undefined });
  let body = null; try { body = await r.json(); } catch (e) {}
  return { code: r.status, body };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- שרת מאנדיי מדומה ----------
const BOARD_ITEMS = [
  { id: '101', name: 'נעמה בן-דוד' },      // התאמה מדויקת
  { id: '102', name: 'שרעבי איתי' },        // סדר הפוך → הצעה
  { id: '103', name: 'מישהי אחרת לגמרי' },  // אין התאמה
];
// ⚠ «ליאור אזולאי» נבדקת אצלנו אבל **אין לה שורה בבורד** — הכיוון ההפוך.
const WRITES = [];              // כל mutation שנשלחה — זה מה שאנחנו בודקים
let AUTH_SEEN = null;

function fakeMonday() {
  return http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      AUTH_SEEN = req.headers.authorization || null;
      let q = {}; try { q = JSON.parse(raw); } catch (e) {}
      const query = q.query || '', vars = q.variables || {};
      const send = (data) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: data })); };

      if (/\bme\b/.test(query)) return send({ me: { id: '1', name: 'עומר בוים', email: 'omer@atidplus.com' } });
      if (/boards\(limit/.test(query)) return send({ boards: [{ id: '900', name: 'מועמדים תשפ״ז', items_count: 3 }] });
      if (/columns\s*\{/.test(query)) {
        return send({ boards: [{ id: '900', name: 'מועמדים תשפ״ז', columns: [
          { id: 'name', title: 'Name', type: 'name' },
          { id: 'num_score', title: 'ציון', type: 'numbers' },
          { id: 'num_rav', title: 'רב-מלל', type: 'numbers' },
          { id: 'num_q', title: 'כמותי', type: 'numbers' },
          { id: 'num_e', title: 'אנגלית', type: 'numbers' },
          { id: 'txt_rec', title: 'המלצה', type: 'long_text' },
          { id: 'phone_x', title: 'טלפון', type: 'phone' },
        ] }] });
      }
      if (/items_page/.test(query)) return send({ boards: [{ items_page: { cursor: null, items: BOARD_ITEMS } }] });
      if (/change_multiple_column_values/.test(query)) {
        WRITES.push({ board: vars.board, item: vars.item, vals: JSON.parse(vars.vals) });
        return send({ change_multiple_column_values: { id: vars.item } });
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ message: 'unknown query' }] }));
    });
  });
}

(async () => {
  const fake = fakeMonday();
  await new Promise((r) => fake.listen(FAKE_PORT, r));
  console.log('שרת מאנדיי מדומה על ' + FAKE_PORT);

  const env = Object.assign({}, process.env, {
    DB_PATH: DB, EXAMINER_PASSWORD: PW,
    MONDAY_API_TOKEN: 'fake-token-for-tests',
    MONDAY_API_URL: 'http://localhost:' + FAKE_PORT,
  });
  delete env.ANTHROPIC_API_KEY; delete env.CLAUDE_API_KEY;
  require('fs').rmSync(DB, { force: true });
  ['-shm', '-wal'].forEach((s) => require('fs').rmSync(DB + s, { force: true }));
  const app = spawn('node', [path.join(__dirname, '..', '..', 'server.js')], { env: env, stdio: 'ignore' });
  await sleep(2500);

  try {
    const tok = (await j('/examiner/login', 'POST', { password: PW })).body.token;

    head('0. מחזור עם ציונים');
    const NAMES = ['נעמה בן-דוד', 'איתי שרעבי', 'ליאור אזולאי'];
    await j('/examiner/create-day', 'POST', { name: 'בדיקת מאנדיי', total_rounds: 3 }, tok);
    await j('/examiner/add-examinees-bulk', 'POST', { text: NAMES.map((n, i) => n + ', ' + (701 + i)).join('\n') }, tok);
    await j('/examiner/add-interviewers-bulk', 'POST', { text: 'א א, חדר 1\nב ב, חדר 2' }, tok);
    await j('/examiner/autosplit-interviews', 'POST', {}, tok);
    const exTok = {};
    for (let i = 0; i < NAMES.length; i++) exTok[NAMES[i]] = (await j('/register-morning', 'POST', { name: NAMES[i], code: String(701 + i) })).body.token;
    await j('/examiner/update-day', 'POST', { phase: 'open' }, tok);
    for (const n of NAMES) await j('/complete-setup', 'POST', { subjects: ['פיזיקה'], math_level: null, declaration: { subjects: ['פיזיקה'], mathLevel: null, note: '' } }, exTok[n]);
    for (let r = 1; r <= 2; r++) {
      await j('/examiner/start-round', 'POST', { round: r }, tok);
      for (const n of NAMES) {
        const s = (await j('/state', null, null, exTok[n])).body;
        if (s.phase !== 'chapter') continue;
        for (const it of (s.chapter.items || [])) {
          const isText = /text_teach/.test(it.type);
          const ans = isText ? 'הייתי מסבירה בצעדים, עם דוגמה, ומוודאת שהבין את השורש.' : (it.options && it.options[0] ? it.options[0].id : '');
          if (ans) await j('/save-answer', 'POST', { round: r, chapter_id: s.chapter.chapter_id, item_id: it.id, type: it.type, answer: ans }, exTok[n]);
        }
        await j('/submit-slot', 'POST', { round: r }, exTok[n]);
      }
      await j('/examiner/end-round', 'POST', {}, tok);
    }
    const snap = await j('/examiner/grading/snapshot', 'POST', { name: 'מחזור מאנדיי' }, tok);
    const CID = snap.body.cohort_id;
    await j('/examiner/grading/run-ai', 'POST', { cohort_id: CID, confirm_demo: true }, tok);
    for (let i = 0; i < 60; i++) { const p = (await j('/examiner/grading/progress/' + CID, null, null, tok)).body; if (!p.running) break; await sleep(300); }
    check(!!CID, 'מחזור מנוקד מוכן (#' + CID + ')');

    head('1. חיבור ובורדים');
    const t = await j('/examiner/monday/test', null, null, tok);
    check(t.body.ok && /עומר/.test(t.body.message), 'בדיקת חיבור: ' + t.body.message);
    check(AUTH_SEEN === 'fake-token-for-tests', '⭐ הטוקן נשלח בכותרת Authorization');
    check(JSON.stringify(t.body).indexOf('fake-token') < 0, '⭐ הטוקן לא מוחזר ללקוח');
    const bl = await j('/examiner/monday/boards', null, null, tok);
    check(bl.body.boards.length === 1 && bl.body.boards[0].name === 'מועמדים תשפ״ז', 'רשימת הבורדים נטענה');

    head('2. עמודות — רק מה שאפשר לכתוב אליו');
    const bc = await j('/examiner/monday/board/900', null, null, tok);
    const types = bc.body.columns.map((c) => c.type);
    check(types.indexOf('phone') < 0, '⭐ עמודת טלפון (סוג שאיננו כותבים) לא מוצעת');
    check(types.indexOf('name') < 0, 'עמודת השם לא מוצעת לכתיבה');
    check(bc.body.columns.length === 5, '5 עמודות ברות-כתיבה (' + bc.body.columns.map((c) => c.title).join(', ') + ')');

    head('3. תצוגה מקדימה — קריאה בלבד');
    const before = WRITES.length;
    const dl = await j('/examiner/monday/days', null, null, tok);
    check(dl.body.days.length >= 1, 'רשימת הימים נטענה (' + dl.body.days.map((d) => d.day + ':' + d.graded + '/' + d.total).join(' · ') + ')');
    const DAYS = dl.body.days.map((d) => d.day_key);
    const noDays = await j('/examiner/monday/preview', 'POST', { board_id: '900' }, tok);
    check(noDays.code === 400, '⭐ תצוגה מקדימה בלי בחירת ימים נחסמת (' + noDays.code + ')');
    const pv = await j('/examiner/monday/preview', 'POST', { board_id: '900', days: DAYS }, tok);
    check(WRITES.length === before, '⭐ התצוגה המקדימה לא כתבה כלום');
    check(pv.body.total === 3, 'שלוש שורות בבורד');
    const r101 = pv.body.rows.find((r) => r.item_id === '101');
    const r102 = pv.body.rows.find((r) => r.item_id === '102');
    const r103 = pv.body.rows.find((r) => r.item_id === '103');
    check(r101.matched && r101.matched.name === 'נעמה בן-דוד', 'התאמה מדויקת');
    check(!r102.matched && r102.suggestions.some((s) => /הפוך/.test(s.reason)), '⭐ «שרעבי איתי» → הצעה של סדר הפוך');
    check(!r103.matched && !r103.suggestions.length, 'שורה זרה לא הותאמה');
    check(pv.body.will_write === 1, 'ייכתבו שורה אחת בלבד (' + pv.body.will_write + ')');

    head('4. הכרעה ידנית מוסיפה שורה');
    const key102 = r102.suggestions[0].key;
    // ★ השיבוץ עכשיו מקומי בלקוח — השרת מחזיר `pool` וזה כל מה שצריך.
    check(Array.isArray(pv.body.pool) && pv.body.pool.length >= 2,
      '⭐ preview מחזיר pool מלא (' + pv.body.pool.length + ') — התנאי לשיבוץ בלי רשת');
    const inPool = pv.body.pool.find((p) => p.key === key102);
    check(!!inPool && !!inPool.values && inPool.values.final != null,
      '⭐ ה-pool כולל את הערכים לכתיבה — הלקוח לא צריך לקרוא לשרת שוב');
    const orphan = pv.body.pool.find((p) => /ליאור/.test(p.name));
    check(!!orphan, '⭐ נבחנת שאין לה שורה בבורד מופיעה ב-pool (כדי שתוצג כחסרה)');
    check(!pv.body.rows.some((r) => r.matched && r.matched.key === orphan.key),
      '⭐ ואכן אף שורה בבורד לא הותאמה אליה');

    head('4ב. ⭐ סינון ימים');
    if (DAYS.length > 1) {
      const one = await j('/examiner/monday/preview', 'POST', { board_id: '900', days: [DAYS[0]] }, tok);
      check(one.body.pool.length < pv.body.pool.length, 'יום אחד מחזיר פחות נבחנים מכל הימים');
    } else {
      const bogus = await j('/examiner/monday/preview', 'POST', { board_id: '900', days: ['999|לא קיים'] }, tok);
      check(bogus.code === 400, '⭐ יום שלא קיים → 400 ולא «כל הנבחנים»');
    }

    head('5. ⭐ הכתיבה — רק העמודות שמופו');
    WRITES.length = 0;
    const rows = pv.body.rows.filter((r) => r.matched && !r.pending).map((r) => ({ item_id: r.item_id, key: r.matched.key, board_name: r.board_name }));
    // מוסיפים ידנית את השורה ששובצה בלקוח, בדיוק כמו שהמסך עושה
    rows.push({ item_id: '102', key: key102, board_name: 'שרעבי איתי' });
    const push = await j('/examiner/monday/push', 'POST', {
      board_id: '900', rows: rows, days: DAYS,
      mapping: { final: 'num_score', ravMelel: 'num_rav', recommendation: 'txt_rec' },   // בכוונה בלי כמותי/אנגלית
    }, tok);
    check(push.body.written === 2, 'נכתבו ' + push.body.written + ' שורות');
    check(WRITES.length === 2, 'שתי קריאות mutation');
    const w = WRITES[0];
    check(w.board === '900', 'מזהה הבורד נכון');
    const keys = Object.keys(w.vals).sort().join(',');
    check(keys.indexOf('num_q') < 0 && keys.indexOf('num_e') < 0,
      '⭐ עמודות שלא מופו לא נשלחו כלל — לא נמחקות (' + keys + ')');
    check(typeof w.vals.num_score === 'string', 'עמודת מספר נשלחת כמחרוזת');
    check(w.vals.txt_rec && typeof w.vals.txt_rec.text === 'string', '⭐ long_text נשלח בפורמט {text:…}');
    check(!/[\t\r\n]/.test(w.vals.txt_rec.text), 'ההמלצה בשורה אחת');
    check(!('phone_x' in w.vals), 'שום עמודה אחרת בבורד לא נגעה');

    head('6. הגנות');
    const noPushDays = await j('/examiner/monday/push', 'POST', { board_id: '900', rows: rows, mapping: { final: 'num_score' } }, tok);
    check(noPushDays.code === 400, '⭐ שליחה בלי בחירת ימים נחסמת');
    const noMap = await j('/examiner/monday/push', 'POST', { board_id: '900', rows: rows, days: DAYS, mapping: {} }, tok);
    check(noMap.code === 400, 'בלי מיפוי — נחסם');
    const noRows = await j('/examiner/monday/push', 'POST', { board_id: '900', rows: [], days: DAYS, mapping: { final: 'num_score' } }, tok);
    check(noRows.code === 400, 'בלי שורות — נחסם');
    const noBoard = await j('/examiner/monday/preview', 'POST', {}, tok);
    check(noBoard.code === 400, 'בלי בורד — נחסם');
    // ערך ריק לעולם לא נשלח (היה מוחק תא קיים)
    WRITES.length = 0;
    await j('/examiner/monday/push', 'POST', { board_id: '900', rows: rows, days: DAYS, mapping: { quant: 'num_q' } }, tok);
    const emptySent = WRITES.some((x) => Object.values(x.vals).some((v) => v === '' || v == null));
    check(!emptySent, '⭐ ערך ריק לא נשלח — תא קיים בבורד לא נמחק');

    console.log(fail.length ? `\n❌ ${fail.length} כשלים:\n  - ` + fail.join('\n  - ') : '\n✅ כל הבדיקות עברו');
  } catch (e) {
    console.log('\n❌ שגיאה: ' + (e && e.stack || e));
    fail.push(String(e && e.message));
  } finally {
    app.kill(); fake.close();
    await sleep(300);
  }
  process.exit(fail.length ? 1 : 0);
})();
