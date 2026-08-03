'use strict';
/* =========================================================================
   התאמת שמות בעברית — לשיוך בריפים לנבחנים.
   הבעיה: המנהל כותב את השם בבריף אחרת ממה שהנבחן הקליד בהרשמה
   (גרשיים, אות סופית, שם אמצעי, טעות הקלדה).

   ⚠ עקרון: התאמה **מדויקת** משייכת אוטומטית. התאמה **מקורבת** רק מוצעת —
   שיוך בריף לנבחן הלא-נכון הוא נזק אמיתי בריאיון, ולכן אדם מאשר.
   ========================================================================= */

// נרמול בסיסי (זהה ל-normName בשרת): trim + כיווץ רווחים.
function normBasic(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
}

// נרמול "רחב" להשוואה בלבד: מסיר גרשיים/אפוסטרופים/מקפים/נקודות/פסיקים,
// ומנרמל אותיות סופיות (ם→מ, ן→נ, ץ→צ, ף→פ, ך→כ) — מקור נפוץ לפערים.
const FINALS = { 'ם': 'מ', 'ן': 'נ', 'ץ': 'צ', 'ף': 'פ', 'ך': 'כ' };
function normLoose(s) {
  let t = normBasic(s).toLowerCase();
  t = t.replace(/["'`׳״.,\-–_()]/g, '');   // סימני פיסוק שנוטים להשתנות
  t = t.replace(/\s+/g, ' ').trim();
  return t.split('').map((ch) => FINALS[ch] || ch).join('');
}

// שם-פרטי + שם-משפחה בלבד (מתעלם משמות אמצעיים)
function firstLast(s) {
  const parts = normLoose(s).split(' ').filter(Boolean);
  if (parts.length <= 1) return parts.join(' ');
  return parts[0] + ' ' + parts[parts.length - 1];
}

// מרחק עריכה (Levenshtein) — עם תקרה כדי לא לבזבז חישוב
function editDistance(a, b, max) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array(lb + 1);
  let cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;   // כל השורה חורגת — אין סיכוי
    const t = prev; prev = cur; cur = t;
  }
  return prev[lb];
}

/*
 * מחפש התאמה לשם אחד מול רשימת מועמדים.
 *   rawName    — השם כפי שהודבק
 *   candidates — [{ code, name }]
 * מחזיר { exact: {code,name}|null, suggestions: [{code,name,reason,confidence}] }
 * confidence: 'high' | 'medium' | 'low'
 */
function matchName(rawName, candidates) {
  const out = { exact: null, suggestions: [] };
  const raw = normBasic(rawName);
  if (!raw) return out;

  const list = (candidates || []).map((c) => ({
    code: c.code,
    name: c.name,
    basic: normBasic(c.name),
    loose: normLoose(c.name),
    fl: firstLast(c.name),
  }));

  // 1) התאמה מדויקת (אחרי נרמול בסיסי) — משייכים
  const exact = list.filter((c) => c.basic === raw);
  if (exact.length === 1) { out.exact = { code: exact[0].code, name: exact[0].name }; return out; }
  if (exact.length > 1) {
    // שני נבחנים באותו שם מדויק — לא מכריעים לבד
    out.suggestions = exact.map((c) => ({ code: c.code, name: c.name, reason: 'שם זהה לשני נבחנים', confidence: 'low' }));
    return out;
  }

  const rawLoose = normLoose(raw);
  const rawFl = firstLast(raw);

  // 2) התאמה אחרי נרמול רחב (גרשיים/אות סופית) — מוצע בביטחון גבוה
  const looseHits = list.filter((c) => c.loose === rawLoose);
  looseHits.forEach((c) => out.suggestions.push({ code: c.code, name: c.name, reason: 'הבדל בגרשיים/אות סופית', confidence: 'high' }));

  // 3) שם פרטי + משפחה זהים (שם אמצעי שונה) — ביטחון גבוה
  if (rawFl) {
    list.filter((c) => c.fl === rawFl && !out.suggestions.some((s) => s.code === c.code))
      .forEach((c) => out.suggestions.push({ code: c.code, name: c.name, reason: 'שם פרטי ומשפחה זהים (שם אמצעי שונה)', confidence: 'high' }));
  }

  // 4) מרחק עריכה קטן — ביטחון בינוני/נמוך
  if (rawLoose.length >= 4) {
    const scored = [];
    list.forEach((c) => {
      if (out.suggestions.some((s) => s.code === c.code)) return;
      const d = Math.min(editDistance(rawLoose, c.loose, 2), editDistance(rawFl, c.fl, 2));
      if (d <= 2) scored.push({ c: c, d: d });
    });
    scored.sort((x, y) => x.d - y.d);
    scored.slice(0, 4).forEach((s) => out.suggestions.push({
      code: s.c.code, name: s.c.name,
      reason: 'שם דומה (הפרש ' + s.d + ' תווים)',
      confidence: s.d === 1 ? 'medium' : 'low',
    }));
  }

  return out;
}

module.exports = { normBasic, normLoose, firstLast, editDistance, matchName };
