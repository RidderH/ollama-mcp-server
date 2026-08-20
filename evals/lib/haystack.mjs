/**
 * Deterministic haystack builder for the prompt-budget probes.
 *
 * A needle-in-a-haystack test is only a retrieval test if the haystack is full
 * of things that look like the answer. Every branch here carries its own
 * dossier code, so finding `QX-7734-B` means matching on the city rather than
 * on the shape of a code.
 *
 * Committed as a generator rather than five large corpora: the seed is fixed,
 * so the bytes are identical on every run, and `haystack.test.mjs` pins that.
 */

let seed = 20260821;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

const PLAATSEN = [
  'Alkmaar','Almelo','Amersfoort','Apeldoorn','Arnhem','Assen','Bergen op Zoom','Breda','Delft','Deventer',
  'Doetinchem','Dordrecht','Ede','Eindhoven','Emmen','Enschede','Gouda','Groningen','Haarlem','Heerlen',
  'Helmond','Hengelo','Hilversum','Hoorn','Leeuwarden','Leiden','Lelystad','Maastricht','Middelburg','Nijmegen',
  'Oss','Purmerend','Roermond','Roosendaal','Rotterdam','Sittard','Sneek','Terneuzen','Tilburg','Utrecht',
  'Veenendaal','Venlo','Vlaardingen','Weert','Zaandam','Zeist','Zoetermeer','Zutphen','Zwijndrecht'
];
const ACTIVITEIT = [
  'de verwerking van retourzendingen','het beheer van de regionale voorraad','de coördinatie van transportplanning',
  'de administratieve afhandeling van inkooporders','het onderhoud van de koelinstallaties',
  'de kwaliteitscontrole op binnenkomende partijen','de facturatie aan zakelijke afnemers',
  'het opleidingsprogramma voor nieuwe medewerkers','de planning van het wagenpark',
  'de archivering van vrachtbrieven'
];
const STATUS = [
  'De vestiging draait sinds de laatste reorganisatie op een aangepast rooster.',
  'Er is dit kwartaal geen aanleiding geweest tot bijstelling van de begroting.',
  'De bezetting is stabiel gebleven ten opzichte van vorig jaar.',
  'Een verbouwing van het laadperron staat gepland maar is nog niet ingeroosterd.',
  'De samenwerking met de regionale vervoerder is ongewijzigd voortgezet.',
  'Klachten over levertijden zijn dit kwartaal niet geregistreerd.'
];

/** A branch paragraph. Every branch carries a code, so the needle is not the
    only thing shaped like an answer -- the model has to match on the city. */
function alinea(plaats, code) {
  return [
    `## Vestiging ${plaats}`,
    '',
    `De vestiging ${plaats} is binnen de regio verantwoordelijk voor ${pick(ACTIVITEIT)} en ` +
      `daarnaast voor ${pick(ACTIVITEIT)}. ${pick(STATUS)} ${pick(STATUS)}`,
    '',
    `Het interne dossiernummer van vestiging ${plaats} is ${code}.`,
    '',
    `In de rapportage over het afgelopen kwartaal is ${pick(ACTIVITEIT)} als aandachtspunt genoemd. ` +
      `${pick(STATUS)} De regiomanager heeft hierover geen aanvullende opmerkingen vastgelegd.`,
    ''
  ].join('\n');
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const code = (i) =>
  `${LETTERS[i % 24]}${LETTERS[(i * 7 + 3) % 24]}-${String(1000 + ((i * 137) % 9000))}-${LETTERS[(i * 5 + 11) % 24]}`;

/** Build a haystack of `count` branches with the needle city at `position`
    (0 = first, 0.5 = middle, 1 = last). */
function build(count, position, needleCity, needleCode) {
  const cities = [];
  for (let i = 0; i < count; i += 1) cities.push(PLAATSEN[i % PLAATSEN.length] + (i >= PLAATSEN.length ? ` ${Math.floor(i / PLAATSEN.length) + 1}` : ''));
  const at = Math.min(count - 1, Math.max(0, Math.round(position * (count - 1))));
  const parts = cities.map((c, i) => alinea(c, code(i)));
  parts[at] = alinea(needleCity, needleCode);
  return parts.join('\n');
}

export const NEEDLE_CITY = 'Zwolle';
export const NEEDLE_CODE = 'QX-7734-B';

/**
 * A haystack of `count` branches with the needle at `position`
 * (0 = first, 0.5 = middle, 1 = last). The seed is reset per call so the
 * corpus depends only on its arguments.
 */
export function buildHaystack(count, position) {
  seed = 20260821;
  return build(count, position, NEEDLE_CITY, NEEDLE_CODE);
}
