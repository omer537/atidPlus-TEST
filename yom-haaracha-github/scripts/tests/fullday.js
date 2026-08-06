'use strict';
/* =========================================================================
   סימולציית יום מלא כפי שיירוץ בפועל — 6 מראיינים, 20 נבחנים, 5 סבבים.
   מריץ את כל השרשרת: מנהל → מראיינים → הרשמת נבחנים → שיבוץ ריאיונות
   לפי מראיינים/סבבים → העלאת בריפים (עם אי-דיוקים בשמות) → פתיחת מבחן →
   הוראות/הצהרה/מקצועות → כל הסבבים → אימות שכל מראיין רואה את שלו וכל
   נבחן רואה את שלו → הגשות → גיבוי לפני ואחרי → סגירת יום.

   ENV: BASE, PW (מנהל), IVPW (מראיינים), N, ROUNDS, IVS
   ========================================================================= */
const BASE = process.env.BASE || 'http://localhost:3000';
const A = BASE + '/api';
const PW = process.env.PW || 'bbb123';
const IVPW = process.env.IVPW || 'atid2026';
const N = Number(process.env.N || 20);
const ROUNDS = Number(process.env.ROUNDS || 5);
const NIV = Number(process.env.IVS || 6);

const fail = [], warn = [];
function ok(m) { console.log('  ✓ ' + m); }
function check(c, m) { if (c) { ok(m); } else { fail.push(m); console.log('  ✗ ' + m); } }
function note(m) { warn.push(m); console.log('  ⚠ ' + m); }
function head(t) { console.log('\n=== ' + t + ' ==='); }

async function j(u, m, b, t) {
  const h = { 'content-type': 'application/json' }; if (t) h['x-token'] = t;
  const r = await fetch(A + u, { method: m || 'GET', headers: h, body: b ? JSON.stringify(b) : undefined });
  let body = null; try { body = await r.json(); } catch (e) {}
  return { code: r.status, body };
}
async function raw(u, t) {
  const r = await fetch(A + u, { headers: t ? { 'x-token': t } : {} });
  const buf = Buffer.from(await r.arrayBuffer());
  return { code: r.status, size: buf.length, buf };
}

const SUBJ = ['מתמטיקה', 'לשון', 'אנגלית', 'ביולוגיה', 'פיזיקה', 'היסטוריה', 'רובוטיקה', 'מדעים לחטיבה'];
const FIRST = ['דנה', 'יוסי', 'מאיה', 'רון', 'נועה', 'איתי', 'שירה', 'עומר', 'תמר', 'גיא',
  'ליאור', 'אורי', 'הילה', 'אסף', 'רותם', 'יעל', 'אלון', 'מיכל', 'ניר', 'עדי'];
const LAST = ['לוי', 'כהן', 'בר', 'אמסלם', 'פרץ', 'שגב', 'מזרחי', 'דגן', 'כץ', 'אביב',
  'נחום', 'שמש', 'ברק', 'גל', 'רון', 'אדרי', 'חדד', 'ביטון', 'סבן', 'אוחיון'];

