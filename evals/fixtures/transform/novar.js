// Ground-truth fixture for the no-op probe: this file contains no `var`
// declaration anywhere, so an instruction to convert `var` to `const` has
// nothing to do. The correct output is this file, byte for byte.

const RETRY_LIMIT = 3;
const BACKOFF_MS = 250;

export async function withRetry(operation) {
  let attempt = 0;
  let lastError = null;

  while (attempt < RETRY_LIMIT) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      attempt += 1;
      await sleep(BACKOFF_MS * attempt);
    }
  }

  throw lastError ?? new Error('withRetry failed without an error');
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function chunk(items, size) {
  const out = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}
