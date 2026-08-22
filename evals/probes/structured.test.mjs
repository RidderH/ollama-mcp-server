/**
 * Guard for the composite pass rule in the structured-output probe.
 *
 * `gradeStructured` is where three independent verdicts get collapsed into one
 * boolean, which is exactly the place a grader goes quietly wrong: a rule that
 * forgot one of the three would report a fabricated value as a pass. So each
 * of the three failure modes is fed in on its own and must sink the verdict by
 * itself, and the answer that is right in every way must pass.
 *
 * Run: node --test evals/probes/structured.test.mjs
 */

import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { gradeStructured, STRUCTURED_TASKS } from './structured.mjs';

const byId = (id) => STRUCTURED_TASKS.find((task) => task.id === id);

const PERFECT_S1 = '{"peildatum": "2026-08-31", "aantalFacturen": 4, "totaalBedrag": 4901.45}';

describe('gradeStructured', () => {
  test('a perfect answer passes on all three axes', () => {
    const result = gradeStructured(PERFECT_S1, byId('S1-flat'));
    assert.equal(result.pass, true, JSON.stringify(result.detail));
    assert.equal(result.detail.parseLevel, 'raw');
    assert.equal(result.detail.fenced, false);
  });

  test('KNOWN BAD: not JSON at all fails, and says so', () => {
    const result = gradeStructured('Peildatum is 31 augustus 2026, 4 facturen, totaal € 4.901,45.', byId('S1-flat'));
    assert.equal(result.pass, false);
    assert.equal(result.detail.isJson, false);
    assert.equal(result.detail.parseLevel, 'none');
  });

  test('KNOWN BAD: right values in the wrong shape fails on schema alone', () => {
    const result = gradeStructured(
      '{"peildatum": "2026-08-31", "aantalFacturen": 4, "totaalBedrag": 4901.45, "opmerking": "alles verwerkt"}',
      byId('S1-flat')
    );
    assert.equal(result.pass, false);
    assert.equal(result.detail.isJson, true);
    assert.equal(result.detail.schemaValid, false);
    assert.equal(result.detail.contentCorrect, true, 'the content axis must stay clean — the values are right');
  });

  test('KNOWN BAD: right shape with a wrong total fails on content alone', () => {
    const result = gradeStructured(
      '{"peildatum": "2026-08-31", "aantalFacturen": 4, "totaalBedrag": 4446.25}',
      byId('S1-flat')
    );
    assert.equal(result.pass, false);
    assert.equal(result.detail.schemaValid, true);
    assert.equal(result.detail.contentCorrect, false);
    assert.equal(result.detail.mismatches[0].path, 'totaalBedrag');
  });

  test('a fenced answer still passes, but the parse level records the work it cost', () => {
    const result = gradeStructured(`\`\`\`json\n${PERFECT_S1}\n\`\`\``, byId('S1-flat'));
    assert.equal(result.pass, true);
    assert.equal(result.detail.parseLevel, 'stripped');
    assert.equal(result.detail.fenced, true);
  });

  test('KNOWN BAD: an invented category is caught by the enum', () => {
    const answer = JSON.stringify({
      facturen: [
        { nummer: 'F-2026-101', status: 'betaald' },
        { nummer: 'F-2026-102', status: 'open' },
        { nummer: 'F-2026-103', status: 'vervallen' },
        { nummer: 'F-2026-104', status: 'deels betaald' }
      ]
    });
    const result = gradeStructured(answer, byId('S3-enum'));
    assert.equal(result.pass, false);
    assert.equal(result.detail.schemaValid, false);
    assert.ok(result.detail.schemaErrors.some((e) => /enum/.test(e)), result.detail.schemaErrors.join('; '));
  });

  test('KNOWN BAD: an invented date where null belongs validates but is wrong', () => {
    const answer = JSON.stringify({
      facturen: [
        { nummer: 'F-2026-101', betaaldatum: '2026-08-12', kredietlimiet: null },
        { nummer: 'F-2026-102', betaaldatum: '2026-08-31', kredietlimiet: null },
        { nummer: 'F-2026-103', betaaldatum: null, kredietlimiet: null },
        { nummer: 'F-2026-104', betaaldatum: '2026-08-28', kredietlimiet: 5000 }
      ]
    });
    const result = gradeStructured(answer, byId('S4-nullable'));
    assert.equal(result.pass, false);
    assert.equal(result.detail.schemaValid, true, 'a fabricated value is invisible to a validator — that is the point');
    assert.equal(result.detail.contentCorrect, false);
    assert.ok(result.detail.mismatches.some((m) => m.path === 'facturen[1].betaaldatum'));
    assert.ok(result.detail.mismatches.some((m) => m.path === 'facturen[3].kredietlimiet'));
  });

  test('KNOWN BAD: a dropped row fails even though every row present is right', () => {
    const answer = JSON.stringify({
      leverancier: 'Meubelmakerij De Vries',
      peildatum: '2026-08-31',
      totaalBedrag: 4901.45,
      facturen: [
        { nummer: 'F-2026-101', klant: 'Bouwbedrijf Jansen', bedrag: 1245.5 },
        { nummer: 'F-2026-102', klant: 'Interieur Zeeland', bedrag: 890 },
        { nummer: 'F-2026-103', klant: 'Horeca Groep Zuid', bedrag: 2310.75 }
      ]
    });
    const result = gradeStructured(answer, byId('S2-nested'));
    assert.equal(result.pass, false);
    assert.equal(result.detail.schemaValid, true, 'a short array is a valid array — no validator catches this');
    assert.ok(result.detail.mismatches.some((m) => m.path === 'facturen.length'));
  });
});
