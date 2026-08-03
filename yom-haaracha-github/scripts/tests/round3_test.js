'use strict';
/* בדיקת הסבב: בקרת בריפים, exam_ended פר-יום, שמור יום, אינדיקציה. */
const A = 'http://localhost:3000/api';
const fail = [];
function check(c, m) { if (!c) { fail.push(m); console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); }
async function j(u, m, b, t) {
  const h = { 'content-type': 'application/json' }; if (t) h['x-token'] = t;
  const r = await fetch(A + u, { method: m || 'GET', headers: h, body: b ? JSON.stringify(b) : undefined });
  let body = null; try { body = await r.json(); } catch (e) {}
  return { code: r.status, body };
}
(async () => {
  const tok = (await j('/examiner/login', 'POST', { password: 'demo123' })).body.token;

  console.log('\n=== הכנה: יום + נבחנים ===');
  await j('/examiner/create-day', 'POST', { name: 'בדיקת בריפים', title: 'בחינת סיווג תשפ״ז', total_rounds: 4 }, tok);
  await j('/examiner/add-examinees-bulk', 'POST', {
    text: 'דנה לוי, 111\nיוסי כהן, 222\nמאיה שרה בר, 333\nרון אמסלם, 444\nנועה פרץ, 555',
  }, tok);
  await j('/examiner/add-interviewers-bulk', 'POST', { text: 'רות מזרחי, חדר 101\nאבי דגן, חדר 102' }, tok);

  console.log('\n=== 1. ⭐ הדבקת בריפים עם השמות המעוותים ===');
  const paste = [
    'דנה לוי | מורה פרטית, חזקה במתמטיקה. לבדוק כיתה גדולה.',   // מדויק
    "יוסי כהנ | רקע בהנדסה, בלי ניסיון הוראה.",                  // אות סופית
    'מאיה בר | סטודנטית לחינוך, מנוסה בהדרכה.',                  // בלי שם אמצעי
    'רן אמסלם | עבד בצופים.',                                     // טעות הקלדה
    'משה כוכבי | לא נרשם בכלל.',                                  // לא קיים
    'דנה לוי | שורה שנייה לאותו נבחן.',                            // כפילות
  ].join('\n');
  const bf = await j('/examiner/set-briefs-bulk', 'POST', { text: paste }, tok);
  console.log('    שויכו:', bf.body.updated, '| להצעה:', (bf.body.suggested || []).length, '| ללא התאמה:', (bf.body.unmatched || []).length, '| כפילויות:', (bf.body.duplicates || []).length);
  check(bf.body.updated === 2, 'שני מדויקים שויכו אוטומטית (דנה ×2)');
  check((bf.body.suggested || []).length === 3, '3 שמות דומים הוצעו ולא שויכו אוטומטית (קיבלתי ' + (bf.body.suggested || []).length + ')');
  check((bf.body.unmatched || []).length === 1, 'שם לא קיים נשמר כממתין ללא התאמה');
  check((bf.body.duplicates || []).length === 1, 'כפילות דווחה');
  const sugNames = (bf.body.suggested || []).map((x) => x.raw_name + '→' + ((x.suggestions[0] || {}).name || '?') + '(' + ((x.suggestions[0] || {}).confidence || '') + ')');
  console.log('    הצעות:', sugNames.join(' · '));

  console.log('\n=== 2. תמונת מצב הבריפים ===');
  let st = (await j('/examiner/briefs-status', null, null, tok)).body;
  console.log('    יש בריף:', st.with_brief, '| אין:', st.without_brief, '| ממתינים:', st.pending.length);
  check(st.with_brief === 1, 'לנבחן אחד יש בריף (דנה)');
  check(st.pending.length === 4, '4 ממתינים לשיוך (קיבלתי ' + st.pending.length + ')');
  const p1 = st.pending.find((p) => p.raw_name === 'יוסי כהנ');
  check(!!(p1 && p1.suggestions[0] && p1.suggestions[0].name === 'יוסי כהן'), 'ההצעה ל«יוסי כהנ» היא «יוסי כהן»');
  check(!!(p1 && p1.suggestions[0].confidence === 'high'), 'ביטחון גבוה על הבדל אות סופית');

  console.log('\n=== 3. שיוך מהיר בקליק ===');
  const before = st.with_brief;
  for (const p of st.pending) {
    const best = p.suggestions[0];
    if (best) await j('/examiner/assign-pending-brief', 'POST', { pending_id: p.pending_id, code: best.code }, tok);
  }
  st = (await j('/examiner/briefs-status', null, null, tok)).body;
  console.log('    אחרי שיוך — יש בריף:', st.with_brief, '| ממתינים:', st.pending.length);
  check(st.with_brief === before + 3, 'שלושת המוצעים שויכו בקליק');
  check(st.pending.length === 1, 'נשאר רק ה«לא קיים» (צריך מחיקה ידנית)');

  console.log('\n=== 4. הבריף מגיע למראיין ===');
  await j('/examiner/autosplit-interviews', 'POST', {}, tok);
  const s2 = (await j('/examiner/status', null, null, tok)).body;
  const yossi = s2.examinees.find((e) => e.name === 'יוסי כהן');
  check(!!(yossi && yossi.interview_brief.indexOf('הנדסה') >= 0), 'הבריף של יוסי נשמר: "' + (yossi ? yossi.interview_brief.slice(0, 32) : '') + '…"');

  console.log('\n=== 5. exam_ended פר-יום (הבאג) ===');
  await j('/examiner/update-day', 'POST', { phase: 'open' }, tok);
  await j('/examiner/end-exam', 'POST', { ended: true }, tok);
  let es = (await j('/examiner/exam-state', null, null, tok)).body;
  check(es.ended === true, 'היום הנוכחי מסומן «הסתיים»');
  const days = (await j('/examiner/days', null, null, tok)).body;
  const other = days.days.find((d) => d.id !== days.active_day_id);
  if (other) {
    await j('/examiner/set-active-day', 'POST', { day_id: other.id }, tok);
    es = (await j('/examiner/exam-state', null, null, tok)).body;
    check(es.ended === false, 'יום אחר *לא* מסומן «הסתיים» (הבאג תוקן!)');
    await j('/examiner/set-active-day', 'POST', { day_id: days.active_day_id }, tok);
    es = (await j('/examiner/exam-state', null, null, tok)).body;
    check(es.ended === true, 'חזרה ליום המקורי — עדיין «הסתיים»');
  }

  console.log('\n=== 6. הודעת סיום ניתנת לעריכה ===');
  await j('/examiner/update-day', 'POST', { finish_message: 'סיימתם! נא לעבור לאולם הכינוס בקומה 2.' }, tok);
  const lg = await j('/login', 'POST', { name: 'דנה לוי', code: '111' });
  const exState = (await j('/state', null, null, lg.body.token)).body;
  check(exState.phase === 'ended', 'הנבחנת רואה מסך סיום');
  check(exState.message.indexOf('אולם הכינוס') >= 0, 'רואה את הנוסח שערכתי: "' + exState.message + '"');

  console.log('\n=== 7. מה נשמר — לפני «שמור יום» ===');
  await j('/examiner/end-exam', 'POST', { ended: false }, tok);
  let ds = (await j('/examiner/day-saves', null, null, tok)).body;
  console.log('    חי:', ds.live.examinees, 'נבחנים ·', ds.live.answers, 'תשובות | צילום ראשי:', ds.primary ? 'קיים' : 'אין');
  check(ds.primary === null, 'לפני השמירה אין צילום ראשי');

  console.log('\n=== 8. יוצרים תשובות ואז «שמור יום» ===');
  // א) קודם כולם בוחרים מקצועות (אחרת אין להם פרק ולא ייווצרו תשובות)
  const s3 = (await j('/examiner/status', null, null, tok)).body;
  const toks = {};
  for (const e of s3.examinees) {
    const l = await j('/login', 'POST', { name: e.name, code: e.pin });
    if (!l.body.token) continue;
    toks[e.name] = l.body.token;
    if (!e.setup) await j('/complete-setup', 'POST', { subjects: ['מתמטיקה', 'לשון'], math_level: '4', declaration: {} }, l.body.token);
  }
  // ב) ואז מתחילים סבב
  const sr = await j('/examiner/start-round', 'POST', { round: 1 }, tok);
  console.log('    התחלת סבב 1:', sr.code, JSON.stringify(sr.body).slice(0, 60));
  // ג) ועונים
  let answered = 0;
  for (const nm of Object.keys(toks)) {
    const stt = (await j('/state', null, null, toks[nm])).body;
    if (stt.phase === 'chapter' && stt.chapter) {
      const it = (stt.chapter.items || []).find((x) => x.type === 'mc_apply');
      if (it && it.options) {
        await j('/save-answer', 'POST', { round: 1, chapter_id: stt.chapter.chapter_id, item_id: it.id, type: it.type, answer: it.options[0].id }, toks[nm]);
        answered++;
      }
    }
  }
  console.log('    ענו:', answered, 'נבחנים');
  check(answered > 0, 'נוצרו תשובות לפני השמירה');
  const sv = await j('/examiner/save-day', 'POST', {}, tok);
  console.log('    תוצאה:', sv.code, JSON.stringify({ cohort: sv.body.cohort_id, ex: sv.body.examinees, ans: sv.body.answers, teach: sv.body.teachItems }));
  check(sv.code === 200, 'שמור יום עבר');
  check(sv.body.examinees > 0 && sv.body.answers > 0, 'הצילום מכיל נבחנים ותשובות');

  ds = (await j('/examiner/day-saves', null, null, tok)).body;
  check(!!ds.primary, 'קיים עכשיו צילום ראשי');
  check(ds.day.status === 'closed', 'היום נסגר לארכיון');
  check(ds.day.exam_ended === true, 'המבחן מסומן כהסתיים');
  console.log('    צילום ראשי:', ds.primary && ds.primary.name, '·', ds.primary && ds.primary.examinees, 'נבחנים ·', ds.primary && ds.primary.answers, 'תשובות');

  console.log('\n=== 9. הצילום שורד מחיקת היום ===');
  const cohortId = sv.body.cohort_id;
  const dayId = ds.day.id;
  const del = await j('/examiner/delete-day', 'POST', { day_id: dayId }, tok);
  check(del.code === 200, 'היום נמחק');
  const coh = (await j('/examiner/grading/cohorts', null, null, tok)).body;
  const still = (coh.cohorts || []).find((c) => c.id === cohortId);
  check(!!still, 'הצילום לבדיקה עדיין קיים אחרי מחיקת היום ✓');
  const rev = await j('/examiner/grading/cohort/' + cohortId, null, null, tok);
  check(rev.code === 200 && (rev.body.examinees || []).length > 0, 'אפשר לפתוח אותו במסך הבדיקה (' + ((rev.body.examinees || []).length) + ' נבחנים)');

  console.log(fail.length ? `\n❌ ${fail.length} כשלים:\n  - ` + fail.join('\n  - ') : '\n✅ כל הבדיקות עברו');
  process.exit(fail.length ? 1 : 0);
})();
