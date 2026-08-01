'use strict';
/*
 * בניית לוח המשבצות לכל נבחן: 5 סבבים = 4 פרקי מבחן + ריאיון אחד.
 * המנוע "משעמם" ומפורש בכוונה — קל להבין ולתקן.
 */
const content = require('./content');

const NUM_ROUNDS = 5;
const NUM_CHAPTERS = 4;
const NUM_CHOSEN = 3;                    // הנבחן בוחר 3 מקצועות; הפרק הרביעי קבוע.
const GENERAL_SUBJECT = 'מידע כללי';     // פרק חובה לכולם — פענוח חומר חדש והסברתו לתלמיד.

// מתמטיקה: 5 → 4 → 3. לא יורד מתחת ל-3.
function lowerLevel(level) {
  const n = Number(level);
  if (!n || n <= 3) return '3';
  return String(n - 1);
}

// בונה רשימת 4 מקצועות לפרקים: עד 3 שהנבחן בחר (הראשי חוזר וממלא אם בחר פחות),
// והפרק הרביעי הוא תמיד «מידע כללי» — פרק החובה שכולם עושים.
function buildChapterSubjects(subjects) {
  const chosen = (subjects || []).filter((s) => s && s !== GENERAL_SUBJECT);
  const main = chosen[0];
  const out = chosen.slice(0, NUM_CHOSEN);
  while (out.length < NUM_CHOSEN && main) out.push(main);
  out.push(GENERAL_SUBJECT);
  return out;
}

// בוחר את סבב הריאיון עם הכי הרבה מקומות פנויים (cap פחות count),
// תוך כיבוד הקיבולת פר-סבב. שובר-שוויון מסתובב כדי לא להעמיס תמיד את סבב 1.
function pickInterviewRound(counts, caps) {
  counts = counts || {};
  caps = caps || [];
  let bestRemain = -Infinity;
  const tied = [];
  let total = 0;
  for (let r = 1; r <= NUM_ROUNDS; r++) total += (counts[r] || 0);
  for (let r = 1; r <= NUM_ROUNDS; r++) {
    const cap = caps[r - 1] === undefined ? 8 : (Number(caps[r - 1]) || 0);
    const remain = cap - (counts[r] || 0);
    if (remain > bestRemain) { bestRemain = remain; tied.length = 0; tied.push(r); }
    else if (remain === bestRemain) tied.push(r);
  }
  return tied.length ? tied[total % tied.length] : 1;
}

/*
 * בונה את התוכנית המלאה.
 *  subjects    — מערך מקצועות מסודר (הראשון = הנושא הראשי)
 *  mathLevel   — "5"/"4"/"3" או null
 *  interviewRound — 1..5
 *  seatIndex   — מספר סידורי של הנבחן (לפיזור וריאנטים בין יושבים סמוכים)
 */
function buildPlan({ subjects, mathLevel, interviewRound, seatIndex = 0 }) {
  const chapterSubjects = buildChapterSubjects(subjects);
  const slots = [];
  let chapterCursor = 0;

  // גארד: אם סבב הריאיון חסר/לא תקין — ברירת מחדל לסבב האחרון (מונע 5 פרקים שגויים)
  let ir = Number(interviewRound);
  if (!(ir >= 1 && ir <= NUM_ROUNDS)) ir = NUM_ROUNDS;

  for (let round = 1; round <= NUM_ROUNDS; round++) {
    if (round === ir) {
      slots.push({ round, kind: 'interview', subject: null, level: null, chapter_id: null, variant_index: 0 });
      continue;
    }
    const subject = chapterSubjects[chapterCursor];
    chapterCursor++;
    const level = subject === 'מתמטיקה' ? (mathLevel || '5') : null;
    const variantIndex = seatIndex; // פיזור וריאנטים (כשיתווספו)
    const ch = content.findChapter(subject, level, variantIndex);
    slots.push({
      round,
      kind: 'chapter',
      subject,
      level,
      chapter_id: ch ? ch.chapter_id : null,
      variant_index: variantIndex,
      missing: ch ? false : true, // אין פרק זמין למקצוע/רמה זו
    });
  }
  return slots;
}

// הפול (רשימת הווריאנטים) של מקצוע, לפי סדר טעינה. במתמטיקה מסונן לפי רמה.
function poolFor(subject, mathLevel) {
  const list = content.bySubject.get(subject) || [];
  const level = subject === 'מתמטיקה' ? (mathLevel || '5') : null;
  return level ? list.filter((c) => String(c.level) === String(level)) : list;
}

// רשימת הפרקים המסודרת של נבחן (לפי המקצועות שבחר), למודל החי.
// מחזיר מערך של {subject, level, chapter_id}.
// כשמקצוע חוזר (נבחרו פחות מ-3 → הראשי ממלא) — כל חזרה מקבלת וריאנט *אחר*,
// עד גודל הפול. אם נגמרו הווריאנטים למקצוע — לא מוסיפים כפילות.
function chapterListFor(subjects, mathLevel) {
  const chapterSubjects = buildChapterSubjects(subjects);
  const taken = {};
  const out = [];
  for (const subject of chapterSubjects) {
    const level = subject === 'מתמטיקה' ? (mathLevel || '5') : null;
    const pool = poolFor(subject, mathLevel);
    const k = taken[subject] || 0;
    if (k < pool.length) {
      out.push({ subject, level, chapter_id: pool[k].chapter_id });
      taken[subject] = k + 1;
    }
  }
  return out;
}

// הפרק הבא שטרם נעשה (מתוך הרשימה), בהינתן קבוצת מזהי הפרקים שכבר הוגשו.
function nextChapter(servedChapterIds, chapterList) {
  const served = servedChapterIds instanceof Set ? servedChapterIds : new Set(servedChapterIds || []);
  return chapterList.find((c) => !served.has(c.chapter_id)) || null;
}

module.exports = {
  NUM_ROUNDS,
  NUM_CHAPTERS,
  NUM_CHOSEN,
  GENERAL_SUBJECT,
  lowerLevel,
  buildChapterSubjects,
  pickInterviewRound,
  buildPlan,
  chapterListFor,
  nextChapter,
};
