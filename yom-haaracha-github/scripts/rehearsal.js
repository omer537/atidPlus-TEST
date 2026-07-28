'use strict';
/* =========================================================================
   חזרה גנרלית / סימולציית עומס.
   מפעיל נבחנים מדומים מול השרת הרץ, מדמה 5 סבבים, שומר תשובות,
   ומבצע "שבירה מכוונת" (ניתוק ושחזור) כדי לוודא שהמערכת מחזירה לאותה נקודה.

   הרצה (כשהשרת פועל):
     node scripts/rehearsal.js
     N=40 BASE=http://localhost:3000 node scripts/rehearsal.js
   ========================================================================= */
const BASE = process.env.BASE || 'http://localhost:3000';
const N = Number(process.env.N || 40);
const EXAMINER_PW = process.env.EXAMINER_PASSWORD || 'admin';

const SUBJECT_POOL = ['מתמטיקה', 'אנגלית', 'לשון', 'היסטוריה', 'פיזיקה', 'ביולוגיה', 'מדעים לחטיבה', 'רובוטיקה'];

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}

async function api(path, method, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['x-token'] = token;
  const res = await fetch(BASE + '/api' + path, { method: method || 'GET', headers, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch (e) {}
  return { ok: res.ok, status: res.status, data };
}

function pick(arr, n, seed) {
  const a = arr.slice(); const out = [];
  for (let i = 0; i < n && a.length; i++) out.push(a.splice((seed * 7 + i * 13) % a.length, 1)[0]);
  return out;
}

async function main() {
  console.log(`\n===== חזרה גנרלית: ${N} נבחנים מול ${BASE} =====\n`);

  // בדיקת חיבור
  const health = await api('/subjects');
  if (!health.ok) { console.log('✗ השרת אינו מגיב. ודא ש-npm start פועל.'); process.exit(1); }
  const availSubjects = health.data.subjects;
  console.log(`מקצועות זמינים: ${availSubjects.join(', ')}\n`);

  // כניסת בוחן
  const exm = await api('/examiner/login', 'POST', { password: EXAMINER_PW });
  check(exm.ok, 'כניסת בוחן');
  const examinerToken = exm.data && exm.data.token;

  // רישום N נבחנים
  console.log(`\nרישום ${N} נבחנים...`);
  const examinees = [];
  for (let i = 0; i < N; i++) {
    const subjects = pick(availSubjects, 3 + (i % 2), i); // 3–4 מקצועות
    const code = 'SIM' + String(1000 + i);
    const r = await api('/register', 'POST', {
      name: 'נבחן ' + (i + 1), code,
      subjects, math_level: subjects.includes('מתמטיקה') ? ['5', '4', '3'][i % 3] : null,
      declaration: {},
    });
    if (r.ok) examinees.push({ code, name: 'נבחן ' + (i + 1), token: r.data.token, subjects, iRound: r.data.state.examinee.interview_round });
  }
  check(examinees.length === N, `נרשמו ${examinees.length}/${N} נבחנים`);

  // איזון סבבי ריאיון
  const iCounts = {};
  examinees.forEach((e) => { iCounts[e.iRound] = (iCounts[e.iRound] || 0) + 1; });
  console.log('  פיזור סבבי ריאיון:', JSON.stringify(iCounts));
  check(Object.values(iCounts).every((c) => c <= Math.ceil(N / 5) + 1), 'סבבי הריאיון מאוזנים (≈' + Math.ceil(N / 5) + ' לכל סבב)');

  // 5 סבבים
  let totalAnswers = 0;
  for (let round = 1; round <= 5; round++) {
    console.log(`\n--- סבב ${round} ---`);
    const rel = await api('/examiner/release-round', 'POST', { round }, examinerToken);
    check(rel.ok, `שחרור קוד סבב ${round}`);

    for (const ex of examinees) {
      const st = await api('/state', 'GET', null, ex.token);
      if (!st.ok) continue;
      const s = st.data;
      if (s.phase === 'chapter') {
        // ענה על כל הפריטים
        for (const it of s.chapter.items) {
          const answer = it.options ? it.options[0].id : ('הסבר לדוגמה של ' + ex.name + ' לפריט ' + it.id + '. '.repeat(3));
          const sv = await api('/save-answer', 'POST', { round, chapter_id: s.slot.chapter_id, item_id: it.id, type: it.type, answer, time_spent_sec: 60 }, ex.token);
          if (sv.ok) totalAnswers++;
        }
      }
    }
  }

  // "שבירה מכוונת": ניתוק ושחזור של נבחן אחד
  console.log('\n--- מבחן ניתוק ושחזור (שבירה מכוונת) ---');
  const victim = examinees[Math.floor(N / 2)];
  const before = (await api('/state', 'GET', null, victim.token)).data;
  const relogin = await api('/login', 'POST', { name: victim.name, code: victim.code });
  check(relogin.ok, 'שחזור עם שם + קוד לאחר "ניתוק"');
  const after = relogin.data.state;
  check(before && after && before.slot && after.slot && before.slot.round === after.slot.round && before.slot.chapter_id === after.slot.chapter_id,
    'הנבחן חזר בדיוק לאותה נקודה (סבב + פרק זהים)');

  // אימות שמירה: התשובות של הנבחן נשמרו ושרדו
  const savedForVictim = (relogin.data.state.answers || []).length;
  check(savedForVictim > 0, `התשובות של הנבחן שרדו את השחזור (${savedForVictim} תשובות בפרק הנוכחי)`);

  // סטטוס בוחן + ייצוא
  const status = await api('/examiner/status', 'GET', null, examinerToken);
  check(status.ok && status.data.examinees.length === N, 'מסך הבוחן מציג את כל הנבחנים');
  const exp = await fetch(BASE + '/api/examiner/export-all', { headers: { 'x-token': examinerToken } });
  const expJson = await exp.json();
  check(exp.ok && expJson.examinees.length === N, 'ייצוא כל התשובות עובד');

  console.log(`\n===== סיכום: ${pass} עברו, ${fail} נכשלו · ${totalAnswers} תשובות נשמרו =====\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('שגיאה בחזרה הגנרלית:', e.message); process.exit(1); });
