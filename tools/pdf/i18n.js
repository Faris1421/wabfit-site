/**
 * Wab Fit — the PDF tool's words.
 *
 * Arabic is the source language, so the Arabic table is written first and the
 * English one is a translation OF it, never the other way round. The two tables
 * carry the same keys; a key that exists in one and not the other is a bug the
 * page shows as a raw key on screen, which is why every key below is complete in
 * both.
 *
 * Nothing else in this directory may hold a user-visible string. The brand is
 * written "Wab Fit" in Latin letters, always — including inside an Arabic
 * sentence.
 *
 * `{x}`, `{n}`, `{to}` and `{deg}` are the only substitutions here, and every one
 * of them carries NUMERALS rather than words, which is why `pageOf` and the lines
 * of a plan read the same in both languages.
 */

/** Arabic first. This is the source. */
const ar = {
  // The two ways in.
  openPdf: 'فتح ملف PDF',
  newBlank: 'مستند فارغ',

  // A locked file: the field that asks, the two things said when the password
  // was wrong or cannot be written back into the export.
  password: 'كلمة المرور',
  wrongPassword: 'كلمة المرور غير صحيحة',
  exportUnencrypted: 'ستُصدَّر النسخة بلا كلمة مرور',

  // Taking the lock off: the two locks a file can carry, what the copy that comes
  // back is, and the one dead end there is.
  tUnlock: 'إزالة القفل',
  unlockNow: 'أزل القفل',
  lockOwner: 'الملف مقفل بقيود على الطباعة والنسخ، ويُفتح بلا كلمة مرور',
  lockUser: 'الملف مقفل بكلمة مرور، ولا يُفتح بدونها',
  lockForgotten: 'كلمة المرور المنسية لا سبيل إلى استعادتها',
  lockNone: 'لا قفل على هذا الملف',
  unlockedOwner: 'أُزيلت قيود الطباعة والنسخ، وصفحات النسخة صور',
  unlockedUser: 'أُزيل القفل وحُفظت نسخة بلا كلمة مرور، وصفحاتها صور',
  unlockFailed: 'تعذّر إنشاء النسخة',

  // The top bar.
  export: 'تصدير',
  undo: 'تراجع',
  redo: 'إعادة',
  pageOf: '{x} / {n}',

  // The tool bar — one word under each icon.
  tSelect: 'تحديد',
  tText: 'نص',
  tDraw: 'رسم',
  tHighlight: 'تظليل',
  tShapes: 'أشكال',
  tImage: 'صورة',
  tSign: 'توقيع',
  tWhiteout: 'طمس',
  tEditText: 'تعديل نص',
  tForms: 'نماذج',
  tPages: 'الصفحات',

  // The property strip above the tool bar.
  color: 'اللون',
  size: 'الحجم',
  opacity: 'الشفافية',
  bold: 'عريض',
  shape: 'الشكل',
  fill: 'تعبئة',
  secureRedact: 'طمس نهائي',

  // The bar that floats beside a picked object, and its eight handles.
  edit: 'تحرير',
  bringForward: 'تقديم',
  sendBack: 'تأخير',
  resize: 'تغيير الحجم',

  // Page operations, used by the pages tool.
  del: 'حذف',
  rotate: 'تدوير',
  duplicate: 'تكرار',
  blankPage: 'صفحة فارغة',
  mergeFile: 'دمج ملف',
  extractSelected: 'استخراج المحدد',
  done: 'تم',

  // The signature pad: the pad's own Clear, beside the Done every panel has.
  clear: 'مسح',

  // Lifting a signature that is already on a page: the action that starts it,
  // the two answers its result can be given, and the line that says the trim
  // was made here when the model did not help with it.
  liftSign: 'التقاط توقيع من الصفحة',
  saveSign: 'احفظ',
  tryAgain: 'أعد المحاولة',
  liftLocal: 'قُصّ التوقيع هنا بلا مساعدة الذكاء الاصطناعي',
  // The inks a lifted pen may be painted in, and the eraser that rubs out a mark
  // the cut kept by mistake.
  inkBlack: 'الأسود',
  inkBlue: 'الأزرق',
  inkSource: 'لون الحبر الأصلي',
  erase: 'ممحاة',
  // The command bar: what the person wants done, and the plan before it runs.
  ask: 'اسأل',
  askWhat: 'اكتب ما تريد تعديله في الملف',
  planTitle: 'الخطة',
  run: 'نفّذ',
  cancelPlan: 'إلغاء',
  planOutside: 'هذا الطلب خارج ما ينفّذه المحرر',

  // One line per operation a plan may hold, read with the person's own numerals.
  opAddText: 'كتابة نص على الصفحة {n}',
  opAddPage: 'صفحة فارغة في الموضع {n}',
  opDeletePage: 'حذف الصفحة {n}',
  opDuplicatePage: 'تكرار الصفحة {n}',
  opMovePage: 'نقل الصفحة {n} إلى الموضع {to}',
  opRotatePage: 'تدوير الصفحة {n} بمقدار {deg} درجة',
  opWhiteout: 'طمس مستطيل على الصفحة {n}',
  opHighlight: 'تظليل على الصفحة {n}',
  opAddShape: 'إضافة شكل على الصفحة {n}',

  // Looking for words on a page: the tool, the place of the match in hand among
  // the matches found, and the two steps either way.
  tSearch: 'بحث',
  searchCount: '{x} / {n}',
  prevMatch: 'السابق',
  nextMatch: 'التالي',
};

