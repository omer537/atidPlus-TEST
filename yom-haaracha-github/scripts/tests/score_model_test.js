'use strict';
/* בדיקת מנוע הניקוד — דטרמיניסטי, בלי שרת ובלי רשת.
   הרצה:  node scripts/tests/score_model_test.js                (מתיקיית app)

   מאמת את המודל שהוסכם: ההוראה היא הציון, המקצוע הוא בונוס על גביו.
   הטענה הקריטית — «בונוס לעולם לא מוריד לאף אחד». */

const S = require('../../lib/score');

const fail = [];
function check(c, m) { if (!c) { fail.push(m); console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); }
function eq(a, b, m) { check(a === b, m + '  (קיבלתי ' + a + ', ציפיתי ' + b + ')'); }
function near(a, b, m) { check(a != null && Math.abs(a - b) < 1e-9, m + '  (קיבלתי ' + a + ', ציפיתי ' + b + ')'); }

// ---------- בוני קלט ----------
// mc: מערך בוליאני של נכון/לא-נכון · teach: מערך אובייקטים של 4 הקריטריונים
function chapter(subject, level, mc, teach) {
  const items = [];
  (mc || []).forEach(function (ok, i) {
    items.push({ type: 'mc_apply', mcCorrect: !!ok, dontKnow: false, id: 'q' + (i + 1) });
  });
  (teach || []).forEach(function (sc, i) {
    items.push({ type: 'text_teach', dontKnow: false, scores: sc, id: 'q' + (i + 1) + 't' });
  });
  return { subject: subject, level: level, chapter_id: subject + '_' + (level || 'x'), items: items };
}
const T = function (a, d, df, cl) { return { accuracy: a, depth: d, diagnosis_fit: df, clarity: cl }; };

// פרקי «מידע כללי» חוזרים בכמה מקרים
const GEN_STRONG = chapter('מידע כללי', null, [true, true], [T(4, 4, 5, 5), T(4, 4, 5, 5)]);   // כללי 4.5, הוראה 5.0
const GEN_MID = chapter('מידע כללי', null, [true, false], [T(3, 3, 3, 3), T(3, 3, 3, 3)]);     // כללי 3.0, הוראה 3.0

console.log('\n=== 1. פונקציית הבונוס (טהורה) ===');
near(S.subjectBonus('מתמטיקה', '5', 4.5), 0.5, 'מתמטיקה 5 יח״ל בציון 4.5 → +0.5 (תקרה)');
near(S.subjectBonus('מתמטיקה', '4', 4.5), 0.4, 'מתמטיקה 4 יח״ל באותו ציון → +0.4');
near(S.subjectBonus('מתמטיקה', '3', 4.5), 0.3, 'מתמטיקה 3 יח״ל באותו ציון → +0.3');
near(S.subjectBonus('מדעים לחטיבה', null, 4.5), 0.3, 'מדעים לחטיבה באותו ציון → +0.3');
near(S.subjectBonus('פיזיקה', null, 4.5), 0.5, 'פיזיקה באותו ציון → +0.5');
near(S.subjectBonus('אנגלית', null, 4.5), 0.4, 'אנגלית באותו ציון → +0.4');
near(S.subjectBonus('לשון', null, 5.0), 0, 'לשון — אין בונוס בכלל, גם בציון 5');
near(S.subjectBonus('היסטוריה', null, 5.0), 0, 'היסטוריה — אין בונוס');
near(S.subjectBonus('מתמטיקה', '5', 2.5), 0, 'מקצוע מתחת ל-3.0 → אפס בונוס (בלי קנס)');
near(S.subjectBonus('מתמטיקה', '5', 3.0), 0, 'בדיוק על הרצפה 3.0 → אפס');
near(S.subjectBonus('מתמטיקה', '5', 3.4), 0.2, 'מתמטיקה 3.4 → +0.2 (מדורג, לא מדרגה)');
near(S.subjectBonus('מתמטיקה', null, 4.5), 0.4, 'מתמטיקה בלי רמה מוגדרת → ברירת המחדל +0.4');
near(S.subjectBonus('מתמטיקה', '5', null), 0, 'בלי ציון מקצוע → אפס');

