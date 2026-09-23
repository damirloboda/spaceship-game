// Release builds set RELEASE = true, which removes developer tools entirely.
// In development builds the tools are available with ?dev=1 in the URL.
export const VERSION = '0.1.0-slice';
export const RELEASE = false;

function queryFlag(name) {
  try {
    return new URLSearchParams(globalThis.location?.search || '').has(name);
  } catch {
    return false;
  }
}

export const DEV = !RELEASE && queryFlag('dev');
