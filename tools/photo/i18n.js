/**
 * Wab Fit — the photo editor's words.
 *
 * Arabic is the source language, so the Arabic table is written first and the
 * English one is a translation OF it. The two tables carry the same keys; a key
 * that exists in one and not the other is a bug the page shows as a raw key on
 * screen, which is why every key below is complete in both.
 *
 * Nothing else in this directory may hold a user-visible string. The brand is
 * written "Wab Fit" in Latin letters, always — including inside an Arabic
 * sentence. The wording names the function and stops: one word per control, and
 * no sentence explaining what a person can already see.
 *
 * The tool keys are prefixed `t` because the tool bar draws them under an icon;
 * they are the same words the app uses for the same jobs.
 */

/** Arabic first. This is the source. */
const ar = {
  // The one thing on an empty screen.
  openPhoto: 'افتح صورة',

  // The bar.
  undo: 'تراجع',
  redo: 'إعادة',
  compare: 'الأصل',
  export: 'تصدير',

  // The export sheet: the two formats and how good a JPEG may be.
  exJpeg: 'JPEG',
  exPng: 'PNG',
  quality: 'الجودة',

  // The tool bar — one word per tool.
  tAdjust: 'تعديل',
  tFilters: 'فلاتر',
  tCrop: 'قص',
  tErase: 'إزالة',
  tFace: 'الوجه',
  tSwap: 'تبديل الوجه',
  tBackground: 'الخلفية',

  // The errors, one line each: opening, exporting, and an engine that cannot run.
  errOpen: 'تعذّر فتح الصورة',
  errExport: 'تعذّر التصدير',
  errWebgl: 'جهازك لا يدعم محرر الصور',

  // The thirteen adjustments, one word each, in the order the controls list them.
  pExposure: 'التعريض',
  pBrightness: 'السطوع',
  pContrast: 'التباين',
  pHighlights: 'الإضاءة',
  pShadows: 'الظلال',
  pSaturation: 'التشبع',
  pVibrance: 'الحيوية',
  pTemperature: 'الحرارة',
  pTint: 'الصبغة',
  pFade: 'البهتان',
  pVignette: 'التظليل',
  pGrain: 'الحبيبات',
  pSharpen: 'الحدة',

  // How much of a filter is applied.
  strength: 'القوة',

  // The crop tool: the frame, the turns, the mirror and the dial.
  aspectFree: 'حر',
  aspect11: '1:1',
  aspect45: '4:5',
  aspect34: '3:4',
  aspect916: '9:16',
  aspect169: '16:9',
  aspectOriginal: 'الأصل',
  rotateLeft: 'تدوير يسار',
  rotateRight: 'تدوير يمين',
  flip: 'قلب',
  straighten: 'التقويم',
  apply: 'تطبيق',
  cancel: 'إلغاء',

  // The erase tool: the brush, the eraser that takes the paint back, and the two
  // ways it can fail on a device that will not hold the model or the picture.
  erSize: 'الحجم',
  erEraser: 'الممحاة',
  erRun: 'أزل المحدد',
  erErrModel: 'تعذّر تحميل أداة الإزالة',
  erErrMemory: 'الصورة أكبر مما يحتمله جهازك',

  // The face tool: the ten dials, in the order the strip lists them — the
  // shape of the face first, its retouch after — and the three ways it opens.
  fcNoFace: 'لا يوجد وجه واضح في الصورة',
  fcSlim: 'نحافة الوجه',
  fcJaw: 'الفك',
  fcChin: 'الذقن',
  fcEyes: 'العينان',
  fcNose: 'الأنف',
  fcLips: 'الشفاه',
  fcSmile: 'الابتسامة',
  fcSmooth: 'نعومة البشرة',
  fcTeeth: 'بياض الأسنان',
  fcBright: 'إشراق العينين',
  fcErrModel: 'تعذّر تحميل أداة الوجه',
  fcErrMemory: 'الصورة أكبر مما يحتمله جهازك',

  // The swap tool: the second photo the face comes from, and how much of it
  // crosses. A face missing from EITHER photo is fcNoFace, the same line Face
  // says, because it is the same model that found nothing.
  swPick: 'اختر صورة الوجه',

  // The background tool: the four things the background can become, the blur's
  // own measure, the eight grounds, and the two ways it can fail.
  bgBlur: 'تمويه',
  bgColor: 'لون',
  bgRemove: 'إزالة',
  bgPhoto: 'صورة',
  bgRadius: 'مدى التمويه',
  bgWhite: 'أبيض',
  bgBlack: 'أسود',
  bgGrey: 'رمادي',
  bgBlue: 'أزرق',
  bgSky: 'سماوي',
  bgGreen: 'أخضر',
  bgRose: 'وردي',
  bgSand: 'رملي',
  bgErrModel: 'تعذّر تحميل أداة الخلفية',
  bgErrMemory: 'الصورة أكبر مما يحتمله جهازك',
};