(async () => {
  console.log(`\n########## יום מלא: ${N} נבחנים · ${NIV} מראיינים · ${ROUNDS} סבבים ##########`);

  // ── 1. מנהל מתחבר ──
  head('1. מנהל מתחבר');
  const lg = await j('/examiner/login', 'POST', { password: PW });
  check(lg.code === 200 && !!lg.body.token, 'התחברות מנהל');
  const tok = lg.body.token;

  // יום חדש
  const cd = await j('/examiner/create-day', 'POST',
    { name: 'בחינת סיווג — סימולציה', title: 'בחינת סיווג תשפ״ז', total_rounds: ROUNDS }, tok);
  check(cd.code === 200, 'הוקם יום הערכה (' + ROUNDS + ' סבבים)');
  const info = (await j('/day-info')).body;
  check(info.phase === 'registration', 'היום נפתח בשלב הרשמה');
  const subjCount = info.subject_count;
  ok('מקצועות לבחירה לכל נבחן: ' + subjCount);

  // ── 2. מקים מראיינים ──
  head('2. מנהל מקים ' + NIV + ' מראיינים');
  const ivNames = ['רות מזרחי', 'אבי דגן', 'שירה כץ', 'דוד לוי', 'מיכל אביב', 'יואב נחום'].slice(0, NIV);
  const ivText = ivNames.map((n, i) => `${n}, חדר ${101 + i}`).join('\n');
  const ivAdd = await j('/examiner/add-interviewers-bulk', 'POST', { text: ivText }, tok);
  check(ivAdd.code === 200 && ivAdd.body.added === NIV, NIV + ' מראיינים נוספו');
  let st = (await j('/examiner/status', null, null, tok)).body;
  check(st.interviewers.length === NIV, 'המראיינים מופיעים בסטטוס');
  check(st.interviewers.every((v) => v.room), 'לכל מראיין יש חדר');

  // רשימת נבחנים מראש
  // ⚠ השם הוא הזהות ולכן חייב להיות ייחודי. עם `LAST[i % 20]` נבחן 21 קיבל
  // שם זהה לנבחן 1 והמערכת דחתה אותו בצדק — כך N>20 "נכשל" בלי סיבה אמיתית.
  // חלוקה שלמה נותנת 20×20 = 400 שמות ייחודיים.
  const names = Array.from({ length: N }, (_, i) =>
    FIRST[i % FIRST.length] + ' ' + LAST[Math.floor(i / FIRST.length) % LAST.length]);
  if (new Set(names).size !== N) fail.push('חליפת הבדיקה ייצרה שמות כפולים — N גדול מדי');
  const pins = names.map((_, i) => String(1001 + i));
  await j('/examiner/add-examinees-bulk', 'POST', { text: names.map((n, i) => `${n}, ${pins[i]}`).join('\n') }, tok);
  st = (await j('/examiner/status', null, null, tok)).body;
  check(st.examinees.length === N, N + ' נבחנים הוזנו מראש');

  // קיבולת
  check(st.readiness.capacity_ok !== false,
    `קיבולת מראיינים: ${st.readiness.capacity} מקומות ל-${N} נבחנים (נדרשים ${st.readiness.needed_interviewers})`);

  // ── 3. מראיינים מתחברים ──
  head('3. כל ' + NIV + ' המראיינים מתחברים');
  const ivTok = {};
  const pub = await j('/interviewers-public');
  check((pub.body.interviewers || []).length === NIV, 'רשימת המראיינים גלויה במסך הכניסה');
  for (const v of pub.body.interviewers) {
    const r = await j('/interviewer/login', 'POST', { interviewer_id: v.id, password: IVPW });
    if (r.code !== 200) { fail.push('התחברות מראיין ' + v.name + ' נכשלה: ' + (r.body.error || r.code)); continue; }
    ivTok[v.id] = r.body.token;
  }
  check(Object.keys(ivTok).length === NIV, 'כל המראיינים התחברו (' + Object.keys(ivTok).length + '/' + NIV + ')');
  const badPw = await j('/interviewer/login', 'POST', { interviewer_id: pub.body.interviewers[0].id, password: 'לא נכון' });
  check(badPw.code === 401, 'סיסמה שגויה נדחית');

  // ── 4. נבחנים נרשמים בבוקר ──
  head('4. ' + N + ' נבחנים נרשמים מהטלפון');
  const exTok = {};
  for (let i = 0; i < N; i++) {
    const r = await j('/register-morning', 'POST', { name: names[i], code: pins[i] });
    if (r.code !== 200) { fail.push('הרשמת ' + names[i] + ' נכשלה: ' + (r.body.error || r.code)); continue; }
    exTok[names[i]] = r.body.token;
    if (r.body.state.phase !== 'registered_waiting') fail.push(names[i] + ': phase=' + r.body.state.phase);
    if (r.body.self_registered) fail.push(names[i] + ' סומן כלא-ברשימה בטעות');
  }
  check(Object.keys(exTok).length === N, 'כל הנבחנים נרשמו');
  ok('כולם על מסך «נרשמת בהצלחה» — לא נחשפו להצהרה/מקצועות');
  // אימות שלא נחשפו לפרק
  const peek = (await j('/state', null, null, exTok[names[0]])).body;
  check(!peek.chapter, 'אין חשיפה לתוכן המבחן בשלב ההרשמה');

  // ── 5. שיבוץ ריאיונות לפי מראיינים וסבבים ──
  head('5. מנהל משבץ ריאיונות לפי מראיינים וסבבים');
  const as = await j('/examiner/autosplit-interviews', 'POST', {}, tok);
  check(as.code === 200 && as.body.assigned === N,
    `חלוקה אוטומטית: ${as.body.assigned}/${N} · עם מראיין ${as.body.with_interviewer} · בלי ${as.body.without_interviewer}`);
  st = (await j('/examiner/status', null, null, tok)).body;
  check(st.readiness.all_have_interview, 'לכל נבחן יש סבב ריאיון');
  check(st.readiness.all_have_interviewer, 'לכל נבחן יש מראיין+חדר');
  check((st.readiness.double_booked || []).length === 0, 'אין חפיפות (מראיין אחד = נבחן אחד בסבב)');
  const loads = st.interviewers.map((v) => v.load);
  check(Math.max(...loads) - Math.min(...loads) <= 1,
    'העומס מאוזן בין המראיינים: ' + st.interviewers.map((v) => v.name + '=' + v.load).join(' · '));

  // ── 6. העלאת בריפים עם אי-דיוקים בשמות ──
  head('6. העלאת בריפים — עם אי-דיוקים בשמות (כמו בפועל)');
  const FINALS = { 'ם': 'מ', 'ן': 'נ', 'ץ': 'צ', 'ף': 'פ', 'ך': 'כ' };
  const lines = [];
  const distorted = [];
  names.forEach((nm, i) => {
    let typed = nm;
    const kind = i % 5;
    if (kind === 1) { // אות סופית
      typed = nm.split('').map((ch) => FINALS[ch] || ch).join('');
      if (typed !== nm) distorted.push(typed);
    } else if (kind === 2) { // גרשיים
      typed = nm + "'"; distorted.push(typed);
    } else if (kind === 3) { // שם אמצעי
      const p = nm.split(' '); typed = p[0] + ' שרה ' + p[1]; distorted.push(typed);
    }
    lines.push(typed + ' | בריף: ' + (i % 2 ? 'רקע בהוראה פרטית, חזק ב' + SUBJ[i % SUBJ.length] + '. לבדוק כיתה גדולה.' : 'ללא ניסיון הוראה, בוגר תואר. לבדוק סבלנות, הנגשה.'));
  });
  lines.push('משה כוכבי | בריף של מי שלא נרשם בכלל.');   // לא קיים
  const bf = await j('/examiner/set-briefs-bulk', 'POST', { text: lines.join('\n') }, tok);
  ok(`שויכו מדויק: ${bf.body.updated} · הוצעו: ${(bf.body.suggested || []).length} · ללא התאמה: ${(bf.body.unmatched || []).length}`);
  check(bf.body.updated + (bf.body.suggested || []).length + (bf.body.unmatched || []).length === lines.length,
    'כל השורות טופלו (אף בריף לא נעלם)');
  check((bf.body.suggested || []).length === distorted.length,
    `כל ${distorted.length} השמות המעוותים זוהו והוצעו (לא שויכו אוטומטית)`);
  // המנהל מאשר את ההצעות
  const bs = (await j('/examiner/briefs-status', null, null, tok)).body;
  let assignedBriefs = 0;
  for (const p of bs.pending) {
    const best = (p.suggestions || [])[0];
    if (!best) continue;
    const r = await j('/examiner/assign-pending-brief', 'POST', { pending_id: p.pending_id, code: best.code }, tok);
    if (r.code === 200) assignedBriefs++;
  }
  ok('המנהל אישר ' + assignedBriefs + ' הצעות שיוך בקליק');
  const bs2 = (await j('/examiner/briefs-status', null, null, tok)).body;
  check(bs2.with_brief === N, `לכל ${N} הנבחנים יש בריף (${bs2.with_brief})`);
  check(bs2.pending.length === 1, 'נשאר רק הבריף של מי שלא נרשם (' + bs2.pending.length + ')');

  // ── 7. פתיחת המבחן ──
  head('7. «התחל מבחן» — הוראות, הצהרה, בחירת מקצועות');
  const op = await j('/examiner/update-day', 'POST', { phase: 'open' }, tok);
  check(op.code === 200, 'המבחן נפתח');
  const s1 = (await j('/state', null, null, exTok[names[0]])).body;
  check(s1.phase === 'needs_setup', 'הנבחן עובר לשלב ההוראות/הצהרה/מקצועות (' + s1.phase + ')');

  for (let i = 0; i < N; i++) {
    const t = exTok[names[i]];
    const picks = [];
    for (let k = 0; k < subjCount; k++) picks.push(SUBJ[(i + k) % SUBJ.length]);
    const ml = picks.includes('מתמטיקה') ? ['5', '4', '3'][i % 3] : null;
    const r = await j('/complete-setup', 'POST',
      { subjects: picks, math_level: ml, declaration: { subjects: picks, mathLevel: ml, note: '' } }, t);
    if (r.code !== 200) fail.push(names[i] + ': בחירת מקצועות נכשלה — ' + (r.body && r.body.error));
  }
  st = (await j('/examiner/status', null, null, tok)).body;
  check(st.examinees.every((e) => e.setup), 'כל ' + N + ' הנבחנים בחרו מקצועות');

  // ── 8. גיבוי לפני תחילת הסבבים ──
  head('8. גיבוי לפני המבחן');
  const b0 = await j('/examiner/backup-now', 'POST', {}, tok);
  check(b0.code === 200, 'גיבוי ידני נוצר');
  const xl0 = await raw('/examiner/export-excel', tok);
  check(xl0.code === 200 && xl0.size > 2000, 'הורדת Excel לפני המבחן (' + xl0.size + ' בתים)');
  const rs0 = await raw('/examiner/export-roster', tok);
  check(rs0.code === 200 && rs0.size > 2000, 'הורדת רשימת נבחנים וקודים (' + rs0.size + ' בתים)');

  // ── 9. הרצת כל הסבבים ──
  head('9. הרצת ' + ROUNDS + ' סבבים');
  const seenChapters = {};   // name -> Set(subject)
  const ivSaw = {};          // interviewer_id -> Set(examinee name)
  names.forEach((n) => { seenChapters[n] = new Set(); });

  for (let r = 1; r <= ROUNDS; r++) {
    const sr = await j('/examiner/start-round', 'POST', { round: r }, tok);
    if (sr.code !== 200) { fail.push('התחלת סבב ' + r + ': ' + (sr.body && sr.body.error)); break; }
    const s = (await j('/examiner/status', null, null, tok)).body;

    // כל מראיין רואה את המרואיינים שלו — עם חדר ובריף
    for (const v of s.interviewers) {
      const t = ivTok[v.id]; if (!t) continue;
      const sch = await j('/interviewer/schedule', null, null, t);
      if (sch.code !== 200) { fail.push('לו"ז מראיין ' + v.name + ': ' + sch.code); continue; }
      if (!sch.body.interviewer || sch.body.interviewer.room !== v.room) fail.push(v.name + ': החדר לא תואם');
      if (!sch.body.day || !sch.body.day.name) fail.push(v.name + ': שם היום לא מוצג');
      const nowOnes = (sch.body.schedule || []).filter((x) => x.round === r);
      nowOnes.forEach((x) => {
        (ivSaw[v.id] = ivSaw[v.id] || new Set()).add(x.name);
        if (!x.brief) fail.push('המראיין ' + v.name + ' לא רואה בריף על ' + x.name);
      });
    }

    // כל נבחן: או פרק או ריאיון עם חדר+מראיין
    let inChapter = 0, inInterview = 0;
    for (let i = 0; i < N; i++) {
      const nm = names[i], t = exTok[nm];
      const state = (await j('/state', null, null, t)).body;
      if (state.phase === 'chapter' && state.chapter) {
        inChapter++;
        const subj = state.chapter.subject || state.chapter.chapter_id;
        if (seenChapters[nm].has(subj) && subj !== 'מידע כללי') note(nm + ': קיבל ' + subj + ' פעמיים');
        seenChapters[nm].add(subj);
        // עונה על כל השאלות ומגיש
        for (const it of (state.chapter.items || [])) {
          if (it.type === 'mc_apply' || it.type === 'mc_error_dialogue') {
            if (it.options && it.options.length) {
              await j('/save-answer', 'POST', { round: r, chapter_id: state.chapter.chapter_id, item_id: it.id, type: it.type, answer: it.options[i % it.options.length].id }, t);
            }
          } else if (it.type === 'text_teach' || it.type === 'text_teach_error') {
            await j('/save-answer', 'POST', { round: r, chapter_id: state.chapter.chapter_id, item_id: it.id, type: it.type, answer: 'הייתי מסביר לתלמיד בצעדים, עם דוגמה מהחיים, ומוודא שהוא מבין את השורש ולא רק את הכלל. ' + nm }, t);
          }
        }
        const sub = await j('/submit-slot', 'POST', { round: r }, t);
        if (sub.code !== 200) fail.push(nm + ': הגשה נכשלה בסבב ' + r);
      } else if (state.phase === 'interview') {
        inInterview++;
        if (!state.slot || !state.slot.room) fail.push(nm + ': ריאיון בלי חדר בסבב ' + r);
        if (!state.slot || !state.slot.interviewer) fail.push(nm + ': ריאיון בלי שם מראיין בסבב ' + r);
      }
    }
    ok(`סבב ${r}: ${inChapter} בפרק · ${inInterview} בריאיון · הכול הוגש`);
    await j('/examiner/end-round', 'POST', {}, tok);
  }

  // ── 10. אימות שכל מראיין ראה את שלו ──
  head('10. אימות ריאיונות');
  st = (await j('/examiner/status', null, null, tok)).body;
  const totalSeen = Object.values(ivSaw).reduce((n, s) => n + s.size, 0);
  check(totalSeen === N, `כל ${N} הנבחנים הופיעו אצל מראיין (${totalSeen})`);
  const notIv = st.examinees.filter((e) => !e.interviewed);
  check(notIv.length === 0, 'כולם מסומנים «התראיין» (' + (notIv.length ? notIv.map((e) => e.name).join(', ') : '0 חסרים') + ')');
  const notFin = st.examinees.filter((e) => !e.finished);
  check(notFin.length === 0, 'כולם סיימו את כל הפרקים (' + notFin.length + ' חסרים)');
  const expected = subjCount + 1;
  const wrong = st.examinees.filter((e) => e.chapters_done.length !== expected);
  check(wrong.length === 0, `לכל נבחן ${expected} פרקים (${wrong.length} חריגים)`);

  // ── 11. אימות שהתשובות נשמרו ──
  head('11. אימות שהתשובות שמורות ולא אבדו');
  const dsBefore = (await j('/examiner/day-saves', null, null, tok)).body;
  ok(`בצד החי: ${dsBefore.live.examinees} נבחנים · ${dsBefore.live.answers} תשובות`);
  check(dsBefore.live.answers > N * expected, 'מספר התשובות סביר (יותר מ-' + (N * expected) + ')');
  const xl1 = await raw('/examiner/export-excel', tok);
  check(xl1.code === 200 && xl1.size > xl0.size, 'Excel אחרי המבחן גדול מלפני (' + xl0.size + ' → ' + xl1.size + ')');
  const XLSX = require('../../node_modules/xlsx');
  const wb = XLSX.read(xl1.buf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  check(rows.length - 1 === dsBefore.live.answers, `כל התשובות בקובץ (${rows.length - 1}/${dsBefore.live.answers})`);
  const jsonExp = await raw('/examiner/export-all', tok);
  check(jsonExp.code === 200 && jsonExp.size > 10000, 'ייצוא JSON תקין (' + jsonExp.size + ' בתים)');

  // ── 12. סיום וסגירה ──
  head('12. סיים מבחן → סגור יום ושלח לבדיקה');
  await j('/examiner/update-day', 'POST', { finish_message: 'סיימתם! נא לעבור לאולם הכינוס בקומה 2.' }, tok);
  const ee = await j('/examiner/end-exam', 'POST', { ended: true }, tok);
  check(ee.code === 200, 'המבחן הסתיים');
  const endSt = (await j('/state', null, null, exTok[names[0]])).body;
  check(endSt.phase === 'ended' && endSt.message.indexOf('אולם הכינוס') >= 0, 'הנבחן רואה את הודעת הסיום שנכתבה');

  const sv = await j('/examiner/save-day', 'POST', {}, tok);
  check(sv.code === 200, `היום נשמר · צילום #${sv.body.cohort_id} · ${sv.body.examinees} נבחנים · ${sv.body.answers} תשובות · ${sv.body.teachItems} שאלות «למד»`);
  check(sv.body.answers === dsBefore.live.answers, 'הצילום מכיל את *כל* התשובות');

  // אחרי סגירה — חסימה
  const reReg = await j('/register-morning', 'POST', { name: names[0], code: pins[0] });
  check(reReg.code === 403, 'אחרי סגירה: הרשמה חסומה');
  const xl2 = await raw('/examiner/export-excel', tok);
  check(xl2.code === 200 && xl2.size === xl1.size, 'Excel אחרי הסגירה זהה (התשובות שרדו)');

  // ── 13. גיבוי: שום דבר לא יכול ללכת לאיבוד ──
  head('13. גיבויים');
  const bks = (await j('/examiner/backups', null, null, tok)).body;
  check((bks.files || []).length >= 2, (bks.files || []).length + ' גיבויים קיימים');
  const dl = await raw('/examiner/backup/' + encodeURIComponent(bks.files[0].name), tok);
  check(dl.code === 200 && dl.size > 1000, 'אפשר להוריד גיבוי (' + dl.size + ' בתים)');
  const dsAfter = (await j('/examiner/day-saves', null, null, tok)).body;
  check(!!dsAfter.primary, 'קיים צילום ראשי לבדיקה');
  check(dsAfter.day.status === 'closed', 'היום בארכיון');
  // הצילום נגיש במסך הבדיקה
  const coh = await j('/examiner/grading/cohort/' + sv.body.cohort_id, null, null, tok);
  check(coh.code === 200 && (coh.body.examinees || []).length === N, `מסך הבדיקה פותח את הצילום (${(coh.body.examinees || []).length}/${N})`);
  const allXl = await raw('/examiner/export-excel?all_closed=1', tok);
  check(allXl.code === 200 && allXl.size > 2000, 'הורדת כל הימים הסגורים (' + allXl.size + ' בתים)');

  // ── סיכום ──
  console.log('\n##########################################');
  if (warn.length) console.log('אזהרות (' + warn.length + '):\n  - ' + warn.join('\n  - '));
  console.log(fail.length ? `❌ ${fail.length} כשלים:\n  - ` + fail.join('\n  - ') : '✅ היום המלא עבר בהצלחה — כל השרשרת עובדת');
  process.exit(fail.length ? 1 : 0);
})();
