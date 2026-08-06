'use strict';
/* מסלול הבדיקה והציונים:
   1. מלכודת מצב ההדגמה — חסימה, סימון במסד, ובדיקה מחדש.
   2. פריט שנכשל לא יכול «להיסגר» בלי ציון ידני.
   3. תיקון שם בתוך מחזור (חוסם התאמה למאנדיי).
   4. «ייצוא למאנדיי» — אותן שורות, באותו סדר, מספרים בלבד.

   ⚠ רץ בכוונה *בלי* מפתח API — אין כאן שום קריאה בתשלום.
   הרצה: PW=demo123 node scripts/tests/grade_flow_test.js
*/
const A = 'http://localhost:3000/api';
const PW = process.env.PW || 'demo123';
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
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('⚠ ANTHROPIC_API_KEY מוגדר — החליפה הזו חייבת לרוץ בלעדיו (היא בודקת את מצב ההדגמה).');
    process.exit(1);
  }
  const tok = (await j('/examiner/login', 'POST', { password: PW })).body.token;
  // ⚠ שמות ייחודיים לחליפה הזו. חליפות אחרות משאירות מחזורים על אותו שרת,
  // ו-monday-match מחפש בכל המחזורים — שם שחוזר בשניים נחשב «מעורפל» בצדק.
  const NAMES = ['נעמה בן-דוד', 'איתי שרעבי', 'ליאור אזולאי', '0549713038'];

  head('0. יום עם תשובות אמיתיות → צילום לבדיקה');
  await j('/examiner/create-day', 'POST', { name: 'בדיקת ציונים', title: 'בחינת סיווג', total_rounds: 3 }, tok);
  await j('/examiner/add-examinees-bulk', 'POST', { text: NAMES.map((n, i) => n + ', ' + (801 + i)).join('\n') }, tok);
  await j('/examiner/add-interviewers-bulk', 'POST', { text: 'תמר גל, חדר 1\nניר עוז, חדר 2' }, tok);
  await j('/examiner/autosplit-interviews', 'POST', {}, tok);
  const exTok = {};
  for (let i = 0; i < NAMES.length; i++) {
    exTok[NAMES[i]] = (await j('/register-morning', 'POST', { name: NAMES[i], code: String(801 + i) })).body.token;
  }
  await j('/examiner/update-day', 'POST', { phase: 'open' }, tok);
  for (const n of NAMES) {
    await j('/complete-setup', 'POST',
      { subjects: ['פיזיקה'], math_level: null, declaration: { subjects: ['פיזיקה'], mathLevel: null, note: '' } }, exTok[n]);
  }
  // שני סבבים, כדי שיהיו גם תשובות «למד» וגם פרק «מידע כללי»
  for (let r = 1; r <= 2; r++) {
    await j('/examiner/start-round', 'POST', { round: r }, tok);
    for (const n of NAMES) {
      const s = (await j('/state', null, null, exTok[n])).body;
      if (s.phase !== 'chapter') continue;
      for (const it of (s.chapter.items || [])) {
        const isText = it.type === 'text_teach' || it.type === 'text_teach_error';
        const ans = isText
          ? 'הייתי מסביר לתלמידה בצעדים קטנים, עם דוגמה מהחיים, ומוודא שהיא מבינה את השורש של הטעות ולא רק את הכלל.'
          : (it.options && it.options.length ? it.options[0].id : '');
        if (ans) await j('/save-answer', 'POST', { round: r, chapter_id: s.chapter.chapter_id, item_id: it.id, type: it.type, answer: ans }, exTok[n]);
      }
      await j('/submit-slot', 'POST', { round: r }, exTok[n]);
    }
    await j('/examiner/end-round', 'POST', {}, tok);
  }
  const snap = await j('/examiner/grading/snapshot', 'POST', { name: 'מחזור בדיקה' }, tok);
  const CID = snap.body.cohort_id;
  check(snap.code === 200 && CID, 'נוצר מחזור בדיקה #' + CID + ' · ' + snap.body.teachItems + ' תשובות «למד»');
  check(snap.body.teachItems > 0, 'יש תשובות רב-מלל לבדוק');

  head('1. ⭐ הרצה בלי מפתח API נחסמת');
  const blocked = await j('/examiner/grading/run-ai', 'POST', { cohort_id: CID }, tok);
  check(blocked.code === 400 && blocked.body.demo_block === true, 'run-ai נחסם עם demo_block (' + blocked.code + ')');
  let coh = (await j('/examiner/grading/cohort/' + CID, null, null, tok)).body;
  check(coh.examinees.every((e) => e.aiDone === 0), 'לא נכתב שום ציון — החסימה קדמה ליצירת ה-job');

  head('2. אישור מפורש → רץ, והציונים מסומנים כהדגמה');
  const started = await j('/examiner/grading/run-ai', 'POST', { cohort_id: CID, confirm_demo: true }, tok);
  check(started.code === 200 && started.body.started, 'רץ אחרי confirm_demo · ' + started.body.total + ' פריטים');
  for (let i = 0; i < 60; i++) {
    const p = (await j('/examiner/grading/progress/' + CID, null, null, tok)).body;
    if (!p.running) break;
    await sleep(300);
  }
  coh = (await j('/examiner/grading/cohort/' + CID, null, null, tok)).body;
  check(coh.demoItems === snap.body.teachItems,
    '⭐ כל ' + coh.demoItems + ' הפריטים מסומנים ai_demo=1 (מתוך ' + snap.body.teachItems + ')');
  const homeList = (await j('/examiner/grading/cohorts', null, null, tok)).body.cohorts.find((c) => c.id === CID);
  check(homeList && homeList.demoItems > 0, 'גם רשימת המחזורים מדווחת על ציוני הדגמה');

  head('3. ⭐ «בדוק מחדש ציוני הדגמה» — המסלול שלא היה קיים');
  const redo = await j('/examiner/grading/run-ai', 'POST', { cohort_id: CID, only_demo: true, confirm_demo: true }, tok);
  check(redo.code === 200 && redo.body.total === coh.demoItems,
    'only_demo בוחר בדיוק את פריטי ההדגמה (' + redo.body.total + ')');
  for (let i = 0; i < 60; i++) {
    const p = (await j('/examiner/grading/progress/' + CID, null, null, tok)).body;
    if (!p.running) break;
    await sleep(300);
  }
  // לשם השוואה: המסלול הרגיל *לא* היה מוצא אותם (זו הייתה המלכודת)
  const normal = await j('/examiner/grading/run-ai', 'POST', { cohort_id: CID, confirm_demo: true }, tok);
  check(normal.body.nothing === true, 'המסלול הרגיל אכן מדלג עליהם (זו הייתה המלכודת המקורית)');

  head('4. ⭐ פריט שנכשל — לא נסגר בלי ציון ידני');
  const sheetBefore = (await j('/examiner/grading/sheet/' + CID, null, null, tok)).body;
  const victim = sheetBefore.rows.find((r) => r.teachTotal > 0);
  check(!!victim, 'יש נבחן עם תשובות «למד»: ' + (victim ? victim.name : 'אין'));
  const rev = (await j('/examiner/grading/examinee/' + CID + '/' + encodeURIComponent(victim.code), null, null, tok)).body;
  let target = null;
  (rev.chapters || []).forEach((ch) => (ch.items || []).forEach((it) => { if (!target && it.teach) target = { ch: ch.chapter_id, it: it.item_id }; }));
  check(!!target && !!target.it, 'נמצא פריט «למד» לבדיקה');

  const okApprove = await j('/examiner/grading/item', 'POST',
    { cohort_id: CID, code: victim.code, chapter_id: target.ch, item_id: target.it, approve: true }, tok);
  check(okApprove.code === 200 && okApprove.body.status === 'approved', 'פריט שנבדק בהצלחה מתאשר כרגיל');

  // ⚠ אין API שמפיל פריט — מפילים אותו ישירות במסד, כי זה בדיוק המצב שגרם
  // לנבחן להיתקע ב«טרם נבדק» לנצח בלי שום חיווי.
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(process.env.DB_PATH || '/tmp/gf.db');
  raw.prepare("UPDATE grading_items SET ai_status='failed', human_scores_json=NULL, status='pending' WHERE cohort_id=? AND code=? AND chapter_id=? AND item_id=?")
    .run(CID, victim.code, target.ch, target.it);
  raw.close();

  const badApprove = await j('/examiner/grading/item', 'POST',
    { cohort_id: CID, code: victim.code, chapter_id: target.ch, item_id: target.it, approve: true }, tok);
  check(badApprove.code === 400 && badApprove.body.needs_manual_score === true,
    '⭐ אישור פריט שנכשל בלי ציון נחסם (' + badApprove.code + ')');

  // הגיליון חייב להסביר *למה* הנבחן תקוע
  const stuckSheet = (await j('/examiner/grading/sheet/' + CID, null, null, tok)).body;
  const stuckRow = stuckSheet.rows.find((r) => r.code === victim.code);
  check(stuckRow && stuckRow.pending, 'הנבחן מסומן «טרם נבדק»');
  check(stuckRow && /נכשל/.test(stuckRow.pendingReason || ''),
    '⭐ הגיליון מסביר את הסיבה: "' + (stuckRow && stuckRow.pendingReason) + '"');

  // נעילה לא «מבריחה» אותו — היא לא מאשרת פריט שנכשל
  const lk = await j('/examiner/grading/lock', 'POST', { cohort_id: CID, code: victim.code, locked: true }, tok);
  check(lk.code === 200 && lk.body.stuck_failed === 1, 'נעילה מדווחת על 1 פריט תקוע במקום להסתיר אותו');

  // ציון ידני משחרר אותו
  const fixed = await j('/examiner/grading/item', 'POST',
    { cohort_id: CID, code: victim.code, chapter_id: target.ch, item_id: target.it, scores: { accuracy: 3, depth: 3, diagnosis_fit: 3, clarity: 3 } }, tok);
  check(fixed.code === 200, 'ציון ידני נשמר');
  const freedSheet = (await j('/examiner/grading/sheet/' + CID, null, null, tok)).body;
  const freed = freedSheet.rows.find((r) => r.code === victim.code);
  check(freed && !freed.pending, '⭐ אחרי הציון הידני הנבחן יצא מ«טרם נבדק» ויש לו ציון ' + (freed && freed.final));

  head('5. תיקון שם בתוך המחזור (חוסם התאמה למאנדיי)');
  const phone = sheetBefore.rows.find((r) => r.name === '0549713038');
  check(!!phone, 'יש נבחן שנרשם עם מספר טלפון');
  const ren = await j('/examiner/grading/examinee-flags', 'POST',
    { cohort_id: CID, code: phone.code, name: 'רות מזרחי' }, tok);
  check(ren.code === 200 && ren.body.name === 'רות מזרחי', 'השם תוקן');
  const empty = await j('/examiner/grading/examinee-flags', 'POST', { cohort_id: CID, code: phone.code, name: '   ' }, tok);
  check(empty.code === 400, 'שם ריק נחסם');
  const sheetAfter = (await j('/examiner/grading/sheet/' + CID, null, null, tok)).body;
  check(sheetAfter.rows.some((r) => r.name === 'רות מזרחי'), 'השם החדש מופיע בגיליון');
  check(!sheetAfter.rows.some((r) => r.name === '0549713038'), 'השם הישן נעלם');

  head('6. ⭐ ייצוא למאנדיי — אותן שורות, באותו סדר');
  // סדר מכוון־שונה מסדר הגיליון (שממוין לפי ציון יורד), + שורה ריקה, +
  // שם עם גרשיים, + שם שלא קיים.
  const paste = ['ליאור אזולאי', 'לא קיים בכלל', 'רות מזרחי', '', 'נעמה בן-דוד', 'איתי שרעבי'];
  // ⚠ מוגבל למחזור הזה, אחרת חליפות אחרות (או הרצה שנייה של החליפה הזו)
  // יוצרות שמות כפולים והכול הופך «מעורפל». את המקרה הזה בודקים בסעיף 9.
  const mm = await j('/examiner/grading/monday-match', 'POST', { names: paste, cohorts: [CID] }, tok);
  check(mm.code === 200, 'ההתאמה עברה');
  check(mm.body.rows.length === paste.length,
    '⭐ בדיוק ' + paste.length + ' שורות חזרו (קיבלתי ' + mm.body.rows.length + ') — היישור נשמר');
  check(mm.body.rows.map((r) => r.raw).join('|') === paste.map((s) => s.trim()).join('|'), 'הסדר זהה לסדר הקלט');
  check(mm.body.rows[0].matched && mm.body.rows[0].matched.name === 'ליאור אזולאי', 'שורה 1 הותאמה');
  const missing = mm.body.rows[1];
  check(!missing.matched, 'שם שלא קיים לא הותאם');
  check(missing.values.final === null && missing.values.ravMelel === null &&
    missing.values.quant === null && missing.values.english === null,
    '⭐ שורה שלא הותאמה חוזרת עם 4 ערכי null (תאים ריקים, לא טקסט)');
  check(mm.body.rows[3].blank === true, 'שורה ריקה מסומנת blank ונשמרת במקומה');
  check(mm.body.rows[2].matched && mm.body.rows[2].matched.name === 'רות מזרחי', 'השם המתוקן נמצא');
  check(mm.body.matched === 4 && mm.body.unmatched === 1 && mm.body.blank === 1,
    'הסיכום נכון: ' + mm.body.matched + ' הותאמו · ' + mm.body.unmatched + ' לא נמצאו · ' + mm.body.blank + ' ריקות');
  check(JSON.stringify(mm.body.columns) === JSON.stringify(['ציון', 'רב-מלל', 'כמותי', 'אנגלית']),
    'ארבע העמודות שהוסכמו, בסדר הנכון');
  // אף ערך אינו מחרוזת «טרם נבדק» — עמודת Number במאנדיי דוחה טקסט
  const anyText = mm.body.rows.some((r) => Object.keys(r.values).some((k) => typeof r.values[k] === 'string'));
  check(!anyText, '⭐ אין אף ערך טקסטואלי בארבע העמודות');

  head('7. התאמה מקורבת — מציעה, לא מכריעה');
  const fuzzy = await j('/examiner/grading/monday-match', 'POST', { names: ['נעמה בן-דוד כהן לוי', 'ליאור אזולאיi'], cohorts: [CID] }, tok);
  check(!fuzzy.body.rows[0].matched, 'שם עם תוספת לא משויך אוטומטית');
  check(fuzzy.body.rows[1].suggestions.length > 0, 'שם עם טעות הקלדה מקבל הצעה (' +
    (fuzzy.body.rows[1].suggestions[0] || {}).reason + ')');
  const key = (fuzzy.body.rows[1].suggestions[0] || {}).key;
  check(!!key, 'להצעה יש מפתח לשליפה ישירה');
  const byKey = await j('/examiner/grading/monday-match', 'POST', { keys: [key], cohorts: [CID] }, tok);
  check(byKey.code === 200 && byKey.body.values && byKey.body.values[key],
    '⭐ שליפה לפי מפתח עובדת (זה מה שמאפשר בחירה ידנית משם מעורפל)');

  head('8. ייצוא ממוין לפי שם');
  const byName = await fetch(A + '/examiner/grading/export-sheet/' + CID + '?sort=name', { headers: { 'x-token': tok } });
  check(byName.status === 200 && Number(byName.headers.get('content-length') || 1) > 2000, 'sort=name מחזיר קובץ תקין');
  const dflt = await fetch(A + '/examiner/grading/export-sheet/' + CID, { headers: { 'x-token': tok } });
  check(dflt.status === 200, 'בלי הפרמטר — ההתנהגות הישנה נשמרת');

  head('9. ⭐ אותו שם בשני מחזורים — מציע, לא מכריע');
  // המצב האמיתי: אותה מועמדת הגיעה לשני ימי הערכה.
  // ⚠ לא «לצלם שוב» את אותו יום — `insertCohortRows` מזהה חתימת תוכן זהה
  // ו*ממחזר* את המחזור הקיים (reused:true), כך שלא נוצר מחזור שני בכלל.
  const rev0 = (await j('/examiner/grading/examinee/' + CID + '/' + encodeURIComponent(victim.code), null, null, tok)).body;
  const someCh = (rev0.chapters || [])[0] || {};
  const someIt = (someCh.items || [])[0] || {};
  const snap2 = await j('/examiner/grading/import', 'POST', {
    name: 'יום אחר', day_label: 'יום אחר',
    data: { examinees: [{ examinee: 'איתי שרעבי', code: 'other1', subjects: ['פיזיקה'],
      answers: [{ chapter_id: someCh.chapter_id, item_id: someIt.item_id, type: someIt.type, answer: 'תשובה מיום אחר', updated_at: 1 }] }] },
  }, tok);
  check(snap2.code === 200 && snap2.body.cohort_id !== CID,
    'נוצר מחזור *שני ונפרד* עם אותו שם (#' + snap2.body.cohort_id + ' ≠ #' + CID + ')');
  const PAIR = [CID, snap2.body.cohort_id];
  const dup = await j('/examiner/grading/monday-match', 'POST', { names: ['איתי שרעבי'], cohorts: PAIR }, tok);
  check(!dup.body.rows[0].matched, '⭐ שם שקיים בשני מחזורים לא משויך אוטומטית');
  check(dup.body.rows[0].suggestions.length === 2, 'שתי ההצעות מוצגות (' + dup.body.rows[0].suggestions.length + ')');
  check(dup.body.rows[0].ambiguous === true, 'מסומן ambiguous');
  // המשתמש בוחר — והשליפה לפי מפתח מחזירה את הנבחן הנכון
  const chosen = dup.body.rows[0].suggestions[0].key;
  const resolved = await j('/examiner/grading/monday-match', 'POST', { keys: [chosen], cohorts: PAIR }, tok);
  check(resolved.body.values[chosen] && resolved.body.values[chosen].name === 'איתי שרעבי',
    '⭐ הבחירה הידנית נפתרת לפי מפתח, גם כששני המחזורים חולקים שם');
  // הגבלה למחזור אחד מחזירה שיוך חד-משמעי
  const scoped = await j('/examiner/grading/monday-match', 'POST', { names: ['איתי שרעבי'], cohorts: [CID] }, tok);
  check(scoped.body.rows[0].matched && scoped.body.rows[0].matched.cohort_id === CID,
    '⭐ הגבלה למחזור אחד (cohorts) מחזירה שיוך חד-משמעי');
  // כפילות מזהים לא אמורה להכפיל את הבריכה (שם אחד ≠ «מעורפל»)
  const dupIds = await j('/examiner/grading/monday-match', 'POST', { names: ['נעמה בן-דוד'], cohorts: [CID, CID, CID] }, tok);
  check(!!dupIds.body.rows[0].matched, '⭐ אותו מזהה מחזור פעמיים לא הופך שם תקין ל«מעורפל»');

  if (snap2.body.cohort_id !== CID) {
    await j('/examiner/grading/delete-cohort', 'POST', { cohort_id: snap2.body.cohort_id }, tok);
  }
  const left = (await j('/examiner/grading/cohorts', null, null, tok)).body.cohorts;
  check(left.some((c) => c.id === CID), 'המחזור הראשי שרד את הניקוי');

  console.log(fail.length ? `\n❌ ${fail.length} כשלים:\n  - ` + fail.join('\n  - ') : '\n✅ כל הבדיקות עברו');
  process.exit(fail.length ? 1 : 0);
})();
