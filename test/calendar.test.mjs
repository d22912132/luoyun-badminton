import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCalendarCsv, supportedCalendarYears } from '../calendar.mjs';

test('official calendar CSV is parsed into dates, holiday flags and quoted notes', () => {
  const rows = parseCalendarCsv('\uFEFF西元日期,星期,是否放假,備註\n20260101,四,2,開國紀念日\n20260102,五,0,"辦公日,照常上班"\n');
  assert.deepEqual(rows, [
    { date: '2026-01-01', weekday: '四', isHoliday: true, note: '開國紀念日' },
    { date: '2026-01-02', weekday: '五', isHoliday: false, note: '辦公日,照常上班' }
  ]);
  assert.deepEqual(supportedCalendarYears(), [2026, 2027]);
});
