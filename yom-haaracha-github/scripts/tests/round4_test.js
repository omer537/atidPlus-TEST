'use strict';
/* בדיקת הסבב: בחירת מקצועות בזמן סבב שרץ, חסימת יום סגור, ארכיון. */
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

  console.log('\n=== הכנה ===');
  await j('/examiner/create-day', 'POST', { name: 'בדיקת סבב 4', title: 'בחינת סיווג תשפ״ז', total_rounds: 4 }, tok);
  await j('/examiner/add-examinees-bulk', 'POST', { text: 'דנה לוי, 111\nיוסי כהן, 222\nמאיה בר, 333' }, tok);
  await j('/examiner/add-interviewers-bulk', 'POST', { text: 'רות מזרחי, חדר 101' }, tok);
  // כולם נרשמים בבוקר
  const toks = {};
  for (const [n, c] of [['דנה לוי', '111'], ['יוסי כהן', '222'], ['מאיה בר', '333']]) {
    const r = await j('/register-morning', 'POST', { name: n, code: c });
    toks[n] = r.body.token;
  }
  await j('/examiner/update-day', 'POST', { phase: 'open' }, tok);

  console.log('\n=== 1. ⭐ הבאג: נבחן בוחר מקצועות *בזמן שהסבב רץ* ===');
  // דנה בוחרת מקצועות לפני; יוסי ומאיה עדיין לא
  await j('/complete-setup', 'POST', { subjects: ['מתמטיקה', 'לשון'], math_level: '4', declaration: {} }, toks['דנה לוי']);
  const sr = await j('/examiner/start-round', 'POST', { round: 1 }, tok);
  console.log('    התחלת סבב 1:', JSON.stringify({ chapters: sr.body.chapters, interviews: sr.body.interviews, no_subjects: sr.body.no_subjects }));
  check((sr.body.no_subjects || []).length >= 1, 'השרת מדווח מי טרם בחר מקצועות (' + (sr.body.no_subjects || []).join(', ') + ')');

  // עכשיו יוסי בוחר — בזמן שהסבב כבר רץ
  const cs = await j('/complete-setup', 'POST', { subjects: ['אנגלית', 'היסטוריה'], math_level: null, declaration: {} }, toks['יוסי כהן']);
  check(cs.code === 200, 'יוסי השלים בחירת מקצועות בזמן הסבב');
  const st1 = (await j('/state', null, null, toks['יוסי כהן'])).body;
  console.log('    מצב יוסי מיד אחרי הבחירה:', st1.phase, st1.chapter ? '· פרק: ' + (st1.chapter.subject || st1.chapter.chapter_id) : '');
  check(st1.phase === 'chapter' && !!st1.chapter, 'יוסי קיבל פרק **מיד** ולא ממתין לסבב הבא (הבאג תוקן!)');

  console.log('\n=== 2. אותו דבר למי שמסומן לריאיון ===');
  // מסמנים את מאיה לריאיון בסבב הרץ ואז היא בוחרת
  const s0 = (await j('/examiner/status', null, null, tok)).body;
  const maya = s0.examinees.find((e) => e.name === 'מאיה בר');
  await j('/examiner/mark-interview', 'POST', { code: maya.code, round: 2, on: true }, tok);
  const cs2 = await j('/complete-setup', 'POST', { subjects: ['ביולוגיה', 'לשון'], math_level: null, declaration: {} }, toks['מאיה בר']);
  check(cs2.code === 200, 'מאיה השלימה בחירה');
  const st2 = (await j('/state', null, null, toks['מאיה בר'])).body;
  check(st2.phase === 'chapter', 'מאיה קיבלה פרק בסבב הרץ (הריאיון שלה בסבב 2)');

  console.log('\n=== 3. סגירת יום חוסמת נבחנים ===');
  // עונים משהו כדי שיהיה מה לצלם
  for (const nm of Object.keys(toks)) {
    const s = (await j('/state', null, null, toks[nm])).body;
    if (s.phase === 'chapter' && s.chapter) {
      const it = (s.chapter.items || []).find((x) => x.type === 'mc_apply');
      if (it && it.options) await j('/save-answer', 'POST', { round: 1, chapter_id: s.chapter.chapter_id, item_id: it.id, type: it.type, answer: it.options[0].id }, toks[nm]);
    }
  }
  const sv = await j('/examiner/save-day', 'POST', {}, tok);
  check(sv.code === 200, 'סגור יום ושלח לבדיקה עבר · ' + JSON.stringify({ ex: sv.body.examinees, ans: sv.body.answers }));

  // נבחן קיים מנסה להירשם מחדש
  const again = await j('/register-morning', 'POST', { name: 'דנה לוי', code: '111' });
  check(again.code === 403, 'הרשמה מחדש נחסמה (403): ' + (again.body.error || 'עברה בטעות!'));
  // נבחן חדש מנסה להירשם
  const brandNew = await j('/register-morning', 'POST', { name: 'מישהו חדש', code: '999' });
  check(brandNew.code === 403, 'נבחן חדש נחסם גם כן');
  // מי שמחובר — נעצר
  const stEnd = (await j('/state', null, null, toks['דנה לוי'])).body;
  check(stEnd.phase === 'ended', 'מי שמחובר רואה מסך סיום (' + stEnd.phase + ')');
  // login מחזיר מסך סיום ולא תהליך הרשמה
  const lg = await j('/login', 'POST', { name: 'דנה לוי', code: '111' });
  check(lg.code === 200 && lg.body.state.phase === 'ended', 'login מחזיר מסך סיום');

  console.log('\n=== 4. ארכיון: ימים סגורים + has_snapshot ===');
  const days = (await j('/examiner/days', null, null, tok)).body;
  const closed = days.days.filter((d) => d.status === 'closed');
  check(closed.length >= 1, 'יש ' + closed.length + ' ימים סגורים');
  const mine = closed.find((d) => d.name === 'בדיקת סבב 4');
  check(!!(mine && mine.has_snapshot), 'היום שלי מסומן שיש לו צילום בדיקה');

  console.log('\n=== 5. הורדת Excel של כל הימים הסגורים ===');
  const r2 = await fetch(A + '/examiner/export-excel?all_closed=1', { headers: { 'x-token': tok } });
  check(r2.ok, 'ההורדה החזירה 200');
  const buf = Buffer.from(await r2.arrayBuffer());
  check(buf.length > 2000, 'הקובץ לא ריק (' + buf.length + ' בתים)');
  const fs = require('fs');
  fs.writeFileSync('/tmp/all-closed.xlsx', buf);
  const XLSX = require('/Users/gunr/Desktop/מבחנים ליום הערכה/app/node_modules/xlsx');
  const wb = XLSX.readFile('/tmp/all-closed.xlsx');
  console.log('    גיליונות:', wb.SheetNames.join(' | '));
  check(wb.SheetNames.length === closed.length, 'גיליון לכל יום סגור (' + wb.SheetNames.length + '/' + closed.length + ')');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  check(rows.length > 1, 'הגיליון הראשון מכיל נתונים (' + (rows.length - 1) + ' שורות)');

  console.log(fail.length ? `\n❌ ${fail.length} כשלים:\n  - ` + fail.join('\n  - ') : '\n✅ כל הבדיקות עברו');
  process.exit(fail.length ? 1 : 0);
})();
