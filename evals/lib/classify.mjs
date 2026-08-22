/**
 * Graders for classification against a fixed list.
 *
 * A classification result is the easiest kind of answer to trust wrongly:
 * every row comes back carrying a valid-looking label, and nothing in the
 * shape distinguishes "this is a reiskosten" from "nothing fitted, so I picked
 * the nearest one". These graders keep the distinguishable failures apart —
 * a label outside the vocabulary, a label on the wrong row, a dropped or
 * duplicated row — and count how often the escape category was reached for,
 * because that count is the finding whichever way it goes.
 */

/** Index rows by id, recording any id answered more than once. */
function indexById(rows) {
  const byId = new Map();
  const duplicateIds = [];
  for (const row of rows) {
    const id = row?.id;
    if (byId.has(id)) duplicateIds.push(id);
    else byId.set(id, row);
  }
  return { byId, duplicateIds };
}

/**
 * Grade a set of classified rows against ground truth.
 *
 * Rows are matched by id, never by position, so a probe is free to shuffle the
 * input between repeats — which finding 25 says it must, if three repeats are
 * to be three observations.
 *
 * `escape` names the "none of these" category. It is counted rather than
 * judged: over-use and under-use are different findings and both are visible
 * from the count plus `wrong`.
 */
export function gradeClassification(rows, { allowed, truth, escape = 'overig' } = {}) {
  if (!Array.isArray(rows)) {
    return {
      pass: false,
      notAnArray: true,
      outOfVocabulary: [],
      missingIds: Object.keys(truth ?? {}),
      extraIds: [],
      duplicateIds: [],
      wrong: [],
      correct: 0,
      total: Object.keys(truth ?? {}).length,
      escapeUsed: 0
    };
  }

  const allowedSet = new Set(allowed);
  const { byId, duplicateIds } = indexById(rows);
  const truthIds = Object.keys(truth);

  const outOfVocabulary = rows
    .filter((row) => !allowedSet.has(row?.categorie))
    .map((row) => ({ id: row?.id, categorie: row?.categorie }));

  const missingIds = truthIds.filter((id) => !byId.has(id));
  const extraIds = [...byId.keys()].filter((id) => !(id in truth));

  const wrong = [];
  let correct = 0;
  for (const id of truthIds) {
    const actual = byId.get(id)?.categorie;
    if (actual === truth[id]) correct += 1;
    else if (actual !== undefined) wrong.push({ id, expected: truth[id], actual });
  }

  const escapeUsed = rows.filter((row) => row?.categorie === escape).length;

  return {
    pass:
      outOfVocabulary.length === 0 &&
      missingIds.length === 0 &&
      extraIds.length === 0 &&
      duplicateIds.length === 0 &&
      correct === truthIds.length,
    outOfVocabulary,
    missingIds,
    extraIds,
    duplicateIds,
    wrong,
    correct,
    total: truthIds.length,
    escapeUsed
  };
}

/**
 * Does a confidence field actually separate the rows that have no right answer?
 *
 * This is the gap #5 lever — give the answer a slot for what it cannot say —
 * applied to classification. It only earns its place if it discriminates: a
 * field flagged on nothing discloses nothing, and one flagged on everything is
 * noise a caller would learn to ignore. So both extremes fail, and a row that
 * simply omits the field counts as a non-signal rather than as confidence.
 */
export function gradeDoubtSignal(rows, { hardIds, field = 'zekerheid', lowValue = 'laag' } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const hard = new Set(hardIds);

  const flagged = (row) => row?.[field] === lowValue;
  const hardRows = list.filter((row) => hard.has(row?.id));
  const easyRows = list.filter((row) => !hard.has(row?.id));

  const hardFlagged = hardRows.filter(flagged).length;
  const easyFlagged = easyRows.filter(flagged).length;
  const missingField = list.filter((row) => row?.[field] === undefined).length;

  return {
    pass: hardFlagged === hardIds.length && easyFlagged === 0,
    hardFlagged,
    hardTotal: hardIds.length,
    easyFlagged,
    easyTotal: easyRows.length,
    missingField,
    separates: hardFlagged > 0 && easyFlagged === 0
  };
}
