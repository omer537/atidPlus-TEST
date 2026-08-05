'use strict';
/* =========================================================================
   מנוע הניקוד — טהור, בלי תלות ברשת/DB, קל לבדיקה.
   כל הציונים על סולם 1–5.

   ★ העיקרון: ההוראה היא הציון. המקצוע הוא בונוס על גביו — לא רכיב בממוצע.
   ממוצע משוקלל היה *מעניש* מועמדת על עצם זה שנבחנה במתמטיקה (אם ציונה שם
   נמוך מציון ההוראה שלה). בונוס לעולם לא מוריד לאף אחד, ואי אפשר להגיע
   לציון גבוה בזכות המקצוע לבד.

     1. רב-מלל  = 0.75·הוראה + 0.25·כללי            ← לכל הנבחנים
        • הוראה = diagnosis_fit + clarity על *כל* התשובות הכתובות
        • כללי  = פרק «מידע כללי» (רב-ברירה + accuracy/depth) — קנה המידה
                  ההוגן היחיד, כי כולם עשו אותו פרק בדיוק
     2. ציון לכל מקצוע = 0.5·רב-ברירה + 0.5·ממוצע(accuracy, depth)
     3. בונוס = min(תקרת המקצוע, 0.5·max(0, ציון−3.0)) — המקצוע החזק בלבד
     4. סופי  = min(5, רב-מלל + בונוס)

   אין ספירה כפולה: accuracy/depth נכנסים לציון המקצוע, diagnosis_fit/clarity
   לציון ההוראה.
   ========================================================================= */

// ---------- קבועים ניתנים לכיוונון (נשמרים לכל מחזור) ----------
const CONFIG = {
  W_MC: 0.5,            // משקל רב-ברירה מול «למד» בציון התוכן של פרק
  W_TEACH: 0.75,        // חלק ההוראה ברב-מלל
  W_GENERAL: 0.25,      // חלק הפרק הכללי ברב-מלל
  BONUS_SLOPE: 0.5,     // כמה בונוס לכל נקודה מעל הרצפה
  BONUS_FLOOR: 3.0,     // מתחת לזה — אפס בונוס (בלי קנס)
  ACCURACY_GATE: 2,     // דיוק ≤ זה → "יפה אך שגוי": קיצוץ תרומת ההוראה של הפריט
  GATE_FACTOR: 0.5,     // כמה לקצץ (0.5 = חוצי את החלק שמעל הרצפה)
  MAX_FINAL: 5,
};

// תקרת הבונוס לכל מקצוע — משקפת כמה קשה למצוא מלגאי שיודע אותו.
// מקצוע שאינו בטבלה (לשון · היסטוריה · יזמות) מדווח אך לא מקבל בונוס.
// למתמטיקה התקרה תלויה ברמה (5/4/3 יח״ל).
const BONUS_CAPS = {
  'מתמטיקה': { '5': 0.5, '4': 0.4, '3': 0.3, _default: 0.4 },
  'פיזיקה': 0.5,
  'אנגלית': 0.4,
  'רובוטיקה': 0.4,
  'ביולוגיה': 0.3,
  'מדעים לחטיבה': 0.3,
};

// ---------- מיפוי מקצוע → תחום ----------
const GENERAL_SUBJECT = 'מידע כללי';
const SUBJECT_DOMAIN = {
  'מתמטיקה': 'quant', 'פיזיקה': 'quant', 'רובוטיקה': 'quant', 'מדעים לחטיבה': 'quant', 'ביולוגיה': 'quant',
  'לשון': 'verbal', 'היסטוריה': 'verbal', 'יזמות גירלס פלוס': 'verbal',
  'אנגלית': 'english',
  'מידע כללי': 'general',
};
const DOMAIN_LABEL = { quant: 'כמותי', verbal: 'מילולי', english: 'אנגלית', general: 'כללי' };

// ⚠ «מידע כללי» מקבל דלי משלו (`general`) ולא null. בגרסה קודמת הוא קיבל null
// ונזרק ב-continue — כך אבד הפרק היחיד שכל הנבחנים עשו.
function DOMAIN_OF(subject) {
  return SUBJECT_DOMAIN[subject] || null;
}

// ---------- שיוך קריטריון לציר (כולל שמות ישנים מהבנק, ליתר ביטחון) ----------
const AXIS_OF = {
  accuracy: 'content', depth: 'content', correctness: 'content', relevance: 'content',
  diagnosis_fit: 'teach', clarity: 'teach', fit_to_student: 'teach', identifies_error: 'teach',
};
const CRITERIA = ['accuracy', 'depth', 'diagnosis_fit', 'clarity'];
const CRITERION_LABEL = {
  accuracy: 'דיוק תוכני',
  depth: 'עומק ותובנה',
  diagnosis_fit: 'אבחון והתאמה לתלמיד',
  clarity: 'בהירות ובניית ההבנה',
};

