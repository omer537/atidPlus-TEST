# חיבור לגוגל שיטס בזמן אמת (לצפייה חיה בתוצאות)

המערכת יכולה לדחוף שורה לגוגל שיט בכל פעם שנבחן **מגיש פרק** — כך רואים בזמן אמת, מכל מחשב, שהתוצאות נכנסות. זה **מראה/גיבוי לצפייה בלבד**; מקור האמת נשאר במערכת עצמה.

חשוב: כל עוד לא הגדרת כתובת webhook — **שום דבר לא נשלח החוצה**. זה כבוי כברירת מחדל.

## שלב 1 — יצירת הגיליון והסקריפט
1. פתח/י גיליון חדש ב-Google Sheets.
2. בתפריט: **Extensions → Apps Script**.
3. מחק/י את הקוד הקיים והדבק/י את הקוד הבא:

```javascript
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['זמן', 'שם', 'סבב', 'מקצוע', 'רמה', 'מס׳ תשובות', 'פרק']);
  }
  var d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) {}
  sheet.appendRow([
    d.at || new Date().toISOString(),
    d.name || '',
    d.round || '',
    d.subject || '',
    d.level || '',
    d.answered || 0,
    d.chapter_id || ''
  ]);
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## שלב 2 — פרסום כ-Web App
1. למעלה מימין: **Deploy → New deployment**.
2. בגלגל השיניים ליד "Select type" בחר/י **Web app**.
3. הגדרות:
   - **Execute as:** Me (המשתמש שלך)
   - **Who has access:** **Anyone** (חובה — כדי שהשרת יוכל לשלוח בלי התחברות)
4. **Deploy**, ואשר/י את ההרשאות (Google תבקש אישור פעם אחת).
5. העתק/י את ה-**Web app URL** שמתקבל (משהו כמו `https://script.google.com/macros/s/XXXX/exec`).

## שלב 3 — חיבור למערכת
בקובץ `config.local.json` (העתק/י מ-`config.example.json` אם עוד אין):

```json
{
  "sheetsWebhookUrl": "https://script.google.com/macros/s/XXXX/exec"
}
```

הפעל/י מחדש את השרת. מעכשיו, כל הגשת פרק תוסיף שורה לגיליון תוך שנייה-שתיים.

## הערות
- אפשר להוסיף דחיפה גם באירועים נוספים (למשל סיום סבב) — בקש/י ואוסיף.
- אם משנים את קוד ה-Apps Script אחר כך, צריך **Deploy → Manage deployments → Edit → New version**, אחרת השינוי לא נכנס.
- כדי לכבות את החיבור: מוחקים/מרוקנים את `sheetsWebhookUrl` ומפעילים מחדש.
