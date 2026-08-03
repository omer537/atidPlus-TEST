'use strict';
/* בדיקת התיקונים — במיוחד התרחיש שנכשל אצל המשתמש. */
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

  console.log('\n=== 1. יום חדש (במקום prompt) ===');
  const cd = await j('/examiner/create-day', 'POST', { name: 'בדיקת תיקונים', title: 'בחינת סיווג תשפ״ז', total_rounds: 5 }, tok);
  check(cd.code === 200, 'יום נוצר');
  let info = (await j('/day-info')).body;
  check(info.phase === 'registration', 'היום מתחיל בשלב הרשמה');
  check(info.title === 'בחינת סיווג תשפ״ז', 'כותרת הנבחן נשמרה');

  console.log('\n=== 2. באג שמירת מספר הסבבים (התיקון) ===');
  let up = await j('/examiner/update-day', 'POST', { total_rounds: 4, name: 'בדיקת תיקונים', title: 'בחינת סיווג תשפ״ז' }, tok);
  check(up.code === 200, 'update-day עבר');
  info = (await j('/day-info')).body;
  check(info.total_rounds === 4, 'מספר הסבבים התעדכן ל-4 (היה הבאג!) — קיבלתי ' + info.total_rounds);
  check(info.subject_count === 2, 'מקצועות לבחירה = 2');

  console.log('\n=== 3. הזנת נבחנים + מראיינים ===');
  await j('/examiner/add-examinees-bulk', 'POST', { text: 'דנה לוי, 111\nיוסי כהן, 222\nמאיה בר, 333\nרון אמסלם, 444' }, tok);
  await j('/examiner/add-interviewers-bulk', 'POST', { text: 'רות מזרחי, חדר 101\nאבי דגן, חדר 102' }, tok);

  console.log('\n=== 4. חסימת חפיפת מראיין (מראיין אחד = נבחן אחד לסבב) ===');
  let st = (await j('/examiner/status', null, null, tok)).body;
  const [e1, e2] = st.examinees;
  await j('/examiner/assign-interviewer', 'POST', { code: e1.code, round: 1, interviewer_id: 1 }, tok);
  const dup = await j('/examiner/assign-interviewer', 'POST', { code: e2.code, round: 1, interviewer_id: 1 }, tok);
  check(dup.code === 400, 'שיבוץ כפול נחסם: ' + (dup.body.error || 'עבר בטעות!'));

  console.log('\n=== 5. autosplit משבץ גם מראיינים בלי חפיפות ===');
  const as = await j('/examiner/autosplit-interviews', 'POST', {}, tok);
  check(as.code === 200, 'autosplit עבר · ' + JSON.stringify({ assigned: as.body.assigned, with_iv: as.body.with_interviewer, without: as.body.without_interviewer }));
  st = (await j('/examiner/status', null, null, tok)).body;
  check((st.readiness.double_booked || []).length === 0, 'אין חפיפות אחרי autosplit');
  check(st.readiness.all_have_interview, 'לכולם יש סבב ריאיון');

  console.log('\n=== 6. אזהרת קיבולת ===');
  console.log('    קיבולת:', st.readiness.capacity, '| נדרשים:', st.readiness.needed_interviewers, '| יש:', st.readiness.interviewers, '| תקין:', st.readiness.capacity_ok);
  check(st.readiness.capacity != null, 'שדה הקיבולת קיים');

  console.log('\n=== 7. חזרה לשלב הרשמה — לפני התחלה מותר ===');
  let back = await j('/examiner/update-day', 'POST', { phase: 'registration' }, tok);
  check(back.code === 200, 'חזרה מותרת לפני שהתחיל משהו');
  await j('/examiner/update-day', 'POST', { phase: 'open' }, tok);

  console.log('\n=== 8. ⭐ התרחיש שנכשל: ריאיון בלי שבחר מקצועות ===');
  st = (await j('/examiner/status', null, null, tok)).body;
  const solo = st.examinees.find((e) => !e.setup && e.marked_rounds.length);
  check(!!solo, 'יש נבחן בלי מקצועות ועם סבב ריאיון: ' + (solo ? solo.name + ' (סבב ' + solo.marked_rounds[0] + ')' : 'אין'));
  if (solo) {
    const r = solo.marked_rounds[0];
    // מתחילים סבבים עד הסבב שלו
    for (let k = 1; k <= r; k++) {
      const sr = await j('/examiner/start-round', 'POST', { round: k }, tok);
      if (sr.code !== 200) { check(false, 'התחלת סבב ' + k + ' נכשלה: ' + sr.body.error); break; }
      if (k < r) await j('/examiner/end-round', 'POST', {}, tok);
    }
    st = (await j('/examiner/status', null, null, tok)).body;
    const s2 = st.examinees.find((e) => e.code === solo.code);
    check(!!(s2.current && s2.current.kind === 'interview'), 'קיבל משבצת ריאיון בלי מקצועות (הבאג!) — current=' + JSON.stringify(s2.current));
    await j('/examiner/end-round', 'POST', {}, tok);
    st = (await j('/examiner/status', null, null, tok)).body;
    const s3 = st.examinees.find((e) => e.code === solo.code);
    check(s3.interviewed, 'סומן «התראיין ✓» אחרי סיום הסבב (הבאג!)');
  }

  console.log('\n=== 9. חזרה לשלב הרשמה — אחרי התחלה חסום ===');
  back = await j('/examiner/update-day', 'POST', { phase: 'registration' }, tok);
  check(back.code === 400, 'נחסם כמצופה: ' + (back.body.error || 'עבר בטעות!'));

  console.log('\n=== 10. מספר סבבים נעול אחרי שהתחיל ===');
  const lock = await j('/examiner/update-day', 'POST', { total_rounds: 3 }, tok);
  check(lock.code === 400, 'הקטנה נחסמה: ' + (lock.body.error || 'עברה בטעות!'));

  console.log('\n=== 11. בריפים בהדבקה (כולל פסיק בתוך הבריף) ===');
  const bf = await j('/examiner/set-briefs-bulk', 'POST', {
    text: 'דנה לוי | מורה פרטית, חזקה במתמטיקה. לבדוק כיתה גדולה.\nיוסי כהן\tרקע בהנדסה, בלי ניסיון הוראה\nלא קיים | משהו',
  }, tok);
  check(bf.body.updated === 2, 'עודכנו 2 בריפים (קיבלתי ' + bf.body.updated + ')');
  // מבנה חדש: לא-נמצא נשמר כממתין (suggested/unmatched) במקום notFound
  const pend = (bf.body.suggested || []).length + (bf.body.unmatched || []).length;
  check(pend === 1, 'שם לא קיים נשמר לשיוך ידני (' + pend + ')');
  st = (await j('/examiner/status', null, null, tok)).body;
  const dana = st.examinees.find((e) => e.name === 'דנה לוי');
  check(dana.interview_brief.indexOf('חזקה במתמטיקה, לבדוק') >= 0 || dana.interview_brief.indexOf('מורה פרטית, חזקה') >= 0,
    'הפסיק בתוך הבריף נשמר: "' + dana.interview_brief.slice(0, 45) + '…"');

  console.log('\n=== 12. הסרת כל המראיינים ===');
  const rm = await j('/examiner/remove-all-interviewers', 'POST', {}, tok);
  check(rm.code === 200 && rm.body.removed === 2, 'הוסרו ' + rm.body.removed + ' מראיינים');
  st = (await j('/examiner/status', null, null, tok)).body;
  check(st.interviewers.length === 0, 'רשימת המראיינים ריקה');
  // כל שיבוץ מראיין התרוקן (מי שכבר התראיין נשאר «התראיין» — זה נכון)
  const stillAssigned = st.examinees.filter((e) => (e.interview_assign || []).some((a) => a.interviewer_id));
  check(stillAssigned.length === 0, 'אף נבחן לא מצביע יותר על מראיין (נשארו: ' + stillAssigned.map((e) => e.name).join(',') + ')');
  // סימוני הריאיון בסבבים נשמרו
  const stillMarked = st.examinees.filter((e) => (e.marked_rounds || []).length);
  check(stillMarked.length > 0, 'סימוני הריאיון בסבבים נשמרו (' + stillMarked.length + ')');

  console.log('\n=== 13. סגירת יום / פתיחה / הנתונים נגישים ===');
  const days = (await j('/examiner/days', null, null, tok)).body;
  const myDay = days.days.find((d) => d.name === 'בדיקת תיקונים');
  const cl = await j('/examiner/set-day-status', 'POST', { day_id: myDay.id, status: 'closed' }, tok);
  check(cl.code === 200, 'היום נסגר');
  const after = (await j('/examiner/days', null, null, tok)).body.days.find((d) => d.id === myDay.id);
  check(after.status === 'closed', 'מסומן סגור');
  check(after.examinees === 4, 'הנתונים נגישים (4 נבחנים)');
  await j('/examiner/set-day-status', 'POST', { day_id: myDay.id, status: 'open' }, tok);

  console.log(fail.length ? `\n❌ ${fail.length} כשלים:\n  - ` + fail.join('\n  - ') : '\n✅ כל התיקונים עברו');
  process.exit(fail.length ? 1 : 0);
})();
