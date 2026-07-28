#!/bin/bash
# דאבל-קליק על הקובץ הזה מפעיל את מערכת יום ההערכה.
# להשאיר את החלון פתוח כל עוד רוצים שהמערכת תפעל. לסגירה — לסגור את החלון.
cd "$(dirname "$0")" || exit 1
echo "מכין את המערכת..."
if [ ! -d node_modules ]; then
  echo "התקנה ראשונית (פעם אחת בלבד)..."
  npm install
fi
echo ""
echo "פותח את המערכת. בדפדפן: http://localhost:3000"
echo "מסך הבוחן: http://localhost:3000/examiner"
echo "לעצירה — סגור/י את החלון הזה."
echo ""
npm start
