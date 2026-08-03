'use strict';
/* =========================================================================
   מנוע הניקוד — טהור, בלי תלות ברשת/DB, קל לבדיקה.
   כל הציונים על סולם 1–5 (כמו שאר חלקי יום ההערכה).

   שני צירים:
     • תוכן   — שליטה בחומר (רב-ברירה + קריטריוני התוכן של «למד»).
     • הוראה  — יכולת ללמד (קריטריוני ההוראה של «למד»), חוצה כל המקצועות.

   ציון סופי = TEACH_WEIGHT·הוראה + CONTENT_WEIGHT·תוכן, כשהתוכן הוא
   "שיא + פרס-רוחב מבוקר" בין התחומים (מצוין-באחד ≈ טוב-בשניים אבל לא נעקף;
   בינוני לא מקבל פרס). ראו README/תוכנית.
   ========================================================================= */

// ---------- קבועים ניתנים לכיוונון (נשמרים לכל מחזור) ----------
const CONFIG = {
  W_MC: 0.5,            // משקל רב-ברירה מול «למד» בציון התוכן של פרק
  BETA: 0.5,            // מקדם פרס-הרוחב
  TAU: 3.0,             // סף: תחום נוסף מתחת לסף לא נותן פרס (בינוני לא נחלץ)
  DELTA: 0.5,           // תקרת פרס-הרוחב (טוב-בשניים לא עוקף מצוין-באחד)
  TEACH_WEIGHT: 0.6,    // דגש על ההוראה
  CONTENT_WEIGHT: 0.4,
  ACCURACY_GATE: 2,     // דיוק ≤ זה → "יפה אך שגוי": קיצוץ תרומת ההוראה של הפריט
  GATE_FACTOR: 0.5,     // כמה לקצץ (0.5 = חוצי את החלק שמעל הרצפה)
};

// ---------- מיפוי מקצוע → תחום ----------
const GENERAL_SUBJECT = 'מידע כללי';
const SUBJECT_DOMAIN = {
  'מתמטיקה': 'quant', 'פיזיקה': 'quant', 'רובוטיקה': 'quant', 'מדעים לחטיבה': 'quant', 'ביולוגיה': 'quant',
  'לשון': 'verbal', 'היסטוריה': 'verbal', 'יזמות גירלס פלוס': 'verbal',
  'אנגלית': 'english',
};
const DOMAIN_LABEL = { quant: 'כמותי', verbal: 'מילולי', english: 'אנגלית' };

