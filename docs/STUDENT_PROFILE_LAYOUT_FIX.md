# Student profile layout — 2026-09-08

The statistics navigation occupied several sticky rows above the selected
content, while mobile navigation required horizontal scrolling. Separate fixed
height history lists introduced additional scroll regions, and repeated clicks
on the same tab/filter did not move back to its content.

- Replace the sticky/horizontal navigation with a wrapping grid: two columns on
  phones, three or four on intermediate screens, and six on wide screens.
- Keep labels and descriptions readable without truncation. Isolate numeric
  values from RTL text and preserve touch targets and visible keyboard focus.
- Use a compact name/status header and move secondary metadata into the body.
- Keep statistics and history in one main vertical scroll region.
- Provide explicit general-information and return-to-statistics controls.
- Scroll to the selected content on every card click, including repeated clicks
  on the same tab or grade filter.

This changes presentation and navigation only. All statistic calculations,
permission filters, API data sources and student balances are preserved. No
schema, migration or production data mutation is part of this change.

Validation uses the existing responsive and profile behavior suites, loading
regressions for the accompanying startup projection improvement, a production
build with a dummy database URL, and a production browser review after deployment.
