/** Tiny leveled logger. `verbose` gates info/debug; warn/error always print. */
export function createLogger({ verbose = false } = {}) {
  const stamp = () => new Date().toISOString();
  return {
    info: (...a) => verbose && console.log(`[${stamp()}] INFO`, ...a),
    debug: (...a) => verbose && console.log(`[${stamp()}] DEBUG`, ...a),
    warn: (...a) => console.warn(`[${stamp()}] WARN`, ...a),
    error: (...a) => console.error(`[${stamp()}] ERROR`, ...a),
  };
}
