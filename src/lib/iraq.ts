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
  'الناصرية',
  'ميسان',
  'المثنى',
  'الديوانية',
  'صلاح الدين',
  'دهوك',
] as const;

export function normalizeIraqiProvinceName(value: string): string {
  const trimmed = String(value || '').trim();
  if (trimmed === 'القادسية') return 'الديوانية';
  if (trimmed === 'ذي قار') return 'الناصرية';
  return trimmed;
}

export function uniqueNormalizedIraqiProvinces(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeIraqiProvinceName).filter(Boolean)));
}

/** مواقع بغداد المتاحة في إعدادات الدورة (صنع الدورة) */
export const BAGHDAD_COURSE_SITES = ['المنصور', 'زيونة', 'البنوك'] as const;

/** خيارات الموقع الرئيسي الكاملة (لإدارة المواقع والامتحانات) */
export const MAIN_SITE_OPTIONS = ['بغداد', ...IRAQI_PROVINCES, 'خارج القطر', 'أونلاين'] as const;
