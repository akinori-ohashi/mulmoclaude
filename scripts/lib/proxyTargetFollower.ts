// Keeping the dev proxy pointed at the backend AFTER Vite has started (#2995).
//
// `vite.config.ts` is evaluated once, so #2981's following was a single reading
// taken at startup. That is enough whenever the readiness wait saw the backend
// publish first — but the wait has a budget, and past it Vite starts against the
// port that was merely REQUESTED. A backend that publishes a moment later, on a
// walked-to or OS-assigned port, then has a proxy aimed somewhere it is not.
//
// The proxy can be re-aimed. Vite 8's bundled http-proxy builds each request's
// options by spreading the SAME object it stored as `proxy.options`:
//
//     this.options = options;
//     this.web = this.createRightProxy("web")(options);
//     ...
//     requestOptions = { ...options, ...args[counter] };   // per request
//
// and Vite calls `proxy.web(req, res, {})` with no per-request target, so the
// stored object is the only source. Writing `proxy.options.target` therefore
// takes effect from the next request. That is a property worth pinning, which
// `test/config/test_proxyTargetFollower.ts` does against the real Vite proxy.
//
// Everything time- and filesystem-shaped is injected, so the rule below is
// testable without either.

export interface ProxyTargetFollowerOptions {
  /** The port the proxy currently addresses. */
  initialPort: number;
  /** Raw `.server-port` contents, or null when it cannot be read. */
  readPublished: () => string | null;
  /** Parse raw contents to a usable port, or null. Injected so this shares the
   *  one rule the rest of the dev tooling uses rather than inventing a second. */
  parsePort: (raw: string | null) => number | null;
  /** Called when the target should move. Never called with the current port. */
  onSwitch: (port: number) => void;
}

export interface ProxyTargetFollower {
  /** One poll. Production drives this from a timer; tests call it directly. */
  poll: () => void;
  /** The port the follower believes the proxy is addressing. */
  currentPort: () => number;
}

/**
 * Switch only on a readable port that differs from the current one.
 *
 * The negative cases matter more than the positive one. A missing file, an
 * unparseable one, or one naming the port already in use must all leave the
 * proxy alone: `.server-port` is removed and rewritten across runs, and aiming
 * at whatever a half-state seems to say is how a dev client ends up talking to
 * something that is not its backend — the failure this whole line of work
 * exists to prevent.
 */
export function createProxyTargetFollower(options: ProxyTargetFollowerOptions): ProxyTargetFollower {
  const { initialPort, readPublished, parsePort, onSwitch } = options;
  let current = initialPort;

  return {
    poll: () => {
      const published = parsePort(readPublished());
      if (published === null || published === current) return;
      current = published;
      onSwitch(published);
    },
    currentPort: () => current,
  };
}
