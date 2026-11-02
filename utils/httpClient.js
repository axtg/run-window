// Largest upstream responses seen are about 60 KB, so this only stops runaway bodies.
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

// GET with a deadline covering the whole request, including the body. Errors never include the URL,
// because ENTSOE takes its token as a query parameter. Redirects are refused for the same reason.
async function fetchText(url, { timeoutMs, maxBytes = DEFAULT_MAX_BYTES }) {
  const signal = AbortSignal.timeout(timeoutMs);
  const chunks = [];
  let size = 0;
  let status;

  try {
    const response = await fetch(url, { signal, redirect: 'error' });
    status = response.status;

    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) break;
      chunks.push(chunk);
    }
  } catch (error) {
    if (signal.aborted) throw new Error(`Request timed out after ${timeoutMs}ms`);
    if (error.cause?.message === 'unexpected redirect') throw new Error('Request failed: unexpected redirect');
    throw new Error(`Request failed: ${error.cause?.code || 'connection error'}`);
  }

  if (size > maxBytes) throw new Error(`Response larger than ${maxBytes} bytes`);
  return { status, body: Buffer.concat(chunks).toString('utf8') };
}

module.exports = { fetchText };