console.log('\n=== 2. הבונוס מונוטוני — ציון מקצוע גבוה יותר לא מוריד לעולם ===');
var prev = -1, mono = true;
for (var v = 1; v <= 5.0001; v += 0.25) {
  var b = S.subjectBonus('מתמטיקה', '5', v);
  if (b < prev - 1e-9) mono = false;
  prev = b;
}
check(mono, 'סריקה 1→5 ברביעים: הבונוס אף פעם לא יורד');

console.log('\n=== 3. שער הדיוק ו«לא יודע/ת» ===');
var gated = S.scoreItem({ type: 'text_teach', scores: T(2, 2, 5, 5) });
near(gated.teach, 3.0, 'הסבר יפה אך שגוי (דיוק 2, בהירות 5) → תרומת ההוראה נחתכת מ-5.0 ל-3.0');
near(gated.content, 2.0, 'התוכן של אותו פריט נשאר 2.0');
var ungated = S.scoreItem({ type: 'text_teach', scores: T(3, 3, 5, 5) });
near(ungated.teach, 5.0, 'דיוק 3 (מעל השער) → ההוראה לא נחתכת');
var dk = S.scoreItem({ type: 'text_teach', dontKnow: true, scores: T(5, 5, 5, 5) });
near(dk.teach, 1, '«לא יודע/ת» ברב-מלל → 1 בהוראה');
near(dk.content, 1, '«לא יודע/ת» ברב-מלל → 1 בתוכן');
near(S.scoreItem({ type: 'mc_apply', mcCorrect: true }).content, 5, 'רב-ברירה נכונה → 5');
near(S.scoreItem({ type: 'mc_apply', mcCorrect: false }).content, 1, 'רב-ברירה שגויה → 1');
near(S.scoreItem({ type: 'mc_apply', mcCorrect: true, dontKnow: true }).content, 1, '«לא יודע/ת» ברב-ברירה → 1');

console.log('\n=== 4. הפרק הכללי נכנס לרב-מלל (רגרסיה על הבאג שזרק אותו) ===');
var onlyGen = S.computeScores({ chapters: [GEN_STRONG] });
near(onlyGen.general, 4.5, 'ציון הפרק הכללי מחושב: 0.5·רב-ברירה(5) + 0.5·דיוק-ועומק(4) = 4.5');
near(onlyGen.teachAxis, 5.0, 'ציר ההוראה מהפרק הכללי = 5.0');
near(onlyGen.ravMelel, 4.9, 'רב-מלל = 0.75·5.0 + 0.25·4.5 = 4.875 → 4.9');
near(onlyGen.final, 4.9, 'נבחנת שעשתה רק את הפרק הכללי מקבלת ציון — לא null');
eq(onlyGen.bonus, 0, 'בלי מקצוע — אפס בונוס');

console.log('\n=== 5. ארבעת המקרים שהמודל נבנה כדי להבחין ביניהם ===');

// שרה — עילוי הוראה, מקצוע עברי (בלי בונוס)
var sara = S.computeScores({ chapters: [
  GEN_STRONG,
  chapter('לשון', null, [true, true, false], [T(4, 3, 5, 5), T(4, 3, 5, 5), T(4, 3, 5, 5)]),
] });
near(sara.ravMelel, 4.9, 'שרה — רב-מלל 4.9');
eq(sara.bonus, 0, 'שרה — לשון לא מזכה בבונוס');
near(sara.final, 4.9, 'שרה (עילוי הוראה, בלי מתמטיקה) → 4.9');

// דנה — אותה הוראה + מתמטיקה 5 יח״ל חזקה
var dana = S.computeScores({ chapters: [
  GEN_STRONG,
  chapter('מתמטיקה', '5', [true, true, true], [T(5, 4, 5, 5), T(5, 4, 5, 5), T(5, 4, 5, 5)]),
] });
near(dana.perSubject['מתמטיקה'], 4.8, 'דנה — מתמטיקה 4.75 → 4.8');
near(dana.bonus, 0.5, 'דנה — בונוס מלא +0.5');
eq(dana.bonusFrom, 'מתמטיקה', 'דנה — הבונוס בא ממתמטיקה');
eq(dana.bonusLabel, 'מתמטיקה 5 יח״ל', 'תווית הבונוס כוללת את הרמה');
near(dana.final, 5.0, 'דנה (עילוי הוראה + מתמטיקה) → 5.0, ולא מעל');

