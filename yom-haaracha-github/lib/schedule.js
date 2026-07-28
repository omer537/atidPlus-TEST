'use strict';
/*
 * בניית לוח המשבצות לכל נבחן: 5 סבבים = 4 פרקי מבחן + ריאיון אחד.
 * המנוע "משעמם" ומפורש בכוונה — קל להבין ולתקן.
 */
const content = require('./content');

const NUM_ROUNDS = 5;
const NUM_CHAPTERS = 4;

// מתמטיקה: 5 → 4 → 3. לא יורד מתחת ל-3.
function lowerLevel(level) {
  const n = Number(level);
  if (!n || n <= 3) return '3';
  return String(n - 1);
}

// בונה רשימת 4 מקצועות לפרקים: אם נבחרו פחות מ-4, הנושא הראשי חוזר וממלא.
function buildChapterSubjects(subjects) {
  const chosen = (subjects || []).filter(Boolean);
  const main = chosen[0];
  const out = chosen.slice(0, NUM_CHAPTERS);
  while (out.length < NUM_CHAPTERS && main) out.push(main);
  return out;
}

// בוחר את סבב הריאיון המאוזן ביותר (עד ~8 ריאיונות בסבב, כמספר המראיינים).
function pickInterviewRound(roundCounts, maxPerRound = 8) {
  let best = 1, bestCount = Infinity;
  for (let r = 1; r <= NUM_ROUNDS; r++) {
    const c = roundCounts[r] || 0;
    if (c < bestCount) { bestCount = c; best = r; }
  }
  return best;
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

  for (let round = 1; round <= NUM_ROUNDS; round++) {
    if (round === interviewRound) {
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

module.exports = {
  NUM_ROUNDS,
  NUM_CHAPTERS,
  lowerLevel,
  buildChapterSubjects,
  pickInterviewRound,
  buildPlan,
};