function DOMAIN_OF(subject) {
  return SUBJECT_DOMAIN[subject] || null; // «מידע כללי»/לא-מוכר → null (אינו תחום)
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

// ---------- ציון פריט בודד ----------
// קלט: { type, mcCorrect:bool|null, dontKnow:bool, scores:{criterion:1-5} }
// פלט: { content:1-5|null, teach:1-5|null, isMC:bool, isTeach:bool }
function scoreItem(input, cfg) {
  cfg = cfg || CONFIG;
  const type = input.type;
  if (isMcType(type)) {
    const content = input.dontKnow ? 1 : (input.mcCorrect ? 5 : 1);
    return { content: content, teach: null, isMC: true, isTeach: false };
  }
  if (isTeachType(type)) {
    if (input.dontKnow) return { content: 1, teach: 1, isMC: false, isTeach: true };
    const scores = input.scores || {};
    const contentVals = [], teachVals = [];
    for (const k of Object.keys(scores)) {
      const axis = AXIS_OF[k];
      const v = Number(scores[k]);
      if (!isFinite(v)) continue;
      if (axis === 'content') contentVals.push(clamp15(v));
      else if (axis === 'teach') teachVals.push(clamp15(v));
    }
    let content = mean(contentVals);
    let teach = mean(teachVals);
    // שער הדיוק: תוכן שגוי מקצץ את תרומת ההוראה של אותו פריט ("יפה אך שגוי").
    const accuracy = (typeof scores.accuracy === 'number') ? scores.accuracy
      : (typeof scores.correctness === 'number' ? scores.correctness : null);
    if (teach != null && accuracy != null && accuracy <= cfg.ACCURACY_GATE) {
      teach = 1 + (teach - 1) * cfg.GATE_FACTOR;
    }
    return { content: content, teach: teach, isMC: false, isTeach: true };
  }
  // סוגי מקור/כלל/פונקציה — לא נענים, לא נכנסים לניקוד
  return { content: null, teach: null, isMC: false, isTeach: false };
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

// ---------- ציון תוכן מרוכב: שיא + פרס-רוחב מבוקר ----------
function contentComposite(domainScores, cfg) {
  cfg = cfg || CONFIG;
  const vals = Object.keys(domainScores)
    .map((d) => domainScores[d])
    .filter((v) => typeof v === 'number' && isFinite(v))
    .sort((a, b) => b - a);
  if (!vals.length) return { content: null, peak: null, breadthBonus: 0 };
  const peak = vals[0];
  let extra = 0;
  for (let k = 1; k < vals.length; k++) extra += Math.max(0, vals[k] - cfg.TAU);
  const breadthBonus = Math.min(cfg.DELTA, cfg.BETA * extra);
  return { content: clamp15(peak + breadthBonus), peak: peak, breadthBonus: breadthBonus };
}

// ---------- ציון מלא לנבחן ----------
// קלט: { chapters: [ { subject, level, chapter_id, items:[scoreItem-input] } ] }
// פלט: { domains, domainsLabeled, teaching, contentComposite, breadthBonus, final, topDomain }
function computeScores(examinee, cfg) {
  cfg = cfg || CONFIG;
  const chapters = examinee.chapters || [];
  const allTeach = [];               // כל פריטי ה«למד» — לציון ההוראה החוצה
  const domainChapterContents = {};  // domain -> [ציון תוכן של פרק]

  for (const ch of chapters) {
    const scored = (ch.items || []).map((it) => scoreItem(it, cfg));
    scored.forEach((s) => { if (s.isTeach && s.teach != null) allTeach.push(s.teach); });
    const domain = DOMAIN_OF(ch.subject);
    if (!domain) continue; // «מידע כללי» מזין רק הוראה — לא נכנס לתחומים
    const cc = chapterContent(scored, cfg);
    if (cc == null) continue;
    (domainChapterContents[domain] = domainChapterContents[domain] || []).push(cc);
  }

  const domains = {};
  for (const d of Object.keys(domainChapterContents)) domains[d] = mean(domainChapterContents[d]);

  const teaching = mean(allTeach);
  const comp = contentComposite(domains, cfg);

  let final;
  if (comp.content != null && teaching != null) {
    final = clamp15(cfg.TEACH_WEIGHT * teaching + cfg.CONTENT_WEIGHT * comp.content);
  } else if (teaching != null) {
    final = clamp15(teaching);
  } else if (comp.content != null) {
    final = clamp15(comp.content);
  } else {
    final = null;
  }

  // תחום מוביל (לגיליון)
  let topDomain = null, topVal = -1;
  for (const d of Object.keys(domains)) {
    if (domains[d] != null && domains[d] > topVal) { topVal = domains[d]; topDomain = d; }
  }

  const domainsLabeled = {};
  for (const d of Object.keys(domains)) domainsLabeled[DOMAIN_LABEL[d] || d] = round1(domains[d]);

  return {
    domains: domains,                                   // {quant,verbal,english} על 1–5 (או חסר)
    domainsLabeled: domainsLabeled,                     // בעברית, מעוגל
    teaching: teaching == null ? null : round1(teaching),
    content: comp.content == null ? null : round1(comp.content),
    breadthBonus: round2(comp.breadthBonus || 0),
    final: final == null ? null : round1(final),
    topDomain: topDomain ? (DOMAIN_LABEL[topDomain] || topDomain) : null,
  };
}

function round1(x) { return x == null ? null : Math.round(x * 10) / 10; }
function round2(x) { return x == null ? null : Math.round(x * 100) / 100; }

// ---------- המלצה מילולית (דטרמיניסטית) ----------
function buildRecommendation(result, opts) {
  opts = opts || {};
  const parts = [];
  const strong = [], weak = [];
  for (const label of Object.keys(result.domainsLabeled || {})) {
    const v = result.domainsLabeled[label];
    if (v >= 4.0) strong.push(label);
    else if (v < 3.0) weak.push(label);
  }
  if (result.teaching != null) {
    if (result.teaching >= 4.0) strong.unshift('יכולת הוראה');
    else if (result.teaching < 3.0) weak.unshift('יכולת הוראה');
  }
  if (strong.length) parts.push('חוזקות: ' + strong.join(', ') + '.');
  if (weak.length) parts.push('לחיזוק: ' + weak.join(', ') + '.');
  if (opts.mathLevel && opts.mathWeak) {
    parts.push('ביצועים חלשים ברמת ' + opts.mathLevel + ' יח״ל — ייתכן שמתאים ללמד ברמה נמוכה יותר.');
  }
  if (!parts.length) parts.push('ביצועים תקינים על פני המקצועות שנבחרו.');
  return parts.join(' ');
}

module.exports = {
  CONFIG,
  CRITERIA,
  CRITERION_LABEL,
  DOMAIN_LABEL,
  AXIS_OF,
  DOMAIN_OF,
  GENERAL_SUBJECT,
  scoreItem,
  chapterContent,
  contentComposite,
  computeScores,
  buildRecommendation,
};
