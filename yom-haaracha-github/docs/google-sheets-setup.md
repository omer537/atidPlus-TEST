# חיבור לגוגל שיטס בזמן אמת (לצפייה חיה בתשובות)

המערכת דוחפת לגוגל שיט את **התשובות המלאות** של כל פרק ברגע שנבחן **מגיש** אותו (וגם בסוף כל סבב, למי שלא לחץ "הגש") — כך רואים בזמן אמת, מכל מחשב, את התשובות שנכנסות, ויש לך **עותק חיצוני** שנשמר בגוגל. זה **מראה/גיבוי נוסף**; מקור האמת נשאר במערכת עצמה (DB על דיסק קבוע + גיבוי אוטומטי כל 5 דק').

חשוב: כל עוד לא הגדרת כתובת webhook — **שום דבר לא נשלח החוצה**. זה כבוי כברירת מחדל.

## שלב 1 — יצירת הגיליון והסקריפט
1. פתח/י גיליון חדש ב-Google Sheets.
2. בתפריט: **Extensions → Apps Script**.
3. מחק/י את הקוד הקיים והדבק/י את הקוד הבא:

```javascript
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var header = ['זמן', 'שם', 'סבב', 'מקצוע', 'רמה', 'פרק',
                'מזהה שאלה', 'השאלה', 'התשובה', 'לא יודע/ת', 'נכון (רב-ברירה)'];
  if (sheet.getLastRow() === 0) sheet.appendRow(header);

  var d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) {}

  var rows = [];
  if (Array.isArray(d.answers) && d.answers.length) {
    // פורמט חדש: התשובות המלאות של פרק — שורה לכל שאלה
    d.answers.forEach(function (a) {
      rows.push([
        d.at || new Date().toISOString(), d.name || '', d.round || '',
        d.subject || '', d.level || '', d.chapter_id || '',
        a.item_id || '', a.question || '', a.answer || '',
        a.dont_know ? 'כן' : '', a.correct || ''
      ]);
    });
  } else {
    // תאימות לאחור: שורת סיכום ישנה (מספר תשובות בלבד)
    rows.push([
      d.at || new Date().toISOString(), d.name || '', d.round || '',
      d.subject || '', d.level || '', d.chapter_id || '',
      '', '', '(' + (d.answered || 0) + ' תשובות)', '', ''
    ]);
  }

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, header.length).setValues(rows);
  }
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
**ב-Render (הפריסה האמיתית):** בשירות → **Environment** → הוסף/י משתנה:
- Key: `SHEETS_WEBHOOK_URL`
- Value: כתובת ה-Web app שהעתקת.

לאחר השמירה Render יפרוס מחדש, ומאותו רגע כל הגשת פרק תוסיף את התשובות המלאות לגיליון תוך שנייה-שתיים.

**מקומית (אופציונלי, לבדיקה):** בקובץ `config.local.json` (העתק/י מ-`config.example.json` אם עוד אין):
```json
{
  "sheetsWebhookUrl": "https://script.google.com/macros/s/XXXX/exec"
}
```
ואז להפעיל מחדש את השרת.

## הערות
- **מתי נשלח:** בכל **הגשת פרק** (הנבחן לחץ "הגש"), וגם ב**סיום כל סבב** עבור מי שלא הגיש — כך אף תשובה לא נעדרת, בלי כפילויות.
- **מה נשלח:** לכל שאלה — טקסט השאלה, התשובה (טקסט חופשי, או האופציה שנבחרה ברב-ברירה), סימון "לא יודע/ת", ולרב-ברירה גם נכון/לא-נכון.
- אם משנים את קוד ה-Apps Script אחר כך, צריך **Deploy → Manage deployments → Edit → New version**, אחרת השינוי לא נכנס.
- כדי לכבות את החיבור: מוחקים את משתנה הסביבה `SHEETS_WEBHOOK_URL` ב-Render (או מרוקנים את `sheetsWebhookUrl` מקומית) ומפעילים מחדש.
- זהו עותק לצפייה/גיבוי — אם שורה מסוימת נכשלה להישלח (רשת/עומס), התשובה עדיין שמורה במערכת ובגיבוי האוטומטי.
