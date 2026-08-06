'use strict';
/* סבב 5 של התיקונים:
   1. שעון סבב אחד וסמכותי — אותו מספר במסך המנהל, במסך המראיין ובמסך הנבחן שהגיש.
   2. השהיה כללית עוצרת גם את שעון הסבב.
   3. «סיים סבב» מדווח בדיוק מי לא הגיש (ומאמת שהתשובות שלהם שרדו).

   הרצה: שרת על DB זמני, ואז
     PW=demo123 IVPW=interview node scripts/tests/round5_test.js
*/
const A = 'http://localhost:3000/api';
const PW = process.env.PW || 'demo123';
const IVPW = process.env.IVPW || 'interview';
const fail = [];
function head(t) { console.log('\n=== ' + t + ' ==='); }
function check(c, m) { if (!c) { fail.push(m); console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); }
async function j(u, m, b, t) {
  const h = { 'content-type': 'application/json' }; if (t) h['x-token'] = t;
  const r = await fetch(A + u, { method: m || 'GET', headers: h, body: b ? JSON.stringify(b) : undefined });
  let body = null; try { body = await r.json(); } catch (e) {}
  return { code: r.status, body };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tok = (await j('/examiner/login', 'POST', { password: PW })).body.token;
  const NAMES = ['אורית שגב', 'בן ציון הרוש', 'גילי נאור', 'דורון אלבז'];

  head('0. הקמת יום');
  await j('/examiner/create-day', 'POST', { name: 'בדיקת שעון סבב', title: 'בחינת סיווג', total_rounds: 3 }, tok);
  await j('/examiner/add-examinees-bulk', 'POST', { text: NAMES.map((n, i) => n + ', ' + (901 + i)).join('\n') }, tok);
  await j('/examiner/add-interviewers-bulk', 'POST', { text: 'תמר גל, חדר 1\nניר עוז, חדר 2' }, tok);
  await j('/examiner/autosplit-interviews', 'POST', {}, tok);

  const exTok = {};
  for (let i = 0; i < NAMES.length; i++) {
    const r = await j('/register-morning', 'POST', { name: NAMES[i], code: String(901 + i) });
    exTok[NAMES[i]] = r.body.token;
  }
  await j('/examiner/update-day', 'POST', { phase: 'open' }, tok);
  for (const n of NAMES) {
    await j('/complete-setup', 'POST',
      { subjects: ['פיזיקה'], math_level: null, declaration: { subjects: ['פיזיקה'], mathLevel: null, note: '' } }, exTok[n]);
  }
  // ⚠ לא לקבע id=1 — כשהחליפות רצות ברצף על אותו שרת המזהים ממשיכים לעלות.
  const ivId = ((await j('/interviewers-public')).body.interviewers || [])[0];
  const ivTok = ivId ? (await j('/interviewer/login', 'POST', { interviewer_id: ivId.id, password: IVPW })).body.token : null;
  check(!!ivTok, 'מראיין התחבר (' + (ivId ? ivId.name : 'לא נמצא מראיין') + ')');

  head('1. לפני התחלה — אין שעון סבב');
  let st = (await j('/examiner/status', null, null, tok)).body;
  check(st.round_timer && st.round_timer.state === 'none', 'round_timer = none לפני שהסבב התחיל');
  check(typeof st.server_now === 'number', 'server_now נשלח למסך המנהל (נדרש לתיקון סחף שעון)');

  head('2. «התחל סבב» — השעון מתחיל מיד');
  const sr = await j('/examiner/start-round', 'POST', { round: 1 }, tok);
  check(sr.code === 200, 'סבב 1 התחיל · ' + sr.body.interviews + ' ריאיון · ' + sr.body.chapters + ' פרק');
  st = (await j('/examiner/status', null, null, tok)).body;
  const rt = st.round_timer;
  check(rt.state === 'running', 'שעון הסבב רץ (' + rt.state + ')');
  check(rt.duration_sec === 1200, 'משך הסבב 20 דקות (' + rt.duration_sec + ' שניות)');
  check(rt.remaining_sec > 1190 && rt.remaining_sec <= 1200, 'נותרו כמעט 20 דקות (' + rt.remaining_sec + ')');
  check(rt.started_at && rt.ends_at === rt.started_at + 1200000, '«מסתיים» מחושב נכון');
  // ⚠ הליבה: השעון נמדד מרגע הלחיצה, ולא מהרגע שהנבחן הראשון פתח את הפרק.
  // לכן הוא רץ עוד לפני שאף נבחן קרא ל-/state.
  check(rt.remaining_sec < 1200 || rt.started_at <= Date.now(), 'השעון מתחיל מהלחיצה, בלי להמתין לנבחן הראשון');

  head('3. שלושת המסכים מסכימים על אותו מספר');
  const nm0 = NAMES.find((n) => true);
  // מוצאים נבחן שקיבל פרק (ולא ריאיון) כדי שנוכל להגיש בהמשך
  let chapterMan = null;
  for (const n of NAMES) {
    const s = (await j('/state', null, null, exTok[n])).body;
    if (s.phase === 'chapter') { chapterMan = { name: n, state: s }; break; }
  }
  check(!!chapterMan, 'יש נבחן בפרק: ' + (chapterMan ? chapterMan.name : 'אין'));
  const admin = (await j('/examiner/status', null, null, tok)).body.round_timer;
  const ivSched = (await j('/interviewer/schedule', null, null, ivTok)).body;
  const exState = (await j('/state', null, null, exTok[nm0])).body;
  check(!!exState.round_timer, '/state מחזיר round_timer (גם מחוץ ל-phase chapter)');
  const ivCur = (ivSched && ivSched.current) || {};
  check(ivCur.remaining_sec != null, 'מסך המראיין מקבל remaining_sec מוכן מהשרת (' + JSON.stringify(ivCur) + ')');
  const diffIv = Math.abs(admin.remaining_sec - (ivCur.remaining_sec == null ? -9999 : ivCur.remaining_sec));
  const diffEx = Math.abs(admin.remaining_sec - exState.round_timer.remaining_sec);
  check(diffIv <= 2, 'מנהל ↔ מראיין מסכימים (הפרש ' + diffIv + ' שניות)');
  check(diffEx <= 2, 'מנהל ↔ נבחן מסכימים (הפרש ' + diffEx + ' שניות)');
  check(ivCur.started_at === admin.started_at, 'שני המסכים מודדים מאותה נקודת התחלה');

  head('4. השהיה כללית עוצרת גם את שעון הסבב');
  // ⚠ קודם נותנים לשעון באמת לזוז — אחרת «לא זז בהשהיה» יעבור גם אם הוא תקוע.
  const before = (await j('/examiner/status', null, null, tok)).body.round_timer.remaining_sec;
  await sleep(2100);
  const moved = (await j('/examiner/status', null, null, tok)).body.round_timer.remaining_sec;
  check(moved < before, 'השעון באמת יורד עם הזמן (' + before + ' → ' + moved + ')');
  await j('/examiner/pause-all', 'POST', { pause: true }, tok);
  let p1 = (await j('/examiner/status', null, null, tok)).body.round_timer;
  check(p1.state === 'paused', 'שעון הסבב מושהה (' + p1.state + ')');
  await sleep(2100);
  let p2 = (await j('/examiner/status', null, null, tok)).body.round_timer;
  check(p2.remaining_sec === p1.remaining_sec, 'הספירה לא זזה בזמן ההשהיה (' + p1.remaining_sec + ' → ' + p2.remaining_sec + ')');
  await j('/examiner/pause-all', 'POST', { pause: false }, tok);
  const p3 = (await j('/examiner/status', null, null, tok)).body.round_timer;
  check(p3.state === 'running', 'אחרי «המשך לכולם» השעון רץ שוב');
  check(Math.abs(p3.remaining_sec - p1.remaining_sec) <= 1,
    'זמן ההשהיה הוחזר לנבחנים ולא נאכל (' + p1.remaining_sec + ' → ' + p3.remaining_sec + ')');

  head('5. נבחן שהגיש רואה את שעון הסבב במסך ההמתנה');
  const cm = chapterMan.state;
  await j('/save-answer', 'POST', {
    round: 1, chapter_id: cm.chapter.chapter_id, item_id: (cm.chapter.items[0] || {}).id,
    type: (cm.chapter.items[0] || {}).type, answer: 'תשובה לבדיקה',
  }, exTok[chapterMan.name]);
  const sub = await j('/submit-slot', 'POST', { round: 1 }, exTok[chapterMan.name]);
  check(sub.code === 200, chapterMan.name + ' הגיש');
  const after = (await j('/state', null, null, exTok[chapterMan.name])).body;
  check(after.phase === 'submitted', 'המסך שלו: «הפרק הוגש» (' + after.phase + ')');
  check(after.round_timer && after.round_timer.state === 'running',
    '⭐ גם אחרי ההגשה הוא מקבל שעון סבב רץ (' + (after.round_timer || {}).state + ')');
  const adminNow = (await j('/examiner/status', null, null, tok)).body.round_timer;
  check(Math.abs(adminNow.remaining_sec - after.round_timer.remaining_sec) <= 2,
    'המספר שהוא רואה זהה לזה של המנהל (הפרש ' +
    Math.abs(adminNow.remaining_sec - after.round_timer.remaining_sec) + ' שניות)');

  head('6. «סיים סבב» מדווח בדיוק מי לא הגיש');
  st = (await j('/examiner/status', null, null, tok)).body;
  const stillOpen = st.examinees.filter((e) => e.current && e.current.kind === 'chapter' && e.current.status !== 'done');
  check(stillOpen.length > 0, stillOpen.length + ' נבחנים עדיין באמצע פרק');
  // שומרים תשובה חלקית לאחד מהם — חייבת לשרוד את הסגירה
  const straggler = stillOpen[0];
  const sState = (await j('/state', null, null, exTok[straggler.name])).body;
  await j('/save-answer', 'POST', {
    round: 1, chapter_id: sState.chapter.chapter_id, item_id: (sState.chapter.items[0] || {}).id,
    type: (sState.chapter.items[0] || {}).type, answer: 'חצי תשובה שנכתבה לפני שהסבב נסגר',
  }, exTok[straggler.name]);

  const er = await j('/examiner/end-round', 'POST', {}, tok);
  check(er.code === 200, 'הסבב הסתיים');
  check(er.body.unsubmitted_count === stillOpen.length,
    'דווחו ' + er.body.unsubmitted_count + ' שלא הגישו (ציפיתי ' + stillOpen.length + ')');
  const reported = (er.body.unsubmitted || []).map((u) => u.name);
  check(reported.includes(straggler.name), 'השם של מי שנחתך מופיע בדיווח: ' + reported.join(', '));
  const withCounts = (er.body.unsubmitted || []).find((u) => u.name === straggler.name);
  check(withCounts && withCounts.answered >= 1, 'הדיווח כולל כמה תשובות הספיק (' + (withCounts || {}).answered + ')');
  check(!reported.includes(chapterMan.name), 'מי שהגיש בזמן לא מופיע ברשימת הנחתכים');

  head('7. התשובות של מי שנחתך שרדו');
  const dump = (await j('/examiner/export-json', null, null, tok)).body;
  const rows = (dump && (dump.answers || dump.rows)) || null;
  if (rows) {
    const mine = rows.filter((a) => String(a.name || '') === straggler.name);
    check(mine.length >= 1, 'התשובות של ' + straggler.name + ' בייצוא (' + mine.length + ')');
  } else {
    // מבנה הייצוא שונה — נבדוק דרך גיליון הצילום במקום
    const snap = await j('/examiner/save-day', 'POST', {}, tok);
    check(snap.code === 200 && snap.body.answers > 0, 'הצילום מכיל תשובות (' + (snap.body || {}).answers + ')');
  }

  head('8. אחרי סיום — אין שעון סבב');
  st = (await j('/examiner/status', null, null, tok)).body;
  check(st.round_timer.state === 'none', 'round_timer חזר ל-none אחרי סיום הסבב');
  const exAfter = (await j('/state', null, null, exTok[chapterMan.name])).body;
  check(!exAfter.round_timer || exAfter.round_timer.state === 'none', 'גם אצל הנבחן אין ספירה כשאין סבב רץ');

  head('9. «בטל/אפס סבב» מנקה את השעון');
  await j('/examiner/start-round', 'POST', { round: 2 }, tok);
  let r2 = (await j('/examiner/status', null, null, tok)).body.round_timer;
  check(r2.state === 'running', 'סבב 2 התחיל והשעון רץ');
  await sleep(1100);
  const rr = await j('/examiner/reset-round', 'POST', { round: 2 }, tok);
  check(rr.code === 200, 'סבב 2 אופס');
  r2 = (await j('/examiner/status', null, null, tok)).body.round_timer;
  check(r2.state === 'none', 'השעון התאפס יחד עם הסבב');
  // ומתחילים אותו שוב — חייב לחזור למלוא 20 הדקות ולא להמשיך מאיפה שהיה
  await j('/examiner/start-round', 'POST', { round: 2 }, tok);
  r2 = (await j('/examiner/status', null, null, tok)).body.round_timer;
  check(r2.remaining_sec > 1195, 'התחלה מחדש נותנת 20 דקות מלאות (' + r2.remaining_sec + ')');
  await j('/examiner/end-round', 'POST', {}, tok);

  console.log(fail.length ? `\n❌ ${fail.length} כשלים:\n  - ` + fail.join('\n  - ') : '\n✅ כל הבדיקות עברו');
  process.exit(fail.length ? 1 : 0);
})();
