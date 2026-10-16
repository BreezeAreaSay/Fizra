// Приводим номер к виду +79991234567, чтобы SMS точно ушла по адресу,
// как бы его ни ввели: «8 (999) 123-45-67», «+7 999 1234567», «9991234567».
export function normalizePhone(value) {
  const raw = String(value ?? '').trim();
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith('9')) digits = `7${digits}`;
  if (digits.length < 5 || digits.length > 15) return '';
  // Без кода страны оставляем как есть: так работают и короткие внутренние номера.
  const international = raw.startsWith('+') || (digits.length === 11 && digits.startsWith('7'));
  return international ? `+${digits}` : digits;
}

export function formatPhone(phone) {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : phone;
}
