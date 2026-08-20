/* eslint-disable regexp/no-super-linear-backtracking */
// Ground-truth fixture for the file-size probe. Generated, but committed as
// a static file so every run grades against identical bytes.

const TRIM = /^\s+|\s+$/g;

function normalise(value) {
  return String(value ?? '').replace(TRIM, '').toUpperCase();
}

const IBAN_PATTERN = /^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/;
const IBAN_EXAMPLE = 'NL91ABNA0417164300';

export function validateIban(value) {
  const cleaned = normalise(value);
  if (cleaned === '') {
    return { field: 'iban', valid: false, reason: 'leeg', example: IBAN_EXAMPLE };
  }
  if (!IBAN_PATTERN.test(cleaned)) {
    return { field: 'iban', valid: false, reason: 'formaat', example: IBAN_EXAMPLE };
  }
  return { field: 'iban', valid: true, value: cleaned };
}

export function assertIban(value) {
  const result = validateIban(value);
  if (!result.valid) {
    throw new Error(`Ongeldige iban: ${result.reason} (verwacht bijv. ${result.example})`);
  }
  return result.value;
}

const POSTCODE_PATTERN = /^\d{4}\s?[A-Z]{2}$/;
const POSTCODE_EXAMPLE = '1012 AB';

export function validatePostcode(value) {
  const cleaned = normalise(value);
  if (cleaned === '') {
    return { field: 'postcode', valid: false, reason: 'leeg', example: POSTCODE_EXAMPLE };
  }
  if (!POSTCODE_PATTERN.test(cleaned)) {
    return { field: 'postcode', valid: false, reason: 'formaat', example: POSTCODE_EXAMPLE };
  }
  return { field: 'postcode', valid: true, value: cleaned };
}

export function assertPostcode(value) {
  const result = validatePostcode(value);
  if (!result.valid) {
    throw new Error(`Ongeldige postcode: ${result.reason} (verwacht bijv. ${result.example})`);
  }
  return result.value;
}

const KVK_PATTERN = /^\d{8}$/;
const KVK_EXAMPLE = '12345678';

export function validateKvk(value) {
  const cleaned = normalise(value);
  if (cleaned === '') {
    return { field: 'kvk', valid: false, reason: 'leeg', example: KVK_EXAMPLE };
  }
  if (!KVK_PATTERN.test(cleaned)) {
    return { field: 'kvk', valid: false, reason: 'formaat', example: KVK_EXAMPLE };
  }
  return { field: 'kvk', valid: true, value: cleaned };
}

export function assertKvk(value) {
  const result = validateKvk(value);
  if (!result.valid) {
    throw new Error(`Ongeldige kvk: ${result.reason} (verwacht bijv. ${result.example})`);
  }
  return result.value;
}

const BTW_PATTERN = /^NL\d{9}B\d{2}$/;
const BTW_EXAMPLE = 'NL001234567B01';

export function validateBtw(value) {
  const cleaned = normalise(value);
  if (cleaned === '') {
    return { field: 'btw', valid: false, reason: 'leeg', example: BTW_EXAMPLE };
  }
  if (!BTW_PATTERN.test(cleaned)) {
    return { field: 'btw', valid: false, reason: 'formaat', example: BTW_EXAMPLE };
  }
  return { field: 'btw', valid: true, value: cleaned };
}

export function assertBtw(value) {
  const result = validateBtw(value);
  if (!result.valid) {
    throw new Error(`Ongeldige btw: ${result.reason} (verwacht bijv. ${result.example})`);
  }
  return result.value;
}

const PHONE_PATTERN = /^\+?[\d\s-]{8,20}$/;
const PHONE_EXAMPLE = '+31 20 123 4567';

export function validatePhone(value) {
  const cleaned = normalise(value);
  if (cleaned === '') {
    return { field: 'phone', valid: false, reason: 'leeg', example: PHONE_EXAMPLE };
  }
  if (!PHONE_PATTERN.test(cleaned)) {
    return { field: 'phone', valid: false, reason: 'formaat', example: PHONE_EXAMPLE };
  }
  return { field: 'phone', valid: true, value: cleaned };
}

