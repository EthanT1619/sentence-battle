import {
  CONTENT_BASE,
  resolveContentUrl,
  validateManifest,
  validateLesson,
} from "./content/logic.mjs";

const manifestCache = { data: null, promise: null };
const lessonCache = new Map();

export function getContentBase() {
  return CONTENT_BASE;
}

export async function fetchManifest(options = {}) {
  const base = options.base ?? CONTENT_BASE;
  if (manifestCache.data && options.base === undefined) {
    return manifestCache.data;
  }

  if (!manifestCache.promise || options.base !== undefined) {
    const url = resolveContentUrl("manifest.json", base);
    manifestCache.promise = (async () => {
      const res = await fetch(url);
      if (!res.ok) {
        console.error("[curriculum] manifest fetch failed", res.status, url);
        throw new Error("manifest_fetch_failed");
      }
      const json = await res.json();
      const validated = validateManifest(json);
      if (!validated.ok) {
        console.error("[curriculum] manifest validation", validated.errors);
        throw new Error("manifest_invalid");
      }
      manifestCache.data = validated;
      return validated;
    })();
  }

  try {
    return await manifestCache.promise;
  } finally {
    if (options.base !== undefined) manifestCache.promise = null;
  }
}

export async function fetchLesson(relativeFile, options = {}) {
  const base = options.base ?? CONTENT_BASE;
  const cacheKey = `${base}|${relativeFile}`;
  if (lessonCache.has(cacheKey)) {
    return lessonCache.get(cacheKey);
  }

  const url = resolveContentUrl(relativeFile, base);
  const res = await fetch(url);
  if (!res.ok) {
    console.error("[curriculum] lesson fetch failed", res.status, url);
    throw new Error("lesson_fetch_failed");
  }
  const json = await res.json();
  const validated = validateLesson(json);
  if (!validated.ok) {
    console.error("[curriculum] lesson validation", validated.errors);
    throw new Error("lesson_invalid");
  }
  lessonCache.set(cacheKey, validated);
  return validated;
}

export function clearCurriculumCache() {
  manifestCache.data = null;
  manifestCache.promise = null;
  lessonCache.clear();
}
