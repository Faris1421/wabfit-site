# Photo editor — the walk

One pass over the whole tool in a desktop browser, at a phone's size. Every step
says what to do and what must be on the screen when it is done. The editor is a
static page: no build step, no network, no second window.

## Before the first step

1. Serve the repository's `site/` directory over http — the page is plain ES
   modules, so `file://` will not load them:

       python3 -m http.server -d site 8099

2. In Chrome, open `http://localhost:8099/tools/photo/` and turn on the device
   toolbar: **390 × 844**, device pixel ratio 2, touch. Arabic and dark are the
   defaults; `?lang=en` and `?theme=light` switch either one.
3. Open DevTools → Network with **Disable cache** off. At the end of the walk
   every request must be same-origin (`localhost:8099`), and none of them may be
   an analytics or font request to another host. The Console must be empty.

## 1. Open a photo

- Press **افتح صورة** and choose a JPEG at least 3000 px on its long side.
- Must be seen: the photo centred in the stage, the whole picture fitted (all
  four edges visible, nothing cropped); the bar's four buttons enabled; the tool
  bar under the stage holding **تعديل، فلاتر، قص** with تعديل pressed; the
  thirteen adjustment chips above the tool bar, and one slider under them.
- The picture is drawn by the WebGL2 pipeline. If the stage shows
  **جهازك لا يدعم محرر الصور** instead, this browser has no WebGL2 and the walk
  stops here.

## 2. Move three sliders

- Press **التعريض**, drag the slider right to about 40. Press **التباين**, drag
  to about 25. Press **الظلال**, drag to about 30.
- Must be seen: the photo follows each drag while the finger is down (nothing
  jumps at the end); the number beside the slider counts with it; a value read
  left to right in Arabic as well.
- The redo arrow stays disabled throughout: a drag is ONE step, not eighty.

## 3. A filter at 60%

- Press **فلاتر**. Must be seen: twelve thumbnails, each one THIS photo, with
  **الأصل** ringed first; then a strength slider at 100.
- Press a named filter (for example **أحادي**), then drag the strength slider to
  **60**.
- Must be seen: the picture takes that look at 60 %; the ring stays on the
  filter; the slider reads 60; the exposure moved in step 2 is gone, because a
  filter sets all thirteen values outright.

## 4. Crop 4:5 with a 7 degree straighten

- Press **قص**. Must be seen: a frame over the whole picture with eight grips,
  a row of aspects, two turn buttons, **قلب**, and a straighten dial at 0.
- Press **4:5**. Must be seen: the frame becomes the largest 4:5 rectangle the
  picture holds, and all of it is inside the picture.
- Drag the straighten dial to **7**. Must be seen: the picture tilts under the
  frame and grows just enough that no empty corner appears inside it.
- Press **تطبيق**. Must be seen: the frame is gone, the photo now fills the
  stage as a 4:5 crop at the 7 degree tilt, and pressing تراجع once would take
  the whole crop back.

## 5. Undo twice, redo once

- Press **تراجع** (top bar). Must be seen: the crop and the straighten are
  undone together — the uncropped photo, still filtered at 60 %.
- Press **تراجع** again. Must be seen: the filter is undone, leaving the three
  slider moves of step 2.
- Press **إعادة** once. Must be seen: the filter is back at 60 %, and the crop
  is NOT — redo walks forward one step at a time.

## 6. Compare

- Press and HOLD **الأصل**. Must be seen while it is held: the ORIGINAL photo,
  uncropped, unfiltered, unadjusted — the file as it was opened. The button
  stays pressed in.
- Release. Must be seen: the edited picture returns at once, with the zoom and
  the pan it had.

## 7. Zoom

- Double-tap the photo. Must be seen: it jumps to 100 % — one picture pixel to
  one screen pixel — centred on the double-tap.
- Drag with one finger (or the mouse). Must be seen: the zoomed picture pans.
- Pinch with two fingers (or use the wheel on a desktop). Must be seen: the
  picture scales about the fingers or the pointer, between fit and 16×.
- Double-tap again. Must be seen: the whole picture fits the stage once more,
  centred.

## 8. Export JPEG

- Press **تصدير**. Must be seen: a sheet at the bottom with **JPEG** and **PNG**
  (JPEG pressed), a quality slider at **92**, the output size in pixels as plain
  text — the size of the CROPPED photo, not the file that was opened — and the
  buttons **تصدير** and **إلغاء**.
- Press **PNG**, then **JPEG** again: the ring follows. Set quality to 80.
- Press **تصدير** in the sheet. Must be seen: the browser downloads
  `wabfit-photo-<YYYYMMDD-HHMMSS>.jpg`; the sheet closes; nothing is said about
  a warning; the picture is unchanged.
- Must NOT be seen: any request in the Network panel other than `localhost:8099`.
  The photo never leaves the device.

## 9. The inline error, and the close

- Press **تصدير** once more, then **إلغاء**. Must be seen: the sheet closes with
  nothing done.
