/**
 * Screening and running model-authored commands.
 *
 * The planner probes test a claim that can only be tested by execution: that
 * the model can write the `awk`/`jq`/SQL that answers a question it never sees
 * the data for. Grading the text of a command would be grading plausibility.
 * Running it against a fixture with a known answer grades the claim.
 *
 * That means executing text a model wrote, so it runs under three limits: a
 * name-based screen in front, a throwaway directory holding nothing but copies
 * of the fixtures, and a hard timeout. The screen matches command *words*, not
 * substrings, because a real answer is full of characters a naive filter would
 * trip on — `>` as comparison, `;` between awk statements, pipes into sort.
 */

import { exec } from 'node:child_process';

/**
 * Command names with no legitimate place in an answer to "sum this column".
 *
 * Deliberately short: every entry here is a name a correct one-liner would
 * never contain, which is what makes the screen safe to apply as a hard gate
 * rather than a warning.
 */
const DENIED = [
  'rm', 'rmdir', 'mv', 'dd', 'mkfs', 'shutdown', 'reboot', 'kill', 'killall',
  'curl', 'wget', 'nc', 'ncat', 'ssh', 'scp', 'nohup',
  'sudo', 'su', 'chmod', 'chown', 'chgrp', 'launchctl', 'crontab',
  'git', 'npm', 'npx', 'pip', 'pip3', 'brew', 'open', 'osascript', 'eval'
];

/** Would this command be safe to run against a throwaway copy of the fixtures? */
export function screenCommand(command) {
  for (const name of DENIED) {
    // Word boundaries only: `printf` must not read as `rm`, `confirmed` must
    // not read as `rm`, and `format` must not read as `mv`.
    if (new RegExp(`(^|[\\s;&|(\`$])${name}(\\s|$)`).test(command)) {
      return { allowed: false, reason: name };
    }
  }
  return { allowed: true };
}

/** Exact comparison, forgiving only trailing whitespace and a final newline. */
export function compareOutput(stdout, expected) {
  const normalise = (text) =>
    String(text)
      .split('\n')
      .map((line) => line.replace(/\s+$/, ''))
      .join('\n')
      .replace(/\n+$/, '');

  const got = normalise(stdout);
  return { pass: got === normalise(expected), got, empty: got === '' };
}

/**
 * Run one screened command, returning its result rather than throwing.
 *
 * A command that fails, hangs or is refused is a probe outcome to be recorded,
 * not an error to abort the run: "the model wrote something that does not run"
 * is exactly the finding this probe exists to catch.
 */
export function runCommand(command, { cwd, timeoutMs = 20_000 } = {}) {
  const screen = screenCommand(command);
  if (!screen.allowed) {
    return Promise.resolve({
      ran: false,
      refused: true,
      refusedFor: screen.reason,
      stdout: '',
      stderr: '',
      timedOut: false
    });
  }

  return new Promise((resolve) => {
    exec(command, { cwd, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4_000_000 }, (error, stdout, stderr) => {
      const timedOut = error !== null && error.killed === true;
      resolve({
        ran: true,
        refused: false,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        exitCode: error === null ? 0 : (error.code ?? null),
        timedOut
      });
    });
  });
}