const en = {
  openPdf: 'Open PDF',
  newBlank: 'Blank document',

  password: 'Password',
  wrongPassword: 'Wrong password',
  exportUnencrypted: 'The exported copy will have no password',

  tUnlock: 'Remove lock',
  unlockNow: 'Remove the lock',
  lockOwner: 'The file is locked with printing and copying restrictions, and opens without a password',
  lockUser: 'The file is locked with a password, and does not open without it',
  lockForgotten: 'A forgotten password cannot be recovered',
  lockNone: 'This file has no lock',
  unlockedOwner: 'Printing and copying restrictions removed; the pages of the copy are pictures',
  unlockedUser: 'The lock is removed and a copy with no password is saved; its pages are pictures',
  unlockFailed: 'The copy could not be made',

  export: 'Export',
  undo: 'Undo',
  redo: 'Redo',
  pageOf: '{x} / {n}',

  tSelect: 'Select',
  tText: 'Text',
  tDraw: 'Draw',
  tHighlight: 'Highlight',
  tShapes: 'Shapes',
  tImage: 'Image',
  tSign: 'Sign',
  tWhiteout: 'Whiteout',
  tEditText: 'Edit text',
  tForms: 'Forms',
  tPages: 'Pages',

  color: 'Colour',
  size: 'Size',
  opacity: 'Opacity',
  bold: 'Bold',
  shape: 'Shape',
  fill: 'Fill',
  secureRedact: 'Final redaction',

  edit: 'Edit',
  bringForward: 'Bring forward',
  sendBack: 'Send back',
  resize: 'Resize',

  del: 'Delete',
  rotate: 'Rotate',
  duplicate: 'Duplicate',
  blankPage: 'Blank page',
  mergeFile: 'Merge file',
  extractSelected: 'Extract selected',
  done: 'Done',

  clear: 'Clear',

  liftSign: 'Lift a signature from the page',
  saveSign: 'Save',
  tryAgain: 'Try again',
  liftLocal: 'The signature was trimmed here without AI help',
  inkBlack: 'Black',
  inkBlue: 'Blue',
  inkSource: 'The ink’s own colour',
  erase: 'Eraser',
  ask: 'Ask',
  askWhat: 'Write what you want changed in the file',
  planTitle: 'Plan',
  run: 'Run',
  cancelPlan: 'Cancel',
  planOutside: 'That request is outside what the editor can do',

  opAddText: 'Write text on page {n}',
  opAddPage: 'Blank page at position {n}',
  opDeletePage: 'Delete page {n}',
  opDuplicatePage: 'Duplicate page {n}',
  opMovePage: 'Move page {n} to position {to}',
  opRotatePage: 'Rotate page {n} by {deg} degrees',
  opWhiteout: 'White out a rectangle on page {n}',
  opHighlight: 'Highlight on page {n}',
  opAddShape: 'Add a shape on page {n}',

  tSearch: 'Search',
  searchCount: '{x} / {n}',
  prevMatch: 'Previous',
  nextMatch: 'Next',
};

/** The whole dictionary, keyed by language. Exported so a test can compare the two halves. */
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
 * An unknown key answers the key itself — visible, and never a blank control.
 */
export function t(key, vars) {
  const table = strings[current];
  const raw = table[key] !== undefined ? table[key] : ar[key] !== undefined ? ar[key] : key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}
