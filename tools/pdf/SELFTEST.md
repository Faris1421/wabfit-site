# Self-test — taking the lock off a PDF (`site/tools/pdf/`)

No browser automation, no npm. Two parts: what runs on its own, and the three
cases a person has to look at in a browser.

## 0. The check that runs by itself

From the repo root:

```
for f in main.js i18n.js unlock.js docstore.js; do node --check site/tools/pdf/$f; done
node --input-type=module -e "
import('./site/tools/pdf/i18n.js').then(({ strings }) => {
  const ar = Object.keys(strings.ar).sort().join(',');
  const en = Object.keys(strings.en).sort().join(',');
  if (ar !== en) { console.log('the two dictionaries differ'); process.exit(1); }
  console.log('ok: ' + Object.keys(strings.ar).length + ' keys in both dictionaries');
});" 2>/dev/null
```

Must print `ok:` and exit 0. The first line proves every changed file still
parses as a module; the second proves the Arabic and English tables carry exactly
the same keys — a key in one and not the other is the bug that shows a raw key on
screen.

## 1. Serve the page

```
python3 -m http.server -d site 8099
```

Open `http://localhost:8099/tools/pdf/`. Arabic and dark are the defaults;
`?lang=en` and `?theme=light` switch either one. The padlock tool «إزالة القفل» /
**Remove lock** is the last button in the tool bar. In the app's WebView the same
page is at the webtool `/webtool/pdf`.

## 2. A file with no lock at all

Open any ordinary PDF and press **إزالة القفل**.

Must be seen: the panel's status line **لا قفل على هذا الملف**, the action
**أزل القفل** dimmed and inert, and the line under it empty. Nothing else happens;
no file is handed back.

## 3. A file locked by its OWNER only — the common case

One that opens with no password but forbids printing, copying and editing. To make
one by hand on a Mac: Preview → **File ▸ Export as PDF ▸ Permissions**, leave
**Require password to open** empty, set **Require password to: Print** and
**Copy**. (Any locked form or statement already on the phone will do.)

Open it and press **إزالة القفل**.

Must be seen: the status line **الملف مقفل بقيود على الطباعة والنسخ، ويُفتح بلا
كلمة مرور**, and no password field anywhere — this file needs none.

Press **أزل القفل**. Must be seen: the button greyed while the pages are drawn,
then the line **أُزيلت قيود الطباعة والنسخ، وصفحات النسخة صور** and a file named
`<the name>-unlocked.pdf` handed back — downloaded in a browser, saved by the app
inside the app.

Check what came back: open `<the name>-unlocked.pdf`. Must be seen: it opens with
**no password prompt at all**, its pages are the same pages, and the viewer no
longer refuses **Print** or **Copy** — the restrictions are gone. The file that
was opened is untouched in the editor.

The copy is drawn: its pages are pictures (about 144 dpi), so the words in it
cannot be selected or searched. That is the honest limit of this page, not a
detail to skip: pdf.js decrypts and cannot write, pdf-lib writes and cannot
decrypt (there is no cipher in it), and a copy of the page objects alone comes
back as a file that opens with no password and shows nothing. Drawing the
decrypted pages is the one way to hand back a copy that is both unencrypted and
readable, and the result line says what the copy is.

## 4. A file locked by a USER password

One that will not open without a password. Make one the same way as case 3, with
**Require password to open** filled in. Open it in the editor: the editor's own
password field asks for it, and the document appears once it is typed — that
password is the one this case needs.

Press **إزالة القفل**.

Must be seen: the status lines **الملف مقفل بكلمة مرور، ولا يُفتح بدونها** and
**كلمة المرور المنسية لا سبيل إلى استعادتها**, and the action **أزل القفل**.

Press **أزل القفل**. Must be seen: the page's password field, asking again.

- Type a WRONG password. Must be seen: **كلمة المرور غير صحيحة** above the field,
  the field stays open, nothing is handed back, and there is no second attempt of
  the tool's own making — the next attempt is the person's.
- Press Escape. Must be seen: the field closes, the panel says nothing new, and no
  file is handed back.
- Press **أزل القفل** again, type the RIGHT password. Must be seen: the line
  **أُزيل القفل وحُفظت نسخة بلا كلمة مرور، وصفحاتها صور**, and the copy comes back
  as in case 3 — it opens with no password prompt and its pages are the pages.

## 5. The dead end

There is no fifth case, and no list of words to try. A user password nobody
remembers is a dead end, the panel says so in those words, and this page never
guesses, never walks a wordlist and never retries on its own.

## 6. The original is not written to

After every case the document in the editor is the file that was opened, unchanged:
undo and redo are untouched, and **تصدير** hands back what it always did.

## 7. Lifting a signature that is already on the page

The two halves that run on their own:

```
node site/tools/pdf/check-lift.mjs
node --check site/tools/pdf/sign-lift.js
```

The first is Otsu's threshold and the despeckle against a bitmap whose right
answers are counted by eye — one eight-pixel stroke, two single noise dots, a
mark of four pixels that must survive and one of three that must not. It must
print `ok` and exit 0.

In a browser, open a page carrying an old signature. With **توقيع** on, tap a
page to open the sheet and press **التقاط توقيع من الصفحة**: the sheet closes and
the next rectangle dragged over a page is the crop — the same accent rectangle
every box in this editor is drawn with. Must be seen next: the cut result over
the checkerboard, with **احفظ** and **أعد المحاولة**. A frame that found the
handwriting is saved with **احفظ** and appears first in the sheet's row, usable
like any drawn signature; nothing is written onto the page until that thumbnail
is tapped.

Without the app behind it — the page opened in a browser — the same result
appears with the line **قُصّ التوقيع هنا بلا مساعدة الذكاء الاصطناعي**, and a
frame over blank paper leaves **احفظ** inert rather than saving a blank
signature. The model's own half runs through the app: the page asks
`{type:'vision', task:'liftSignature', id, image, width, height}` over the
bridge and takes `{type:'vision', id, result:{found, box, strokeColorHex}}`
back, which is `features/webtools/WebToolScreen.tsx`'s to answer.
