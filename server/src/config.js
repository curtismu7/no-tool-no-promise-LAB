// The MODE switch (rule 18). Same code, same image, two modes:
//   local   (default, MODE unset or empty): the standalone demo. Single process-wide state, unchanged behaviour.
//   se-mock (the hosted mock build on the SE cluster): mock only. Each browser session gets its own workspace
//           (X-Workspace-Id), and any live flag is REFUSED at startup and by the doctor. Nothing live is compiled in.
// An unknown MODE is an error, never a silent fallback.

export const MODES = Object.freeze(['local', 'se-mock']);

// Environment names that would switch on a live (tenant, network or model) path. This app has no such code; the names
// are refused in se-mock so that a hosted build given one by mistake stops loudly instead of starting.
export const LIVE_FLAGS = Object.freeze(['NTNP_LIVE', 'NTNP_LLM_URL', 'NTNP_TENANT', 'NTNP_CREDENTIALS']);

const isSet = (env, name) => env[name] !== undefined && env[name] !== '';

// 'local' | 'se-mock' | null (null = MODE is not a known value)
export function modeOf(env = process.env) {
  const m = env.MODE === undefined || env.MODE === '' ? 'local' : env.MODE;
  return MODES.includes(m) ? m : null;
}

// Throws when MODE is unknown, or when a live flag is set in se-mock. Returns the mode.
export function assertModeAllowed(env = process.env) {
  const mode = modeOf(env);
  if (mode === null) throw new Error('MODE must be "local" (the default) or "se-mock"');
  if (mode === 'se-mock') {
    const set = LIVE_FLAGS.filter((f) => isSet(env, f));
    if (set.length) throw new Error(`refusing to start in se-mock: live flag(s) set (${set.join(', ')}). The hosted build is mock only.`);
  }
  return mode;
}