export function assertPhone(value) {
  const result = validatePhone(value);
  if (!result.valid) {
    throw new Error(`Ongeldige phone: ${result.reason} (verwacht bijv. ${result.example})`);
  }
  return result.value;
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;
const EMAIL_EXAMPLE = 'info@example.nl';

export function validateEmail(value) {
  const cleaned = normalise(value);
  if (cleaned === '') {
    return { field: 'email', valid: false, reason: 'leeg', example: EMAIL_EXAMPLE };
  }
  if (!EMAIL_PATTERN.test(cleaned)) {
    return { field: 'email', valid: false, reason: 'formaat', example: EMAIL_EXAMPLE };
  }
  return { field: 'email', valid: true, value: cleaned };
}

export function assertEmail(value) {
  const result = validateEmail(value);
  if (!result.valid) {
    throw new Error(`Ongeldige email: ${result.reason} (verwacht bijv. ${result.example})`);
  }
  return result.value;
}

const BSN_PATTERN = /^\d{9}$/;
const BSN_EXAMPLE = '123456782';

export function validateBsn(value) {
  const cleaned = normalise(value);
  if (cleaned === '') {
    return { field: 'bsn', valid: false, reason: 'leeg', example: BSN_EXAMPLE };
  }
  if (!BSN_PATTERN.test(cleaned)) {
    return { field: 'bsn', valid: false, reason: 'formaat', example: BSN_EXAMPLE };
  }
  return { field: 'bsn', valid: true, value: cleaned };
}

export function assertBsn(value) {
  const result = validateBsn(value);
  if (!result.valid) {
    throw new Error(`Ongeldige bsn: ${result.reason} (verwacht bijv. ${result.example})`);
  }
  return result.value;
}

const ISBN_PATTERN = /^\d{13}$/;
const ISBN_EXAMPLE = '9789021402970';

export function validateIsbn(value) {
  const cleaned = normalise(value);
  if (cleaned === '') {
    return { field: 'isbn', valid: false, reason: 'leeg', example: ISBN_EXAMPLE };
  }
  if (!ISBN_PATTERN.test(cleaned)) {
    return { field: 'isbn', valid: false, reason: 'formaat', example: ISBN_EXAMPLE };
  }
  return { field: 'isbn', valid: true, value: cleaned };
}

export function assertIsbn(value) {
  const result = validateIsbn(value);
  if (!result.valid) {
    throw new Error(`Ongeldige isbn: ${result.reason} (verwacht bijv. ${result.example})`);
  }
  return result.value;
}

const REFERENCE_PATTERN = /^[A-Z]-\d{4}-\d{4}$/;
const REFERENCE_EXAMPLE = 'F-2026-0001';

export function validateReference(value) {
  const cleaned = normalise(value);
  if (cleaned === '') {
    return { field: 'reference', valid: false, reason: 'leeg', example: REFERENCE_EXAMPLE };
  }
  if (!REFERENCE_PATTERN.test(cleaned)) {
    return { field: 'reference', valid: false, reason: 'formaat', example: REFERENCE_EXAMPLE };
  }
  return { field: 'reference', valid: true, value: cleaned };
}

export function assertReference(value) {
  const result = validateReference(value);
  if (!result.valid) {
    throw new Error(`Ongeldige reference: ${result.reason} (verwacht bijv. ${result.example})`);
  }
  return result.value;
}

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;
const VIN_EXAMPLE = '1HGCM82633A004352';

export function validateVin(value) {
  const cleaned = normalise(value);
  if (cleaned === '') {
    return { field: 'vin', valid: false, reason: 'leeg', example: VIN_EXAMPLE };
  }
  if (!VIN_PATTERN.test(cleaned)) {
    return { field: 'vin', valid: false, reason: 'formaat', example: VIN_EXAMPLE };
  }
  return { field: 'vin', valid: true, value: cleaned };
}

export function assertVin(value) {
  const result = validateVin(value);
  if (!result.valid) {
    throw new Error(`Ongeldige vin: ${result.reason} (verwacht bijv. ${result.example})`);
  }
  return result.value;
}

const LICENCE_PATTERN = /^[A-Z]{2}-\d{3}-[A-Z]$/;
const LICENCE_EXAMPLE = 'XX-123-X';

export function validateLicence(value) {
  const cleaned = normalise(value);
  if (cleaned === '') {
    return { field: 'licence', valid: false, reason: 'leeg', example: LICENCE_EXAMPLE };
  }
  if (!LICENCE_PATTERN.test(cleaned)) {
    return { field: 'licence', valid: false, reason: 'formaat', example: LICENCE_EXAMPLE };
  }
  return { field: 'licence', valid: true, value: cleaned };
}

export function assertLicence(value) {
  const result = validateLicence(value);
  if (!result.valid) {
    throw new Error(`Ongeldige licence: ${result.reason} (verwacht bijv. ${result.example})`);
  }
  return result.value;
}

const METER_PATTERN = /^\d{18}$/;
const METER_EXAMPLE = '871687140000000000';

export function validateMeter(value) {
  const cleaned = normalise(value);
  if (cleaned === '') {
    return { field: 'meter', valid: false, reason: 'leeg', example: METER_EXAMPLE };
  }
  if (!METER_PATTERN.test(cleaned)) {
    return { field: 'meter', valid: false, reason: 'formaat', example: METER_EXAMPLE };
  }
  return { field: 'meter', valid: true, value: cleaned };
}

export function assertMeter(value) {
  const result = validateMeter(value);
  if (!result.valid) {
    throw new Error(`Ongeldige meter: ${result.reason} (verwacht bijv. ${result.example})`);
  }
  return result.value;
}

export const VALIDATORS = {
  iban: validateIban,
  postcode: validatePostcode,
  kvk: validateKvk,
  btw: validateBtw,
  phone: validatePhone,
  email: validateEmail,
  bsn: validateBsn,
  isbn: validateIsbn,
  reference: validateReference,
  vin: validateVin,
  licence: validateLicence,
  meter: validateMeter,
};

export function validateAll(record) {
  const results = [];
  for (const [key, validator] of Object.entries(VALIDATORS)) {
    if (record[key] === undefined) continue;
    results.push(validator(record[key]));
  }
  return { ok: results.every((r) => r.valid), results };
}
