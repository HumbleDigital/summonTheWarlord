export function buildPerformSwapOptions(cfg = {}) {
  const mode = String(cfg.executionMode ?? "fast").toLowerCase();
  const skipPreflight = mode !== "basic";
  const performOpts = {
    debug: Boolean(cfg.DEBUG_MODE),
    sendOptions: { skipPreflight },
    skipConfirmationCheck: true,
  };
  if (cfg.jito?.enabled) {
    performOpts.jito = { enabled: true, tip: cfg.jito.tip };
  }
  return performOpts;
}
