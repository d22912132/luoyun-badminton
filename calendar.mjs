const CALENDAR_URLS = {
  2026: 'https://www.dgpa.gov.tw/FileConversion?filename=dgpa%2Ffiles%2F202506%2Fa52331bd-a189-466b-b0f0-cae3062bbf74.csv&name=115%E5%B9%B4%E4%B8%AD%E8%8F%AF%E6%B0%91%E5%9C%8B%E6%94%BF%E5%BA%9C%E8%A1%8C%E6%94%BF%E6%A9%9F%E9%97%9C%E8%BE%A6%E5%85%AC%E6%97%A5%E6%9B%86%E8%A1%A8.csv&nfix=',
  2027: 'https://www.dgpa.gov.tw/FileConversion?filename=dgpa%2Ffiles%2F202607%2Ff538b1ff-ba60-4c63-9477-10db8e6612d1.csv&name=116%E5%B9%B4%E4%B8%AD%E8%8F%AF%E6%B0%91%E5%9C%8B%E6%94%BF%E5%BA%9C%E8%A1%8C%E6%94%BF%E6%A9%9F%E9%97%9C%E8%BE%A6%E5%85%AC%E6%97%A5%E6%9B%86%E8%A1%A8_utf8bom.csv&nfix='
};

const cache = new Map();
const CACHE_MS = 24 * 60 * 60 * 1000;

function csvRow(line) {
  const fields = []; let value = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { fields.push(value); value = ''; }
    else value += ch;
  }
  fields.push(value);
  return fields;
}

export function parseCalendarCsv(csv) {
  return String(csv).replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).filter(Boolean).map(line => {
    const [rawDate, weekday, holiday, ...note] = csvRow(line);
    const match = String(rawDate).trim().match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!match) return null;
    return {
      date: `${match[1]}-${match[2]}-${match[3]}`,
      weekday: String(weekday || '').trim(),
      isHoliday: String(holiday).trim() === '2',
      note: note.join(',').trim()
    };
  }).filter(Boolean);
}

export function supportedCalendarYears() { return Object.keys(CALENDAR_URLS).map(Number); }

export async function getOfficialCalendar(year, fetcher = fetch) {
  const url = CALENDAR_URLS[year];
  if (!url) throw Object.assign(new Error('此年度的行政院行事曆尚未公布'), { status: 404 });
  const hit = cache.get(year);
  if (hit && hit.expires > Date.now()) return hit.data;
  const response = await fetcher(url, { headers: { Accept: 'text/csv' } });
  if (!response.ok) throw Object.assign(new Error('行政院行事曆暫時無法取得'), { status: 502 });
  const days = parseCalendarCsv(await response.text());
  if (days.length < 300) throw Object.assign(new Error('行政院行事曆資料格式異常'), { status: 502 });
  const data = {
    year, days, fetchedAt: new Date().toISOString(),
    source: '行政院人事行政總處', sourceUrl: 'https://data.gov.tw/dataset/14718',
    supportedYears: supportedCalendarYears()
  };
  cache.set(year, { expires: Date.now() + CACHE_MS, data });
  return data;
}
