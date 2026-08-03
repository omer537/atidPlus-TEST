'use strict';
// זריעת נתוני-דוגמה לבסיס-נתונים נפרד (DB_PATH), כדי להדגים את מסך הבדיקה.
const crypto = require('crypto');
const APP = '/Users/gunr/Desktop/מבחנים ליום הערכה/app';
const { db } = require(APP + '/db');
const content = require(APP + '/lib/content');

function gid() { return 'e' + crypto.randomBytes(6).toString('hex'); }
function tok() { return crypto.randomBytes(16).toString('hex'); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// טקסטים לדוגמה לתשובות «למד» — אורך משתנה לפי רמת המועמד (במצב הדגמה הציון מבני).
const LONG = 'הייתי מסביר לתלמיד שהתופעה נובעת משוני אקראי בין הפרטים, ואז מהסביבה שבוחרת מי ישרוד ויתרבה — בלי שום כוונה או "צורך". הייתי נותן דוגמה קונקרטית של קבוצת פרטים עם תכונות שונות, ומראה איך לאורך דורות ההרכב של האוכלוסייה משתנה. חשוב לי לוודא שהתלמיד מבין שהפרט עצמו אינו משתנה.';
const MED = 'הייתי מסביר שהשינוי קורה כי מי שמתאים לסביבה שורד יותר, ונותן דוגמה קצרה כדי להמחיש. הייתי מדגיש שאין כאן כוונה.';
const SHORT = 'זה קורה בגלל ברירה טבעית, מי שמתאים שורד.';
const teachText = { strong: LONG, medium: MED, weak: SHORT };

// פרופילים: [שם, מקצועות, רמת-מתמטיקה, רמה כללית]
const people = [
  ['דנה לוי',   ['מתמטיקה', 'לשון', 'אנגלית'],            '4', 'strong'],
  ['יוסי כהן',  ['מתמטיקה', 'פיזיקה', 'רובוטיקה'],        '5', 'strong'],
  ['מאיה בר',   ['לשון', 'היסטוריה', 'אנגלית'],           null, 'medium'],
  ['נועה פרץ',  ['ביולוגיה', 'מדעים לחטיבה', 'לשון'],      null, 'medium'],
  ['איתי שגב',  ['אנגלית', 'היסטוריה', 'מתמטיקה'],         '3', 'weak'],
  ['רון אמסלם', ['פיזיקה', 'מתמטיקה', 'ביולוגיה'],         '4', 'weak'],
];
const correctProb = { strong: 0.9, medium: 0.65, weak: 0.4 };

const insEx = db.prepare("INSERT INTO examinees (code,name,token,declaration,subjects,math_level,interviewed,in_interview,created_at,status,pin) VALUES (?,?,?,?,?,?,1,0,?,'active',?)");
const insAns = db.prepare('INSERT OR REPLACE INTO answers (code,round,chapter_id,item_id,type,answer,started_at,updated_at,time_spent_sec,dont_know) VALUES (?,?,?,?,?,?,?,?,?,0)');

function chaptersFor(subjects, mathLevel) {
  const list = [];
  subjects.forEach(function (s) {
    const ch = content.findChapter(s, s === 'מתמטיקה' ? mathLevel : null, 0);
    if (ch) list.push(ch);
  });
  const gen = (content.bySubject.get('מידע כללי') || [])[0];
  if (gen) list.push(gen);
  return list;
}

let n = 0;
people.forEach(function (p, idx) {
  const [name, subjects, mathLevel, level] = p;
  const code = gid();
  const now = Date.now() - (idx * 1000);
  insEx.run(code, name, tok(), JSON.stringify({ subjects: subjects, mathLevel: mathLevel, note: '' }),
    JSON.stringify(subjects), mathLevel, now, String(1000 + idx));
  const chapters = chaptersFor(subjects, mathLevel);
  chapters.forEach(function (ch, round) {
    (ch.items || []).forEach(function (it) {
      let type = it.type, answer = '';
      if (type === 'mc_apply' || type === 'mc_error_dialogue') {
        const opts = it.options || [];
        const correct = opts.find(function (o) { return o.correct; });
        const wrong = opts.filter(function (o) { return !o.correct; });
        const getRight = Math.random() < (correctProb[level] || 0.5);
        const chosen = getRight ? correct : (pick(wrong) || correct);
        answer = chosen ? chosen.id : '';
      } else if (type === 'text_teach' || type === 'text_teach_error') {
        answer = teachText[level] || MED;
      } else {
        return; // מקור/כלל — לא נענה
      }
      insAns.run(code, round + 1, ch.chapter_id, it.id, type, answer, now, now, 300);
    });
  });
  n++;
});
console.log('נזרעו ' + n + ' מועמדים עם תשובות. סה"כ תשובות: ' +
  db.prepare('SELECT COUNT(*) c FROM answers').get().c);
