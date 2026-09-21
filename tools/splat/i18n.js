/**
 * The viewer's words. Arabic first — it is the app's source language — and
 * both objects carry the SAME keys, so a missing translation is a typo, not a
 * fallback. boot.js is the only file that reads this.
 *
 * The brand is written "Wab Fit", in Latin letters, always, even inside an
 * Arabic sentence. Nothing here says it; the page's title does.
 */
export const STRINGS = {
  ar: {
    loading: "يُحمَّل المجسّم",
    noSource: "لا يوجد مجسّم للعرض",
    errNetwork: "تعذّر تحميل المجسّم",
    errFormat: "ملف المجسّم غير صالح",
    errWebgl: "جهازك لا يدعم العرض ثلاثي الأبعاد",
    reset: "إعادة ضبط العرض",
  },
  en: {
    loading: "Loading the scan",
    noSource: "Nothing to show",
    errNetwork: "The scan could not be loaded",
    errFormat: "The scan file is not valid",
    errWebgl: "This device cannot render 3D",
    reset: "Reset view",
  },
};
