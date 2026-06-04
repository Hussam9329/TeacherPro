export const IRAQI_PROVINCES = [
  'البصرة',
  'نينوى',
  'أربيل',
  'النجف',
  'كربلاء',
  'كركوك',
  'السليمانية',
  'ديالى',
  'الأنبار',
  'بابل',
  'واسط',
  'ذي قار',
  'ميسان',
  'المثنى',
  'القادسية',
  'صلاح الدين',
  'دهوك',
] as const;

export type IraqiProvince = (typeof IRAQI_PROVINCES)[number];

/** الخيارات للموقع الرئيسي في الدورات العامة */
export const PUBLIC_MAIN_SITE_OPTIONS = ['بغداد', 'محافظات'] as const;

/** المناطق الفرعية للدورة الخاصة في بغداد */
export const PRIVATE_BAGHDAD_SUB_SITES = ['المنصور', 'زيونة', 'البنوك'] as const;

/** مواقع بغداد المتاحة في إعدادات الدورة (صنع الدورة) */
export const BAGHDAD_COURSE_SITES = ['المنصور', 'زيونة', 'البنوك'] as const;

/** خيارات الموقع الرئيسي الكاملة (لإدارة المواقع والامتحانات) */
export const MAIN_SITE_OPTIONS = ['بغداد', ...IRAQI_PROVINCES, 'أونلاين'] as const;
