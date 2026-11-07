export const TIME_ZONE = 'America/Sao_Paulo';

const pad = (value) => String(value).padStart(2, '0');

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const longDateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

export function getZonedParts(date = new Date()) {
  const values = {};
  for (const part of partsFormatter.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function getTimeZoneOffsetMs(date) {
  const parts = getZonedParts(date);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function zonedTimeToUtc(year, month, day, hour = 0, minute = 0, second = 0) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = getTimeZoneOffsetMs(new Date(utcGuess));
  let timestamp = utcGuess - firstOffset;
  const secondOffset = getTimeZoneOffsetMs(new Date(timestamp));
  if (secondOffset !== firstOffset) {
    timestamp = utcGuess - secondOffset;
  }
  return new Date(timestamp);
}

export function toDatetimeLocalValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = getZonedParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function fromDatetimeLocalValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  const date = zonedTimeToUtc(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5])
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toDateInputValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = getZonedParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function formatDateBR(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = getZonedParts(date);
  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year}`;
}

export function formatTimeBR(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = getZonedParts(date);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatDateTimeBR(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${formatDateBR(date)} às ${formatTimeBR(date)}`;
}

export function formatLongDateSP(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const text = longDateFormatter.format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function greetingSP(value = new Date()) {
  const hour = getZonedParts(value).hour;
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function formatElapsed(isoDate, now = Date.now()) {
  const start = new Date(isoDate).getTime();
  if (Number.isNaN(start)) return '';
  const diffMinutes = Math.max(0, Math.floor((now - start) / 60000));
  if (diffMinutes < 1) return 'agora';
  if (diffMinutes < 60) return `há ${diffMinutes} min`;

  const hours = Math.floor(diffMinutes / 60);
  const restMinutes = diffMinutes % 60;
  if (hours < 24) {
    return restMinutes ? `há ${hours} h ${restMinutes} min` : `há ${hours} h`;
  }

  const days = Math.floor(hours / 24);
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
}

export function urgencyLevel(isoDate, now = Date.now()) {
  const start = new Date(isoDate).getTime();
  if (Number.isNaN(start)) return 'normal';
  const hours = (now - start) / 3600000;
  if (hours >= 8) return 'critical';
  if (hours >= 4) return 'warning';
  return 'normal';
}

function parseDateInput(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function addDaysToParts(year, month, day, delta) {
  const date = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function midnightOf(year, month, day) {
  return zonedTimeToUtc(year, month, day, 0, 0, 0);
}

function labelOfParts(parts) {
  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year}`;
}

export function getPeriodRange(kind, customStart, customEnd, now = new Date()) {
  const today = getZonedParts(now);
  let start;
  let end;
  let startLabel;
  let endLabel;

  if (kind === 'personalizado') {
    const startParts = parseDateInput(customStart);
    const endParts = parseDateInput(customEnd);
    if (!startParts || !endParts) {
      throw new Error('Informe as datas inicial e final.');
    }
    if (customStart > customEnd) {
      throw new Error('A data inicial não pode ser depois da data final.');
    }
    start = midnightOf(startParts.year, startParts.month, startParts.day);
    const afterEnd = addDaysToParts(endParts.year, endParts.month, endParts.day, 1);
    end = midnightOf(afterEnd.year, afterEnd.month, afterEnd.day);
    startLabel = labelOfParts(startParts);
    endLabel = labelOfParts(endParts);
  } else if (kind === 'ontem') {
    const yesterday = addDaysToParts(today.year, today.month, today.day, -1);
    start = midnightOf(yesterday.year, yesterday.month, yesterday.day);
    end = midnightOf(today.year, today.month, today.day);
    startLabel = labelOfParts(yesterday);
    endLabel = labelOfParts(yesterday);
  } else if (kind === 'ultimos7') {
    const firstDay = addDaysToParts(today.year, today.month, today.day, -6);
    const afterToday = addDaysToParts(today.year, today.month, today.day, 1);
    start = midnightOf(firstDay.year, firstDay.month, firstDay.day);
    end = midnightOf(afterToday.year, afterToday.month, afterToday.day);
    startLabel = labelOfParts(firstDay);
    endLabel = labelOfParts(today);
  } else if (kind === 'mes') {
    const firstDay = { year: today.year, month: today.month, day: 1 };
    const nextMonth = addDaysToParts(today.year, today.month, 1, 32);
    const afterMonth = { year: nextMonth.year, month: nextMonth.month, day: 1 };
    start = midnightOf(firstDay.year, firstDay.month, firstDay.day);
    end = midnightOf(afterMonth.year, afterMonth.month, afterMonth.day);
    startLabel = labelOfParts(firstDay);
    endLabel = labelOfParts(addDaysToParts(afterMonth.year, afterMonth.month, afterMonth.day, -1));
  } else {
    const afterToday = addDaysToParts(today.year, today.month, today.day, 1);
    start = midnightOf(today.year, today.month, today.day);
    end = midnightOf(afterToday.year, afterToday.month, afterToday.day);
    startLabel = labelOfParts(today);
    endLabel = labelOfParts(today);
  }

  return {
    kind,
    start,
    end,
    startLabel,
    endLabel,
    label: `${startLabel} a ${endLabel}`,
  };
}
