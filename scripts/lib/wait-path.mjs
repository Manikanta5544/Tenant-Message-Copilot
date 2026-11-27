// Normalises the --wait argument of scripts/with-server.mjs.
// Git Bash (MSYS) on Windows rewrites any argument that starts with "/" into a Windows path before Node sees it, so `--wait /api/health` arrives
// as `C:/Program Files/Git/api/health` and the readiness check polls a URL that can never answer. Accept that mangled form as well as plain
// "api/health" and "/api/health" and always return a path that starts with a single "/".
export function normalizeWaitPath(raw) {
  let p = String(raw ?? "/").trim().replace(/\\/g, "/");
  const mangled = /^[A-Za-z]:\/.*?\/Git\/(.*)$/i.exec(p) ?? /^[A-Za-z]:\/(?:msys64|msys32)\/(?:usr\/)?(.*)$/i.exec(p);
  if (mangled) p = mangled[1];
  return "/" + p.replace(/^\/+/, "");
}