// רון — הוראה בינונית, מתמטיקה 5 יח״ל חזקה
var ronCh = [GEN_MID, chapter('מתמטיקה', '5', [true, true, true], [T(5, 4, 4, 3), T(5, 4, 4, 3), T(5, 4, 4, 3)])];
var ron = S.computeScores({ chapters: ronCh });
near(ron.ravMelel, 3.2, 'רון — רב-מלל 3.225 → 3.2');
near(ron.bonus, 0.5, 'רון — בונוס מלא +0.5');
near(ron.final, 3.7, 'רון (הוראה בינונית + מתמטיקה חזקה) → 3.7');

// מיכל — אותה הוראה בדיוק, אבל המקצוע הוא היסטוריה
var michal = S.computeScores({ chapters: [
  GEN_MID, chapter('היסטוריה', null, [true, true, true], [T(5, 4, 4, 3), T(5, 4, 4, 3), T(5, 4, 4, 3)]),
] });
near(michal.ravMelel, 3.2, 'מיכל — אותו רב-מלל כמו רון (3.2)');
eq(michal.bonus, 0, 'מיכל — היסטוריה לא מזכה בבונוס');
near(michal.final, 3.2, 'מיכל (הוראה בינונית, בלי מתמטיקה) → 3.2');

console.log('\n--- הסדר שהמודל אמור לייצר ---');
check(sara.final > ron.final, 'עילוי הוראה בלי מתמטיקה (' + sara.final + ') מקדים מורה בינוני עם מתמטיקה (' + ron.final + ')');
check(ron.final > michal.final, 'עם מתמטיקה (' + ron.final + ') מקדים אותו מורה בלי מתמטיקה (' + michal.final + ')');
check(dana.final > sara.final, 'עילוי הוראה + מתמטיקה (' + dana.final + ') בראש');

console.log('\n=== 6. הטענה הקריטית: בונוס לעולם לא מוריד ===');
[['שרה', sara], ['דנה', dana], ['רון', ron], ['מיכל', michal], ['רק כללי', onlyGen]].forEach(function (p) {
  check(p[1].final >= p[1].ravMelel - 1e-9, p[0] + ': הציון הסופי (' + p[1].final + ') לא נמוך מהרב-מלל (' + p[1].ravMelel + ')');
  check(p[1].bonus >= 0, p[0] + ': הבונוס אינו שלילי');
});
// אותה נבחנת בדיוק, כשמעלים רק את ציון המקצוע — הסופי לא יורד
var weakMath = S.computeScores({ chapters: [GEN_MID, chapter('מתמטיקה', '5', [false, false, false], [T(2, 2, 4, 3), T(2, 2, 4, 3), T(2, 2, 4, 3)])] });
check(ron.final >= weakMath.final, 'מתמטיקה חזקה (' + ron.final + ') לא נמוכה ממתמטיקה חלשה (' + weakMath.final + ') באותו נבחן');
eq(weakMath.bonus, 0, 'מתמטיקה חלשה → אפס בונוס, בלי קנס על עצם הבחירה');

console.log('\n=== 7. תקרת 5.0 ===');
var perfect = S.computeScores({ chapters: [
  chapter('מידע כללי', null, [true, true], [T(5, 5, 5, 5), T(5, 5, 5, 5)]),
  chapter('מתמטיקה', '5', [true, true, true], [T(5, 5, 5, 5), T(5, 5, 5, 5), T(5, 5, 5, 5)]),
] });
near(perfect.ravMelel, 5.0, 'נבחנת מושלמת — רב-מלל 5.0');
near(perfect.bonus, 0.5, 'ומגיע לה בונוס');
near(perfect.final, 5.0, 'הסופי נחסם ב-5.0 ולא נפרץ');

