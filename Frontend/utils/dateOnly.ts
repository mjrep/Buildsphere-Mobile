export function parseDateOnly(value?: string | null) {
  if (!value) return null;

  const dateString = String(value).split('T')[0];
  const [year, month, day] = dateString.split('-').map(Number);
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day);
}

export function toDateOnlyString(date: Date | null) {
  if (!date) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeDateOnlyString(value?: string | null) {
  if (!value) return '';

  const dateString = String(value).split('T')[0];
  const [year, month, day] = dateString.split('-');
  if (!year || !month || !day) return dateString;

  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function formatDateOnlyDisplay(value?: string | Date | null) {
  if (!value) return 'Not set';

  const dateString = value instanceof Date ? toDateOnlyString(value) : normalizeDateOnlyString(value);
  const [year, month, day] = dateString.split('-');
  if (!year || !month || !day) return dateString;

  return `${month}/${day}/${year}`;
}

export function calculateAgeFromDateOnly(value?: string | Date | null) {
  const birthdate = value instanceof Date ? value : parseDateOnly(value);
  if (!birthdate) return null;

  const today = new Date();
  const birthdayHasPassed =
    today.getMonth() > birthdate.getMonth() ||
    (today.getMonth() === birthdate.getMonth() && today.getDate() >= birthdate.getDate());

  return Math.max(0, today.getFullYear() - birthdate.getFullYear() - (birthdayHasPassed ? 0 : 1));
}
