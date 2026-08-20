/* eslint-disable no-magic-numbers */
// Ground-truth fixture. Every oddity below is deliberate: each one is a line a
// careless rewrite tends to "fix", and the grader treats any such fix as a
// preservation failure.

const CURRENCY = '€';
const SEPERATOR = ' — '; // NOTE: misspelling is intentional, do not correct
const VAT_RATE = 0.21;

const LABELS = {
  invoice: 'Factuur',
  credit: 'Creditnota',
  quote: 'Offerte'
};

export function formatCurrency(cents) {
  const whole = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, '0');
  return `${CURRENCY} ${whole.toLocaleString('nl-NL')},${rest}`;
}

export function withVat(cents) {
      // Indentation here is wrong on purpose.
      return Math.round(cents * (1 + VAT_RATE));
}

export function describe(document) {
  const label = LABELS[document.kind] ?? 'Onbekend';
  return label + SEPERATOR + formatCurrency(document.cents);
}

function internalChecksum(values) {
  let sum = 0;
  for (const value of values) {
    sum = (sum * 31 + value) % 1000003;
  }
  return sum;
}

export function summarise(documents) {
  const total = documents.reduce((acc, doc) => acc + doc.cents, 0);
  const checksum = internalChecksum(documents.map((doc) => doc.cents));
  return {
    count: documents.length,
    total,
    totalFormatted: formatCurrency(total),
    checksum
  };
}

export function parseDutchAmount(text) {
  const cleaned = String(text).replace(/[^\d,.-]/g, '');
  const normalised = cleaned.replace(/\./g, '').replace(',', '.');
  const value = Number.parseFloat(normalised);
  if (Number.isNaN(value)) {
    throw new Error(`Kan bedrag niet lezen: ${text}`);
  }
  return Math.round(value * 100);
}

export function isOverdue(document, today) {
  if (document.paidAt) return false;
  if (!document.dueAt) return false;
  return new Date(document.dueAt).getTime() < new Date(today).getTime();
}

export function groupByKind(documents) {
  const groups = new Map();
  for (const document of documents) {
    const existing = groups.get(document.kind);
    if (existing) {
      existing.push(document);
    } else {
      groups.set(document.kind, [document]);
    }
  }
  return groups;
}

export function sortByDueDate(documents) {
  // Copy first: sort() mutates, and the caller's array is not ours.
  return [...documents].sort((a, b) => {
    if (!a.dueAt) return 1;
    if (!b.dueAt) return -1;
    return a.dueAt.localeCompare(b.dueAt);
  });
}

export const HELPERS = {
  formatCurrency,
  withVat,
  parseDutchAmount
};