console.log('\n=== 8. כמה מקצועות — הבונוס לפי *בונוס*, לא לפי הציון הגבוה ===');
// מדעים לחטיבה בציון 5.0 (תקרה 0.3) מול מתמטיקה 5 יח״ל בציון 4.0 (תקרה 0.5).
// המתמטיקה *הנמוכה יותר* מזכה ביותר — זו כל הנקודה של טבלת התקרות.
var multi = S.computeScores({ chapters: [
  GEN_STRONG,
  chapter('מדעים לחטיבה', null, [true, true, true], [T(5, 5, 4, 4), T(5, 5, 4, 4), T(5, 5, 4, 4)]),
  chapter('מתמטיקה', '5', [true, true, false], [T(5, 4, 4, 4), T(5, 4, 4, 4), T(4, 4, 4, 4)]),
] });
near(multi.perSubject['מדעים לחטיבה'], 5.0, 'מדעים לחטיבה 5.0');
near(multi.perSubject['מתמטיקה'], 4.0, 'מתמטיקה 4.0');
near(multi.bonus, 0.5, 'הבונוס +0.5 — מהמתמטיקה, למרות שציונה נמוך ממדעים');
eq(multi.bonusFrom, 'מתמטיקה', 'bonusFrom = מתמטיקה (5 יח״ל שווה יותר ממדעים לחטיבה)');
near(S.subjectBonus('מדעים לחטיבה', null, 5.0), 0.3, 'למדעים לחטיבה היה מגיע רק +0.3');
console.log('    ציוני התחומים: ' + JSON.stringify(multi.domainsLabeled));
console.log('    עמודת מקצועות: ' + S.subjectsLabel(multi));

console.log('\n=== 9. תוויות לגיליון ===');
eq(S.subjectLabel('מתמטיקה', '5'), 'מתמטיקה 5 יח״ל', 'תווית מתמטיקה עם רמה');
eq(S.subjectLabel('אנגלית', null), 'אנגלית', 'תווית מקצוע בלי רמה');
var lbl = S.subjectsLabel(dana);
check(lbl.indexOf('מתמטיקה 5 יח״ל 4.8') === 0, 'עמודת «מקצועות»: ' + lbl);
check(lbl.indexOf('מידע כללי') === -1, 'הפרק הכללי לא מופיע בעמודת המקצועות');

console.log('\n=== 10. המלצה מילולית ===');
console.log('    שרה:  ' + S.buildRecommendation(sara));
console.log('    דנה:  ' + S.buildRecommendation(dana));
console.log('    רון:  ' + S.buildRecommendation(ron));
console.log('    מיכל: ' + S.buildRecommendation(michal));
check(S.buildRecommendation(sara).indexOf('עילוי הוראה') === 0, 'שרה מסומנת «עילוי הוראה»');
check(S.buildRecommendation(dana).indexOf('יתרון: מתמטיקה 5 יח״ל') > 0, 'לדנה מצוין היתרון במתמטיקה');
check(S.buildRecommendation(ron).indexOf('יתרון: מתמטיקה 5 יח״ל') > 0, 'גם לרון מצוין היתרון');

console.log('\n=== 11. מקרי קצה ===');
var empty = S.computeScores({ chapters: [] });
eq(empty.final, null, 'בלי פרקים בכלל → final null (ולא 0 או NaN)');
eq(empty.bonus, 0, 'בלי פרקים → בונוס 0');
var mcOnly = S.computeScores({ chapters: [chapter('מידע כללי', null, [true, true], [])] });
near(mcOnly.general, 5.0, 'פרק עם רב-ברירה בלבד → התוכן מחושב ממנה');
eq(mcOnly.teachAxis, null, 'בלי תשובות כתובות → ציר ההוראה null');
near(mcOnly.ravMelel, 5.0, 'ואז הרב-מלל נשען על הכללי לבד (נרמול משקלים)');
var noGen = S.computeScores({ chapters: [chapter('מתמטיקה', '5', [true], [T(4, 4, 4, 4)])] });
eq(noGen.general, null, 'נבחנת בלי הפרק הכללי → general null');
near(noGen.ravMelel, 4.0, 'והרב-מלל נשען על ההוראה לבד');

console.log('\n' + (fail.length ? '❌ ' + fail.length + ' כשלונות:\n  - ' + fail.join('\n  - ') : '✅ כל ' + 'הבדיקות עברו'));
process.exit(fail.length ? 1 : 0);