- In the app's WebView the sheet sends
  `{type:'export', name, base64, save:'library'}` in 32 KB slices and then
  `{type:'dirty', dirty:false}`; in a browser it downloads instead. A failed
  export shows one line, **تعذّر التصدير**, inside the sheet and nothing else.
- Rename a text file to `broken.jpg` and choose it through **افتح صورة**. Must be
  seen: one line, **تعذّر فتح الصورة**, at the bottom of the stage, with the
  empty state still usable; opening a real photo afterwards takes the line away.

## 10. The page's own check

    node site/tools/photo/check.mjs

Must print one `ok` line and exit 0: every `t('key')` is in both dictionaries,
no module holds a growth marker, `app.css` holds no physical `left`/`right`,
nothing the page loads names an address outside a comment, every model the
vendor README records under `ml/` is present at that recorded byte size, and no
module is over 240 lines.

## 11. Erase a small object

- Press **إزالة**. Must be seen: the photo in the stage with a ring under the
  finger, and above the tool bar a **الحجم** slider, a **الممحاة** chip and the
  button **أزل المحدد**.
- On a photo whose object sits on a plain background — a sign, a cable, one small
  thing — drag one finger over the object. Must be seen: a translucent accent
  paint laid over the object, the ring showing the brush's width; the paint is a
  mask over the photo, not a mark in it.
- Press **الممحاة** and drag back over part of the paint. Must be seen: only the
  painted area under the finger is taken back, and the button stays pressed in.
- Press **أزل المحدد**. The first time on this device a determinate bar counts the
  model in: the vendored `migan_pipeline_v2.onnx` streams as real bytes over real
  bytes, 0 up to 1, and then the bar hides. Must be seen: the object replaced by
  the background around it, no seam and no paint left; the tool bar is inert while
  it runs; **تراجع** is enabled and one press puts the object back.

## 12. Reshape and retouch a face

- Press **الوجه**. The first time on this device the `face_landmarker.task` model
  streams behind the same determinate bar. On a photo with no clear face, must be
  seen: one line **لا يوجد وجه واضح في الصورة** and nothing else.
- On a portrait, must be seen: ten dials on a strip that scrolls — **نحافة الوجه،
  الفك، الذقن، العينان، الأنف، الشفاه، الابتسامة**, each reading 0 and free to go
  from −100 to +100, then **نعومة البشرة، بياض الأسنان، إشراق العينين** from 0 to
  100 — and **تطبيق**.
- Push **نحافة الوجه** to **+60**. Must be seen: the cheeks move in while the
  finger is down and stay SYMMETRIC about the face's own centre line — the nose
  tip and the chin do not drift, the two sides mirror; the readout counts with the
  drag.
- Push **العينان** to **+40**. Must be seen: both eyes grow by the same amount in
  the same direction, also symmetric, and the rest of the face is left alone.
- Press **تطبيق**. Must be seen: the whole picture at its own resolution with the
  reshape and the retouch, the ten dials back at 0, and one **تراجع** taking the
  whole edit back.

## 13. Swap two frontal portraits

- Open a frontal portrait and press **تبديل الوجه**. Must be seen: the chip
  **اختر صورة الوجه** and **تطبيق**, with nothing running yet.
- Press **اختر صورة الوجه** and choose a second frontal portrait. The first time
  the landmark model streams behind the determinate bar. Must be seen: the stage
  shows the first portrait with the second's face drawn onto it, colour-matched to
  the first's light and blended at the jaw and the brow, and a **القوة** slider at
  **100**.
- Drag **القوة** down. Must be seen: the two pictures cross-fade live between none
  of the swap and all of it; the readout counts.
- Press **تطبيق**. Must be seen: the swap baked at the picture's own size, one
  **تراجع** taking it back, and the second photo forgotten — the tool asks for it
  again.
- A face missing from EITHER photo must show **لا يوجد وجه واضح في الصورة** and
  nothing else below the chip. There is no consent screen: choosing the second
  photo runs the swap.

## 14. Blur and remove a background

- Press **الخلفية**. The first time the `selfie_segmenter.tflite` model streams
  behind the determinate bar. Must be seen: the four chips **تمويه، لون، إزالة،
  صورة** and **تطبيق**.
- With **تمويه** chosen, must be seen: a **مدى التمويه** slider. Set it near 12 and
  press **تطبيق**. Must be seen: the person sharp, everything behind them blurred,
  the edge following the hair rather than a box; one **تراجع** puts the background
  back.
- Press **إزالة**, then **تطبيق**. Must be seen: the person on nothing — the
  background transparent, the stage showing through. Press **تصدير** and must be
  seen: the sheet already holds **PNG** pressed, because a JPEG would come back
  black.
- Press **لون**. Must be seen: eight swatches — **أبيض، أسود، رمادي، أزرق، سماوي،
  أخضر، وردي، رملي** — and a colour picker; pressing one rings it, and **تطبيق**
  puts the person on that ground.
- Press **صورة**, choose a photo, press **تطبيق**. Must be seen: the person over
  that second photo, the second photo covering the whole frame.

Through every step of 11–14 the Network panel must stay on `localhost:8099`:
the models are vendored beside the page, so each one is one same-origin request,
and the photo never leaves the device.
