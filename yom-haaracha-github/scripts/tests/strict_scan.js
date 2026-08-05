'use strict';
/* סורק את קבצי הצד-לקוח למשתנה שמוקצה או נקרא בלי שהוצהר.
   הרצה:  node scripts/tests/strict_scan.js               (מתיקיית app)

   למה זה קיים: כל קבצי ה-JS בפרונט עטופים ב-'use strict', ושם משתנה לא-מוצהר
   זורק ReferenceError במקום ליצור גלובל בשקט. `node -c` לא תופס את זה — זו
   שגיאת ריצה. שני באגים כאלה הגיעו עד לשרת החי:

     • examiner.js — `inner` בלי var בתוך renderMatrix: הפיל את כל המטריצה,
       אבל רק מהרגע שלנבחן יש משבצת, כלומר בדיוק כשהסבב הראשון מתחיל.
     • app.js — `pollHandle` במקום `App.pollHandle` ב-handleAuthLost: נבחן
       שהחיבור שלו הוחלף נשאר עם מסך תקוע במקום לחזור למסך הכניסה.

   שניהם היו נתפסים כאן בשנייה. */

const fs = require('fs');
const path = require('path');

const FILES = ['examiner.js', 'app.js', 'grade.js', 'interviewer.js', 'render.js']
  .map((f) => path.join(__dirname, '..', '..', 'public', 'js', f));

// גלובלים של הדפדפן שמותר להשתמש בהם בלי הצהרה.
const GLOBALS = new Set([
  'window', 'document', 'location', 'localStorage', 'sessionStorage', 'console', 'navigator', 'history', 'screen',
  'JSON', 'Math', 'Date', 'Number', 'String', 'Array', 'Object', 'Boolean', 'RegExp', 'Error', 'Set', 'Map', 'Intl',
  'Promise', 'Symbol', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'BigInt',
  'fetch', 'Headers', 'Request', 'Response', 'FormData', 'Blob', 'File', 'FileReader', 'URL', 'URLSearchParams',
  'AbortController', 'XMLHttpRequest', 'EventSource', 'WebSocket',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'alert', 'confirm', 'prompt', 'isNaN', 'isFinite', 'parseInt', 'parseFloat',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'btoa', 'atob', 'structuredClone',
  'undefined', 'NaN', 'Infinity', 'this', 'arguments', 'globalThis',
  'Element', 'Node', 'Event', 'CustomEvent', 'HTMLElement', 'DOMParser', 'MutationObserver', 'IntersectionObserver',
  'crypto', 'performance', 'katex', 'getComputedStyle', 'matchMedia',
]);

function declaredNames(src) {
  const names = new Set();
  const add = (n) => { if (n) names.add(n); };
  // var / let / const  (כולל שרשור: var a = 1, b = 2)
  for (const m of src.matchAll(/\b(?:var|let|const)\s+([^;\n]+)/g)) {
    const seg = m[1];
    // מפרק גם פירוק אובייקט/מערך פשוט
    seg.replace(/\{([^}]*)\}|\[([^\]]*)\]/g, (all, o, a) => {
      (o || a || '').split(',').forEach((x) => add(x.trim().split(':').pop().trim().replace(/^\.\.\./, '')));
      return ' ';
    }).split(',').forEach((part) => {
      const n = part.trim().split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) add(n);
    });
  }
  for (const m of src.matchAll(/function\s*([\w$]*)\s*\(([^)]*)\)/g)) {
    add(m[1]);
    m[2].split(',').forEach((p) => add(p.trim().split('=')[0].trim().replace(/^\.\.\./, '')));
  }
  for (const m of src.matchAll(/\(([^)]*)\)\s*=>/g)) {
    m[1].split(',').forEach((p) => add(p.trim().split('=')[0].trim().replace(/^\.\.\./, '')));
  }
  for (const m of src.matchAll(/(?:^|[^\w$.])([\w$]+)\s*=>/g)) add(m[1]);
  for (const m of src.matchAll(/catch\s*\(\s*([\w$]+)/g)) add(m[1]);
  for (const m of src.matchAll(/for\s*\(\s*(?:var|let|const)?\s*([\w$]+)\s+(?:of|in)\b/g)) add(m[1]);
  for (const m of src.matchAll(/\bclass\s+([\w$]+)/g)) add(m[1]);
  return names;
}

// מסיר מחרוזות והערות כדי לא לדווח על תוכן טקסטואלי.
function strip(line) {
  return line
    .replace(/\\./g, '  ')
    .replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, '``')
    .replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, ' ');
}

const problems = [];
let scanned = 0;

for (const file of FILES) {
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'utf8');
  const rel = 'public/js/' + path.basename(file);
  if (!/['"]use strict['"]/.test(src)) {
    console.log('  · ' + rel + ' — אינו strict, מדלג');
    continue;
  }
  scanned++;
  const declared = declaredNames(src);
  src.split('\n').forEach((raw, i) => {
    const line = strip(raw);
    // הקצאה בתחילת הוראה, או קריאה בתוך תנאי — שני הדפוסים שנפלו בפועל
    const patterns = [
      /(?:^|[{;}]\s*|\)\s*|\belse\s+)([A-Za-z_$][\w$]*)\s*=(?!=|>)/g,   // name = ...
      /\bif\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g,                            // if (name)
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(line))) {
        const name = m[1];
        if (declared.has(name) || GLOBALS.has(name)) continue;
        if (/^[A-Z][A-Z0-9_]*$/.test(name)) continue;      // קבוע גלובלי מקובץ אחר
        const before = line.slice(0, m.index + m[0].indexOf(name));
        if (/[.?]\s*$/.test(before)) continue;             // מפתח אובייקט / גישה
        problems.push({ file: rel, line: i + 1, name: name, text: raw.trim().slice(0, 110) });
      }
    }
  });
}

console.log('\n=== סריקת strict על ' + scanned + ' קבצים ===');
if (!problems.length) {
  console.log('✅ אין משתנה שמוקצה או נקרא בלי הצהרה');
  process.exit(0);
}
problems.forEach((p) => {
  console.log('  ✗ ' + p.file + ':' + p.line + '  «' + p.name + '» אינו מוצהר → ReferenceError בזמן ריצה');
  console.log('      ' + p.text);
});
console.log('\n❌ ' + problems.length + ' מקומות. כל אחד מהם מפיל את הרינדור שהוא יושב בו.');
process.exit(1);