const en = {
  openPhoto: 'Open photo',

  undo: 'Undo',
  redo: 'Redo',
  compare: 'Original',
  export: 'Export',

  exJpeg: 'JPEG',
  exPng: 'PNG',
  quality: 'Quality',

  tAdjust: 'Adjust',
  tFilters: 'Filters',
  tCrop: 'Crop',
  tErase: 'Erase',
  tFace: 'Face',
  tSwap: 'Face swap',
  tBackground: 'Background',

  errOpen: 'Could not open the photo',
  errExport: 'Could not export',
  errWebgl: 'Your device does not support the photo editor',

  pExposure: 'Exposure',
  pBrightness: 'Brightness',
  pContrast: 'Contrast',
  pHighlights: 'Highlights',
  pShadows: 'Shadows',
  pSaturation: 'Saturation',
  pVibrance: 'Vibrance',
  pTemperature: 'Temperature',
  pTint: 'Tint',
  pFade: 'Fade',
  pVignette: 'Vignette',
  pGrain: 'Grain',
  pSharpen: 'Sharpen',

  strength: 'Strength',

  aspectFree: 'Free',
  aspect11: '1:1',
  aspect45: '4:5',
  aspect34: '3:4',
  aspect916: '9:16',
  aspect169: '16:9',
  aspectOriginal: 'Original',
  rotateLeft: 'Rotate left',
  rotateRight: 'Rotate right',
  flip: 'Flip',
  straighten: 'Straighten',
  apply: 'Apply',
  cancel: 'Cancel',

  erSize: 'Size',
  erEraser: 'Eraser',
  erRun: 'Remove selected',
  erErrModel: 'Could not load the removal tool',
  erErrMemory: 'The photo is larger than your device can handle',

  fcNoFace: 'No clear face in the photo',
  fcSlim: 'Face slimness',
  fcJaw: 'Jaw',
  fcChin: 'Chin',
  fcEyes: 'Eyes',
  fcNose: 'Nose',
  fcLips: 'Lips',
  fcSmile: 'Smile',
  fcSmooth: 'Skin smoothness',
  fcTeeth: 'Teeth whiteness',
  fcBright: 'Eye brightness',
  fcErrModel: 'Could not load the face tool',
  fcErrMemory: 'The photo is larger than your device can handle',

  swPick: 'Choose the face photo',

  bgBlur: 'Blur',
  bgColor: 'Colour',
  bgRemove: 'Remove',
  bgPhoto: 'Photo',
  bgRadius: 'Blur amount',
  bgWhite: 'White',
  bgBlack: 'Black',
  bgGrey: 'Grey',
  bgBlue: 'Blue',
  bgSky: 'Sky',
  bgGreen: 'Green',
  bgRose: 'Rose',
  bgSand: 'Sand',
  bgErrModel: 'Could not load the background tool',
  bgErrMemory: 'The photo is larger than your device can handle',
};

/** The whole dictionary, keyed by language. */
export const strings = { ar, en };

let current = 'ar';

/** Any value that is not `'en'` is Arabic: Arabic is the default, not the fallback. */
export function setLang(lang) {
  current = lang === 'en' ? 'en' : 'ar';
  return current;
}

export function getLang() {
  return current;
}

/**
 * One string by key, with `{name}` placeholders replaced when `vars` is given.
 * An unknown key answers the key itself — visible on screen, never a blank
 * control.
 */
export function t(key, vars) {
  const table = strings[current];
  const raw = table[key] !== undefined ? table[key] : ar[key] !== undefined ? ar[key] : key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}
