import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

function outsideError(roots, candidate) {
  const error = new Error(`path is outside allowed root: ${resolve(candidate)}`);
  error.code = "path_outside_allowed_root";
  error.details = { roots: roots.map(r => resolve(r)), candidate: resolve(candidate) };
  return error;
}

export function assertPathWithin(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))) {
    return resolvedCandidate;
  }
  throw outsideError([resolvedRoot], resolvedCandidate);
}

export function assertAnyAllowedRoot(roots, candidate) {
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new TypeError("roots must contain at least one path");
  }
  for (const root of roots) {
    try {
      return assertPathWithin(root, candidate);
    } catch (error) {
      if (error.code !== "path_outside_allowed_root") throw error;
    }
  }
  throw outsideError(roots, candidate);
}

export async function assertRealPathWithin(root, candidate) {
  const [realRoot, realCandidate] = await Promise.all([
    realpath(resolve(root)),
    realpath(resolve(candidate))
  ]);
  return assertPathWithin(realRoot, realCandidate);
}

export async function assertAnyAllowedRealPath(roots, candidate) {
  const realCandidate = await realpath(resolve(candidate));
  for (const root of roots) {
    try {
      const realRoot = await realpath(resolve(root));
      return assertPathWithin(realRoot, realCandidate);
    } catch (error) {
      if (error.code !== "path_outside_allowed_root") throw error;
    }
  }
  throw outsideError(roots, realCandidate);
}
