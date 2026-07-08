export function makeId(prefix) {
  return prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}
