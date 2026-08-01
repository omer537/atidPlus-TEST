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
    // code = הקוד האישי (pin) להתחברות; internalCode = המזהה הפנימי לפעולות מנהל (מסך המנהל משתמש בו).
    if (r.ok) examinees.push({ code, internalCode: r.data.state.examinee.code, name: 'נבחן ' + (i + 1), token: r.data.token, subjects });
  }
  check(examinees.length === N, `נרשמו ${examinees.length}/${N} נבחנים`);

  // 5 סבבים — במודל החי: מסמנים ~1/5 לריאיון בכל סבב, מתחילים, עונים, מסיימים
  let totalAnswers = 0;
  const interviewed = new Set();
  for (let round = 1; round <= 5; round++) {
    console.log(`\n--- סבב ${round} ---`);
    // מסמנים לריאיון את מי שעדיין לא התראיין (חלוקה שווה על פני הסבבים)
    for (let i = 0; i < examinees.length; i++) {
      const ex = examinees[i];
      if (!interviewed.has(ex.internalCode) && (i % 5) + 1 === round) {
        await api('/examiner/mark-interview', 'POST', { code: ex.internalCode, round, on: true }, examinerToken);
        interviewed.add(ex.internalCode);
      }
    }
    const st1 = await api('/examiner/start-round', 'POST', { round }, examinerToken);
    check(st1.ok, `התחלת סבב ${round}`);

    for (const ex of examinees) {
      const st = await api('/state', 'GET', null, ex.token);
      if (!st.ok) continue;
      const s = st.data;
      if (s.phase === 'chapter') {
        for (const it of s.chapter.items) {
          const answer = it.options ? it.options[0].id : ('הסבר לדוגמה של ' + ex.name + ' לפריט ' + it.id + '. '.repeat(3));
          const sv = await api('/save-answer', 'POST', { round, chapter_id: s.slot.chapter_id, item_id: it.id, type: it.type, answer, time_spent_sec: 60 }, ex.token);
          if (sv.ok) totalAnswers++;
        }
      }
    }
    // "שבירה מכוונת": ניתוק ושחזור תוך כדי סבב 2 (כשיש פרק פעיל)
    if (round === 2) {
      console.log('\n--- מבחן ניתוק ושחזור (תוך כדי סבב) ---');
      const victim = examinees[0];
      const before = (await api('/state', 'GET', null, victim.token)).data;
      const relogin = await api('/login', 'POST', { name: victim.name, code: victim.code });
      check(relogin.ok, 'שחזור עם שם + קוד לאחר "ניתוק"');
      const after = relogin.data.state;
      check(before.phase === 'chapter' && after.phase === 'chapter' && before.slot.chapter_id === after.slot.chapter_id,
        'הנבחן חזר בדיוק לאותו פרק');
      check((after.answers || []).length > 0, `התשובות שרדו את השחזור (${(after.answers || []).length} תשובות)`);
      victim.token = relogin.data.token;
    }

    const en = await api('/examiner/end-round', 'POST', { round }, examinerToken);
    check(en.ok, `סיום סבב ${round}`);
  }

  // אימות: כל הנבחנים התראיינו בדיוק פעם אחת
  const st = (await api('/examiner/status', 'GET', null, examinerToken)).data;
  check(st.examinees.every((e) => e.interviewed), 'כל הנבחנים התראיינו פעם אחת');

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
