'use strict';
/* בדיקת שרשרת הבדיקה המקובצת — בלי שרת ובלי קריאות API בתשלום.
   הרצה:  node scripts/tests/aigrade_test.js                 (מתיקיית app)

   הסיכון שנבדק כאן: בקריאה מקובצת נשלחות עד 8 תשובות של נבחנים שונים,
   וציון שנצמד לנבחן הלא-נכון הוא כשל שקט וחמור. */

const G = require('../../lib/aiGrade');

const fail = [];
function check(c, m) { if (!c) { fail.push(m); console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); }
function eq(a, b, m) { check(a === b, m + '  (קיבלתי ' + a + ', ציפיתי ' + b + ')'); }

console.log('\n=== 1. קיבוץ לפי שאלה ===');
const items = [];
// 20 תשובות לשאלה אחת, 3 לשנייה, 1 לשלישית
for (let i = 0; i < 20; i++) items.push({ code: 'e' + i, chapter_id: 'general_framing_01', item_id: 'q1t' });
for (let i = 0; i < 3; i++) items.push({ code: 'e' + i, chapter_id: 'general_framing_01', item_id: 'q2t' });
items.push({ code: 'x1', chapter_id: 'math_5_calculus_01', item_id: 'q1t' });

const groups = G.groupItemsByQuestion(items, 8);
eq(groups.length, 3 + 1 + 1, 'מספר הקבוצות: 20→3 קבוצות, 3→1, 1→1');
eq(groups.reduce((n, g) => n + g.length, 0), items.length, 'אף פריט לא נעלם בקיבוץ');
check(groups.every((g) => g.length <= 8), 'אין קבוצה גדולה מ-8');
check(groups.every((g) => new Set(g.map((x) => x.chapter_id + x.item_id)).size === 1),
  'כל קבוצה מכילה שאלה אחת בלבד — לא מערבבים שאלות בקריאה אחת');
eq(G.groupItemsByQuestion([], 8).length, 0, 'רשימה ריקה → אין קבוצות');
// כל הקודים נשמרים בדיוק פעם אחת
const flatKeys = groups.flat().map((x) => x.code + '|' + x.chapter_id + '|' + x.item_id);
eq(new Set(flatKeys).size, flatKeys.length, 'אין כפילויות בין הקבוצות');

console.log('\n=== 2. מפתחות אטומיים בפרומפט — בלי שמות נבחנים ===');
const prompt = G.buildBatchPrompt('לשון', 'קטע לדוגמה', 'הסבר לתלמיד…', [
  { key: 'a1', answer: 'תשובה של יוחאי' },
  { key: 'a2', answer: 'תשובה של מזל' },
]);
check(prompt.indexOf('key: a1') > 0 && prompt.indexOf('key: a2') > 0, 'שני המפתחות מופיעים');
check(prompt.indexOf('יוחאי') > 0, 'תוכן התשובה נשלח כמו שהוא');
check(prompt.indexOf('2 תשובות') > 0, 'הפרומפט מציין כמה תשובות יש');
check(prompt.indexOf('קטע לדוגמה') > 0, 'הקטע נשלח פעם אחת לקבוצה');

console.log('\n=== 3. נרמול רשומה מהמודל ===');
const good = G.normalizeEntry({ key: 'a1', accuracy: 5, depth: 4, diagnosis_fit: 3, clarity: 2,
  conclusion: 'טוב', attention: '', confidence: 'high', evidence: 'ציטוט' });
check(good.ok, 'רשומה מלאה → ok');
eq(good.criteria.accuracy, 5, 'דיוק נשמר');
eq(good.criteria.clarity, 2, 'בהירות נשמרת');
const partial = G.normalizeEntry({ key: 'a1', accuracy: 5, depth: 4 });
check(!partial.ok, 'רשומה חסרת קריטריונים → לא ok (תסומן failed ותרוץ שוב)');
const outOfRange = G.normalizeEntry({ accuracy: 9, depth: -2, diagnosis_fit: 3, clarity: 3, confidence: 'bogus' });
eq(outOfRange.criteria.accuracy, 5, 'ציון 9 נחתך ל-5');
eq(outOfRange.criteria.depth, 1, 'ציון -2 נחתך ל-1');
eq(outOfRange.confidence, 'medium', 'ביטחון לא חוקי → medium');

console.log('\n=== 4. מצב הדגמה: רשומה לכל מפתח, גם לתשובות ריקות ===');
(async () => {
  const q = { subject: 'לשון', sourceText: 'קטע', question: 'הסבר…' };
  const asked = [
    { key: 'a1', answer: 'תשובה ארוכה ומפורטת '.repeat(20) },
    { key: 'a2', answer: '' },                       // ריקה
    { key: 'a3', answer: 'משהו', dontKnow: true },   // «לא יודע/ת»
    { key: 'a4', answer: 'תשובה בינונית' },
  ];
  const out = await G.gradeTeachBatch(q, asked, { apiKey: null, model: 'x', effort: 'medium' });
  eq(Object.keys(out).length, 4, 'חזרה רשומה לכל אחד מ-4 המפתחות');
  check(asked.every((a) => out[a.key]), 'כל מפתח שהתבקש קיבל רשומה — אף אחד לא נשאר בלי');
  eq(out.a2.criteria.accuracy, 1, 'תשובה ריקה → 1');
  eq(out.a3.criteria.accuracy, 1, '«לא יודע/ת» → 1');
  eq(out.a2.confidence, 'high', 'על תשובה ריקה הביטחון גבוה (אין ספק)');
  check(out.a1.demo === true, 'בלי מפתח — מסומן מצב הדגמה');
  check(out.a1.criteria.accuracy >= 1 && out.a1.criteria.accuracy <= 5, 'ציון ההדגמה בטווח 1–5');

  console.log('\n=== 5. סכימת הפלט המובנה ===');
  const s = G.RESULT_SCHEMA;
  eq(s.properties.results.type, 'array', 'הפלט הוא מערך results');
  const it = s.properties.results.items;
  eq(it.additionalProperties, false, 'additionalProperties=false (נדרש לפלט מובנה)');
  check(it.required.indexOf('key') >= 0, 'key חובה — בלעדיו אי אפשר לשייך ציון לנבחן');
  G.CRITERIA.forEach(function (c) {
    check(it.required.indexOf(c) >= 0, c + ' חובה בסכימה');
    check(JSON.stringify(it.properties[c].enum) === '[1,2,3,4,5]', c + ' מוגבל ל-1..5');
  });

  console.log('\n=== 6. ברירות מחדל ===');
  const cfg = G.loadConfig();
  eq(cfg.model, 'claude-opus-5', 'המודל שנבחר');
  eq(G.BATCH_SIZE, 8, 'גודל הקבוצה');
  check(['low', 'medium', 'high', 'xhigh', 'max'].indexOf(cfg.effort) >= 0, 'עומק חשיבה חוקי: ' + cfg.effort);

  console.log('\n' + (fail.length ? '❌ ' + fail.length + ' כשלונות:\n  - ' + fail.join('\n  - ') : '✅ כל הבדיקות עברו'));
  process.exit(fail.length ? 1 : 0);
})();