// ---------- עזרי חשבון ----------
function clamp15(x) { return Math.max(1, Math.min(5, x)); }
function mean(arr) {
  const nums = arr.filter((n) => typeof n === 'number' && isFinite(n));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function isMcType(type) { return type === 'mc_apply' || type === 'mc_error_dialogue'; }
function isTeachType(type) { return type === 'text_teach' || type === 'text_teach_error'; }
function round1(x) { return x == null ? null : Math.round(x * 10) / 10; }
function round2(x) { return x == null ? null : Math.round(x * 100) / 100; }

// ---------- תקרת הבונוס ----------
// מקצוע שאינו בטבלה → 0 (מדווח, בלי בונוס).
function bonusCapFor(subject, level) {
  const cap = BONUS_CAPS[subject];
  if (cap == null) return 0;
  if (typeof cap === 'number') return cap;
  const key = String(level == null ? '' : level).trim();
  return (cap[key] != null) ? cap[key] : cap._default;
}

// ---------- בונוס למקצוע בודד ----------
// פונקציה טהורה: ציון 4.5 במתמטיקה 5 יח״ל → +0.5 · אותו ציון במדעים → +0.3
// ציון מתחת ל-BONUS_FLOOR → 0, בלי קנס.
function subjectBonus(subject, level, subjectScore, cfg) {
  cfg = cfg || CONFIG;
  if (typeof subjectScore !== 'number' || !isFinite(subjectScore)) return 0;
  const cap = bonusCapFor(subject, level);
  if (!cap) return 0;
  const raw = cfg.BONUS_SLOPE * Math.max(0, subjectScore - cfg.BONUS_FLOOR);
  return Math.min(cap, raw);
}

// ---------- ציון פריט בודד ----------
// קלט: { type, mcCorrect:bool|null, dontKnow:bool, scores:{criterion:1-5} }
// פלט: { content:1-5|null, teach:1-5|null, isMC, isTeach, raw:{criterion:1-5} }
function scoreItem(input, cfg) {
  cfg = cfg || CONFIG;
  const type = input.type;
  if (isMcType(type)) {
    const content = input.dontKnow ? 1 : (input.mcCorrect ? 5 : 1);
    return { content: content, teach: null, isMC: true, isTeach: false, raw: {} };
  }
  if (isTeachType(type)) {
    if (input.dontKnow) {
      const raw = {};
      CRITERIA.forEach(function (c) { raw[c] = 1; });
      return { content: 1, teach: 1, isMC: false, isTeach: true, raw: raw };
    }
    const scores = input.scores || {};
    const contentVals = [], teachVals = [], raw = {};
    for (const k of Object.keys(scores)) {
      const axis = AXIS_OF[k];
      const v = Number(scores[k]);
      if (!isFinite(v)) continue;
      const c = clamp15(v);
      raw[k] = c;
      if (axis === 'content') contentVals.push(c);
      else if (axis === 'teach') teachVals.push(c);
    }
    let content = mean(contentVals);
    let teach = mean(teachVals);
    // שער הדיוק: תוכן שגוי מקצץ את תרומת ההוראה של אותו פריט ("יפה אך שגוי").
    const accuracy = (typeof scores.accuracy === 'number') ? scores.accuracy
      : (typeof scores.correctness === 'number' ? scores.correctness : null);
    if (teach != null && accuracy != null && accuracy <= cfg.ACCURACY_GATE) {
      teach = 1 + (teach - 1) * cfg.GATE_FACTOR;
    }
    return { content: content, teach: teach, isMC: false, isTeach: true, raw: raw };
  }
  // סוגי מקור/כלל/פונקציה — לא נענים, לא נכנסים לניקוד
  return { content: null, teach: null, isMC: false, isTeach: false, raw: {} };
}

// ---------- ציון תוכן לפרק אחד ----------
function chapterContent(scoredItems, cfg) {
  cfg = cfg || CONFIG;
  const mcContent = mean(scoredItems.filter((s) => s.isMC).map((s) => s.content));
  const teachContent = mean(scoredItems.filter((s) => s.isTeach).map((s) => s.content));
  if (mcContent != null && teachContent != null) {
    return cfg.W_MC * mcContent + (1 - cfg.W_MC) * teachContent;
  }
  return mcContent != null ? mcContent : teachContent; // אחד מהם או null
}

// ---------- מיזוג שני רכיבים עם נרמול משקלים ----------
// אם אחד חסר — השני נושא 100%. אף אחד לא נענש על מה שלא נבחן בו.
function blend(a, wa, b, wb) {
  const okA = typeof a === 'number' && isFinite(a);
  const okB = typeof b === 'number' && isFinite(b);
  if (okA && okB) return (wa * a + wb * b) / (wa + wb);
  if (okA) return a;
  if (okB) return b;
  return null;
}

// ---------- ציון מלא לנבחן ----------
// קלט: { chapters: [ { subject, level, chapter_id, items:[scoreItem-input] } ], mathLevel }
function computeScores(examinee, cfg) {
  cfg = cfg || CONFIG;
  const chapters = examinee.chapters || [];
  const mathLevel = examinee.mathLevel != null ? examinee.mathLevel : examinee.math_level;

  const allTeach = [];                 // ציר ההוראה — חוצה את כל המקצועות
  const rawByCriterion = {};           // הפרופיל (לפני שער הדיוק)
  const contentsBySubject = {};        // מקצוע → [ציוני תוכן של פרקיו]
  const levelBySubject = {};           // מקצוע → רמה (למתמטיקה)
  let teachTotal = 0, teachScored = 0; // כמה תשובות כתובות יש, וכמה מהן נוקדו

  CRITERIA.forEach(function (c) { rawByCriterion[c] = []; });

  for (const ch of chapters) {
    const scored = (ch.items || []).map((it) => scoreItem(it, cfg));
    scored.forEach(function (s, i) {
      if (s.isTeach) {
        teachTotal++;
        if (s.teach != null || s.content != null) teachScored++;
      }
      if (s.isTeach && s.teach != null) allTeach.push(s.teach);
      CRITERIA.forEach(function (c) { if (s.raw && s.raw[c] != null) rawByCriterion[c].push(s.raw[c]); });
    });
    const subject = ch.subject;
    if (!subject) continue;
    const cc = chapterContent(scored, cfg);
    if (cc == null) continue;
    (contentsBySubject[subject] = contentsBySubject[subject] || []).push(cc);
    if (ch.level != null && ch.level !== '') levelBySubject[subject] = ch.level;
  }

  // ציון לכל מקצוע (ממוצע פרקיו)
  const perSubject = {};
  for (const s of Object.keys(contentsBySubject)) perSubject[s] = mean(contentsBySubject[s]);

  // ---- רב-מלל: ציר ההוראה + הפרק הכללי ----
  const teachAxis = mean(allTeach);
  const general = perSubject[GENERAL_SUBJECT] != null ? perSubject[GENERAL_SUBJECT] : null;
  const ravMelel = blend(teachAxis, cfg.W_TEACH, general, cfg.W_GENERAL);

  // ---- בונוס: המקצוע שנותן את הבונוס הגדול ביותר ----
  // (לא בהכרח הציון הגבוה — התקרות שונות בין מקצועות)
  let bonus = 0, bonusFrom = null;
  for (const s of Object.keys(perSubject)) {
    if (s === GENERAL_SUBJECT) continue;
    const level = (s === 'מתמטיקה') ? (levelBySubject[s] != null ? levelBySubject[s] : mathLevel) : levelBySubject[s];
    const b = subjectBonus(s, level, perSubject[s], cfg);
    if (b > bonus) { bonus = b; bonusFrom = s; }
  }

  const final = (ravMelel == null) ? null : Math.min(cfg.MAX_FINAL, ravMelel + bonus);

  // ---- ציוני תחום לגיליון (ממוצע המקצועות שבתחום) ----
  const domains = {};
  for (const s of Object.keys(perSubject)) {
    const d = DOMAIN_OF(s);
    if (!d || d === 'general') continue;
    (domains[d] = domains[d] || []).push(perSubject[s]);
  }
  const domainScores = {};
  for (const d of Object.keys(domains)) domainScores[d] = mean(domains[d]);

  const domainsLabeled = {};
  for (const d of Object.keys(domainScores)) domainsLabeled[DOMAIN_LABEL[d] || d] = round1(domainScores[d]);

  const perSubjectRounded = {};
  for (const s of Object.keys(perSubject)) perSubjectRounded[s] = round1(perSubject[s]);

  const criteria = {};
  CRITERIA.forEach(function (c) { criteria[c] = round1(mean(rawByCriterion[c])); });

  // תחום מוביל (לגיליון)
  let topDomain = null, topVal = -1;
  for (const d of Object.keys(domainScores)) {
    if (domainScores[d] != null && domainScores[d] > topVal) { topVal = domainScores[d]; topDomain = d; }
  }

  return {
    ravMelel: round1(ravMelel),
    teachAxis: round1(teachAxis),
    general: round1(general),
    perSubject: perSubjectRounded,
    domains: domainScores,                 // גלמי, לשימוש פנימי
    domainsLabeled: domainsLabeled,        // בעברית, מעוגל
    quant: round1(domainScores.quant),
    verbal: round1(domainScores.verbal),
    english: round1(domainScores.english),
    bonus: round2(bonus),
    bonusFrom: bonusFrom,
    bonusLabel: bonusFrom ? subjectLabel(bonusFrom, levelBySubject[bonusFrom] || mathLevel) : null,
    criteria: criteria,
    // ⚠ כל עוד תשובות כתובות טרם נוקדו, הציון חלקי ומטעה — הגיליון יציג
    // «טרם נבדק» ולא מספר. בלי זה גיליון לפני בדיקת ה-AI מראה 5.0 לכולם.
    teachTotal: teachTotal,
    teachScored: teachScored,
    pending: teachTotal > teachScored,
    subjectLevels: levelBySubject,          // מקצוע → רמה, כפי שהופיעה בפרק
    mathLevel: mathLevel != null ? String(mathLevel)
      : (levelBySubject['מתמטיקה'] != null ? String(levelBySubject['מתמטיקה']) : null),
    final: round1(final),
    topDomain: topDomain ? (DOMAIN_LABEL[topDomain] || topDomain) : null,
    // תאימות לאחור — עמודות קיימות ב-DB ובגיליון
    teaching: round1(ravMelel),
    content: round1(domainScores.quant != null || domainScores.english != null
      ? Math.max(domainScores.quant == null ? -1 : domainScores.quant,
                 domainScores.english == null ? -1 : domainScores.english)
      : null),
    breadthBonus: round2(bonus),
  };
}

// «מתמטיקה 5 יח״ל» / «אנגלית»
function subjectLabel(subject, level) {
  if (subject === 'מתמטיקה' && level != null && String(level).trim() !== '') {
    return subject + ' ' + String(level).trim() + ' יח״ל';
  }
  return subject;
}

// רשימת המקצועות עם הציון — לעמודת «מקצועות» בגיליון
// «מתמטיקה 5 יח״ל 4.2 · אנגלית 3.6»
// withScores=false → שמות בלבד, לשימוש לפני שהבדיקה רצה (הציון היה מטעה).
function subjectsLabel(result, withScores) {
  const per = (result && result.perSubject) || {};
  const levels = (result && result.subjectLevels) || {};
  const showScores = withScores !== false;
  const parts = [];
  for (const s of Object.keys(per)) {
    if (s === GENERAL_SUBJECT) continue;
    if (per[s] == null) continue;
    const level = levels[s] != null ? levels[s] : (s === 'מתמטיקה' ? result.mathLevel : null);
    parts.push(subjectLabel(s, level) + (showScores ? ' ' + per[s].toFixed(1) : ''));
  }
  return parts.join(' · ');
}

// ---------- המלצה מילולית (דטרמיניסטית) ----------
function buildRecommendation(result, opts) {
  opts = opts || {};
  const parts = [];
  const rav = result.ravMelel;

  if (rav != null) {
    if (rav >= 4.5) parts.push('עילוי הוראה.');
    else if (rav >= 4.0) parts.push('הוראה חזקה.');
    else if (rav >= 3.0) parts.push('הוראה סבירה.');
    else parts.push('ההוראה חלשה — דורשת ליווי צמוד.');
  }

  if (result.bonusFrom && result.bonus > 0) {
    parts.push('יתרון: ' + result.bonusLabel + ' ' + (result.perSubject[result.bonusFrom]).toFixed(1) + '.');
  }

  // מה לחזק — לפי הקריטריון החלש ביותר
  const crit = result.criteria || {};
  let worst = null, worstVal = 6;
  CRITERIA.forEach(function (c) {
    if (crit[c] != null && crit[c] < worstVal) { worstVal = crit[c]; worst = c; }
  });
  if (worst && worstVal < 3.5) parts.push('לחיזוק: ' + CRITERION_LABEL[worst] + '.');

  // מקצוע חלש שנבחנה בו בכל זאת
  const weakSubjects = [];
  for (const s of Object.keys(result.perSubject || {})) {
    if (s === GENERAL_SUBJECT) continue;
    if (result.perSubject[s] != null && result.perSubject[s] < 3.0) weakSubjects.push(s);
  }
  if (weakSubjects.length) parts.push('שליטה חלשה ב' + weakSubjects.join(', ') + '.');

  if (opts.partial) parts.push('מבחן חלקי — הציון על מה שקיים.');
  if (!parts.length) parts.push('אין די נתונים לציון.');
  return parts.join(' ');
}

module.exports = {
  CONFIG,
  CRITERIA,
  CRITERION_LABEL,
  DOMAIN_LABEL,
  BONUS_CAPS,
  AXIS_OF,
  DOMAIN_OF,
  GENERAL_SUBJECT,
  bonusCapFor,
  subjectBonus,
  scoreItem,
  chapterContent,
  blend,
  computeScores,
  subjectLabel,
  subjectsLabel,
  buildRecommendation,
};
