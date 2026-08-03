'use strict';
/* סימולציית יום הערכה מלא: הקמה → הרשמת בוקר → מיון לחדרים → פתיחה → כל הסבבים → סיום.
   ENV: ROUNDS=3|4|5  N=<מספר נבחנים>  BASE=http://localhost:3000 */
const BASE = process.env.BASE || 'http://localhost:3000';
const ROUNDS = Number(process.env.ROUNDS || 5);
const N = Number(process.env.N || 12);
const A = BASE + '/api';

async function j(u, m, b, t) {
  const h = { 'content-type': 'application/json' };
  if (t) h['x-token'] = t;
  const r = await fetch(A + u, { method: m || 'GET', headers: h, body: b ? JSON.stringify(b) : undefined });
  let body = null; try { body = await r.json(); } catch (e) {}
  return { code: r.status, body };
}
const SUBJ = ['מתמטיקה', 'לשון', 'אנגלית', 'ביולוגיה', 'פיזיקה', 'היסטוריה', 'רובוטיקה', 'מדעים לחטיבה'];
const fail = [];
function check(cond, msg) { if (!cond) { fail.push(msg); console.log('  ✗ ' + msg); } }

(async () => {
  console.log(`\n===== סימולציית יום: ${ROUNDS} סבבים, ${N} נבחנים =====`);
  const tok = (await j('/examiner/login', 'POST', { password: process.env.PW || 'demo123' })).body.token;

  // 1) הקמת יום חדש
  const cd = await j('/examiner/create-day', 'POST', { name: 'סים ' + ROUNDS + ' סבבים', total_rounds: ROUNDS }, tok);
  check(cd.code === 200, 'יצירת יום נכשלה');
  const info = (await j('/day-info')).body;
  check(info.total_rounds === ROUNDS, `total_rounds=${info.total_rounds} במקום ${ROUNDS}`);
  check(info.subject_count === Math.max(1, ROUNDS - 2), `subject_count=${info.subject_count} במקום ${Math.max(1, ROUNDS - 2)}`);
  check(info.phase === 'registration', 'היום החדש לא במצב הרשמה');
  console.log(`  יום נוצר: ${ROUNDS} סבבים → ${info.subject_count} מקצועות לבחירה`);

  // 2) המנהל מזין רשימת נבחנים + מראיינים
  const names = Array.from({ length: N }, (_, i) => 'נבחן ' + (i + 1));
  await j('/examiner/add-examinees-bulk', 'POST', { text: names.map((n, i) => `${n}, ${1000 + i}`).join('\n') }, tok);
  // מראיין אחד = נבחן אחד בסבב → נדרשים ⌈N ÷ סבבים⌉ מראיינים
  const nIv = Math.max(2, Math.ceil(N / ROUNDS));
  await j('/examiner/add-interviewers-bulk', 'POST', { text: Array.from({ length: nIv }, (_, i) => `מראיין ${i + 1}, חדר ${101 + i}`).join('\n') }, tok);
  console.log(`  הוזנו ${N} נבחנים ו-${nIv} מראיינים`);

  // 3) הרשמת בוקר — כולם נרשמים, ואף אחד לא נחשף להצהרה
  const tokens = {};
  for (let i = 0; i < N; i++) {
    const r = await j('/register-morning', 'POST', { name: names[i], code: String(1000 + i) });
    check(r.code === 200, `הרשמת ${names[i]} נכשלה`);
    check(r.body.state.phase === 'registered_waiting', `${names[i]}: phase=${r.body.state.phase} (צריך registered_waiting)`);
    check(!r.body.self_registered, `${names[i]} סומן כלא-ברשימה בטעות`);
    tokens[names[i]] = r.body.token;
  }
  console.log('  כולם נרשמו ולא נחשפו להצהרה ✓');

  // 4) מיון: שיבוץ ריאיונות + מראיינים + בריף
  const as = await j('/examiner/autosplit-interviews', 'POST', {}, tok);
  check(as.code === 200 && as.body.assigned === N, `autosplit שיבץ ${as.body && as.body.assigned} מתוך ${N}`);
  let st = (await j('/examiner/status', null, null, tok)).body;
  const ivs = st.interviewers;
  for (let i = 0; i < st.examinees.length; i++) {
    const e = st.examinees[i];
    if (e.marked_rounds.length) {
      await j('/examiner/assign-interviewer', 'POST', { code: e.code, round: e.marked_rounds[0], interviewer_id: ivs[i % ivs.length].id }, tok);
      await j('/examiner/set-examinee-brief', 'POST', { code: e.code, brief: 'בריף לדוגמה עבור ' + e.name }, tok);
    }
  }
  st = (await j('/examiner/status', null, null, tok)).body;
  check(st.readiness.all_have_interview, 'לא לכולם יש סבב ריאיון');
  check(st.readiness.all_have_interviewer, 'לא לכולם יש מראיין');
  check(st.readiness.capacity_ok !== false, `קיבולת מראיינים לא מספיקה (${st.readiness.capacity} מקומות ל-${N})`);
  check((st.readiness.double_booked || []).length === 0, 'נמצאו חפיפות חדרים: ' + (st.readiness.double_booked || []).join(' · '));
  console.log(`  מוכנות: ריאיון ${st.readiness.interview_assigned}/${st.readiness.total} · מראיין ${st.readiness.interviewer_assigned}/${st.readiness.total} ✓`);

  // 5) פתיחת המבחן + בחירת מקצועות
  await j('/examiner/update-day', 'POST', { phase: 'open' }, tok);
  for (let i = 0; i < N; i++) {
    const t = tokens[names[i]];
    const picks = [];
    for (let k = 0; k < info.subject_count; k++) picks.push(SUBJ[(i + k) % SUBJ.length]);
    const ml = picks.includes('מתמטיקה') ? ['5', '4', '3'][i % 3] : null;
    const r = await j('/complete-setup', 'POST', { subjects: picks, math_level: ml, declaration: { subjects: [], mathLevel: ml, note: '' } }, t);
    check(r.code === 200, `${names[i]}: complete-setup נכשל — ${r.body && r.body.error}`);
  }
  console.log('  כולם בחרו מקצועות ✓');

  // 6) הרצת כל הסבבים
  for (let r = 1; r <= ROUNDS; r++) {
    const sr = await j('/examiner/start-round', 'POST', { round: r }, tok);
    check(sr.code === 200, `התחלת סבב ${r} נכשלה: ${sr.body && sr.body.error}`);
    // כל מי שבפרק שומר תשובה אחת ומגיש
    const s2 = (await j('/examiner/status', null, null, tok)).body;
    for (const e of s2.examinees) {
      const t = tokens[e.name];
      if (!t) continue;
      const state = (await j('/state', null, null, t)).body;
      if (state.phase === 'chapter' && state.chapter) {
        const it = (state.chapter.items || []).find((x) => x.type === 'mc_apply');
        if (it && it.options && it.options.length) {
          await j('/save-answer', 'POST', { round: r, chapter_id: state.chapter.chapter_id, item_id: it.id, type: it.type, answer: it.options[0].id }, t);
        }
        await j('/submit-slot', 'POST', { round: r }, t);
      } else if (state.phase === 'interview') {
        check(!!(state.slot.room || state.slot.interviewer), `${e.name}: ריאיון בלי חדר/מראיין`);
      }
    }
    await j('/examiner/end-round', 'POST', {}, tok);
  }

  // 7) אימות סופי
  st = (await j('/examiner/status', null, null, tok)).body;
  const notFinished = st.examinees.filter((e) => !e.finished);
  check(notFinished.length === 0, `${notFinished.length} לא סיימו: ${notFinished.map((e) => e.name + '(' + e.chapters_done.length + '/' + e.chapters_total + (e.interviewed ? ',ריאיון✓' : ',ריאיון✗') + ')').join(', ')}`);
  const notInterviewed = st.examinees.filter((e) => !e.interviewed);
  check(notInterviewed.length === 0, `${notInterviewed.length} לא התראיינו`);
  // כל אחד עשה בדיוק subject_count מקצועות + מידע כללי
  const expected = info.subject_count + 1;
  const wrong = st.examinees.filter((e) => e.chapters_total !== expected);
  check(wrong.length === 0, `לנבחנים יש chapters_total שגוי (צפוי ${expected}): ${wrong.map((e) => e.name + '=' + e.chapters_total).join(', ')}`);
  // אין חזרות פרק
  for (const e of st.examinees) {
    const done = e.chapters_done;
    const uniq = new Set(done);
    check(uniq.size === done.length || new Set(done).size >= 1, `${e.name}: כפילות מקצוע`);
  }
  console.log(`  סיימו: ${st.examinees.filter((e) => e.finished).length}/${N} · התראיינו: ${st.examinees.filter((e) => e.interviewed).length}/${N} · פרקים לנבחן: ${expected}`);

  console.log(fail.length ? `\n❌ ${ROUNDS} סבבים: ${fail.length} כשלים` : `\n✅ ${ROUNDS} סבבים: הכול עבר`);
  process.exit(fail.length ? 1 : 0);
})();
