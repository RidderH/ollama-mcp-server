#!/usr/bin/env node
/**
 * Build the vision fixtures.
 *
 * Deterministic on purpose: the PDF is written here by hand using the base-14
 * Helvetica that every PDF reader already has, so nothing depends on an
 * installed font, a browser, or a screenshot of a window whose size the OS
 * decides. `pdftoppm` then rasterises it, which makes **resolution an exact
 * dial** rather than something approximated by scaling an image down — and
 * resolution is the axis gap #8 is about.
 *
 *   node evals/fixtures/vision/make-fixtures.mjs
 *
 * Rerunning it must reproduce the committed PNGs byte for byte on the same
 * poppler version. The PNGs are committed so the probes run without poppler.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const OUT = new URL('.', import.meta.url).pathname;

/** WinAnsi byte for the characters the invoice needs beyond ASCII. */
function pdfEscape(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/€/g, '\\200')
    .replace(/–/g, '\\226');
}

/**
 * One page of positioned text, optionally rotated about the page centre.
 *
 * The rotation is the "photographed on a desk" axis: a scan that is a few
 * degrees off true is the single most common defect in a document someone
 * sends you, and it is the one that breaks naive column detection.
 */
function contentStream(lines, degrees) {
  const parts = [];
  if (degrees !== 0) {
    const rad = (degrees * Math.PI) / 180;
    const [c, s] = [Math.cos(rad), Math.sin(rad)];
    const [cx, cy] = [297.5, 635];
    // Rotate about the centre: translate to origin, rotate, translate back.
    const e = cx - c * cx + s * cy;
    const f = cy - s * cx - c * cy;
    parts.push(`${c.toFixed(6)} ${s.toFixed(6)} ${(-s).toFixed(6)} ${c.toFixed(6)} ${e.toFixed(3)} ${f.toFixed(3)} cm`);
  }
  for (const { x, y, size, bold, text } of lines) {
    parts.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfEscape(text)}) Tj ET`);
  }
  return parts.join('\n');
}

function buildPdf(lines, degrees) {
  const stream = contentStream(lines, degrees);
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    // A crop, not a full A4: the content sits between y=490 and y=785, and a
    // page of blank paper would cost image tokens while diluting the very
    // thing the low-resolution variant measures.
    '<</Type/Page/Parent 2 0 R/MediaBox[0 480 595 790]/Resources<</Font<</F1 4 0 R/F2 5 0 R>>>>/Contents 6 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>',
    `<</Length ${Buffer.byteLength(stream)}>>\nstream\n${stream}\nendstream`
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/**
 * The invoice, as positioned text. Columns sit at fixed x so they line up.
 *
 * D-012 is deliberately inconsistent: 1 x 95,00 with a printed regeltotaal of
 * 85,00, a discount the arithmetic cannot predict. Without it every figure on
 * the page is derivable from two others, and a model that never read the
 * regeltotaal column would score full marks by multiplying. The row separates
 * reading the pixels from inferring what a sensible invoice would say.
 */
const ROWS = [
  ['A-100', 'eiken tafelblad 180x90', '4', '445,50', '21', '1.782,00'],
  ['A-210', 'stalen onderstel', '4', '189,95', '21', '759,80'],
  ['B-045', 'montageset compleet', '12', '34,25', '21', '411,00'],
  ['C-330', 'houtolie 1 liter', '6', '27,90', '9', '167,40'],
  ['D-012', 'bezorging (na korting)', '1', '95,00', '21', '85,00'],
  ['E-777', 'montage-uren', '8', '62,50', '21', '500,00']
];

const COLS = [60, 115, 300, 350, 425, 470];

function invoiceLines() {
  const lines = [
    { x: 60, y: 760, size: 16, bold: true, text: 'Factuur F-2026-0812' },
    { x: 60, y: 738, size: 10, bold: false, text: 'Meubelmakerij De Vries – Zwolle' },
    { x: 60, y: 724, size: 10, bold: false, text: 'Klant: Bouwbedrijf Jansen B.V.' },
    { x: 60, y: 710, size: 10, bold: false, text: 'Factuurdatum: 12 augustus 2026' }
  ];

  const header = ['code', 'omschrijving', 'aantal', 'stukprijs', 'btw %', 'regeltotaal'];
  header.forEach((text, i) => lines.push({ x: COLS[i], y: 660, size: 9, bold: true, text }));

  ROWS.forEach((row, r) => {
    row.forEach((text, i) => lines.push({ x: COLS[i], y: 640 - r * 20, size: 9, bold: false, text }));
  });

  lines.push({ x: COLS[1], y: 500, size: 9, bold: true, text: 'totaal excl. btw' });
  lines.push({ x: COLS[5], y: 500, size: 9, bold: true, text: '3.705,20' });
  return lines;
}

const VARIANTS = [
  { name: 'invoice-150dpi', dpi: 150, degrees: 0 },
  { name: 'invoice-60dpi', dpi: 60, degrees: 0 },
  { name: 'invoice-rotated', dpi: 150, degrees: 3 },
  { name: 'invoice-rotated-60dpi', dpi: 60, degrees: 3 }
];

for (const variant of VARIANTS) {
  const pdfPath = `${OUT}${variant.name}.pdf`;
  writeFileSync(pdfPath, buildPdf(invoiceLines(), variant.degrees));
  execFileSync('pdftoppm', ['-r', String(variant.dpi), '-png', '-singlefile', pdfPath, `${OUT}${variant.name}`]);
  console.log(`${variant.name}: ${variant.dpi} dpi, ${variant.degrees}°`);
}
