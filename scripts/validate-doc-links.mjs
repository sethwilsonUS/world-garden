import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import GithubSlugger from "github-slugger";

const root = process.cwd();
const excludedDirectories = new Set([
  ".clerk",
  ".edge-tts-venv",
  ".git",
  ".next",
  ".reports",
  ".specstory",
  ".vercel",
  ".venv",
  "coverage",
  "node_modules",
  "playwright-report",
  "test-results",
]);

const collectMarkdownFiles = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(absolutePath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(absolutePath);
    }
  }
  return files;
};

const withoutFencedCode = (source) => {
  let insideFence = false;
  let fenceMarker = null;
  return source
    .split("\n")
    .map((line) => {
      const match = line.match(/^\s*(`{3,}|~{3,})/);
      if (match) {
        const marker = match[1][0];
        if (!insideFence) {
          insideFence = true;
          fenceMarker = marker;
        } else if (marker === fenceMarker) {
          insideFence = false;
          fenceMarker = null;
        }
        return "";
      }
      return insideFence ? "" : line;
    })
    .join("\n");
};

const headingAnchors = (source) => {
  const anchors = new Set();
  const slugger = new GithubSlugger();
  for (const line of withoutFencedCode(source).split("\n")) {
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    anchors.add(slugger.slug(match[1]));
  }
  return anchors;
};

const extractTargets = (source) => {
  const stripped = withoutFencedCode(source);
  const targets = [];
  const inlineLink = /!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\)/g;
  const referenceLink = /^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm;
  const htmlLink = /\b(?:href|src)=["']([^"']+)["']/gi;
  for (const expression of [inlineLink, referenceLink, htmlLink]) {
    for (const match of stripped.matchAll(expression)) {
      targets.push(match[1].replace(/^<|>$/g, ""));
    }
  }
  return targets;
};

const isExternalTarget = (target) =>
  /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target);

const errors = [];
let checkedLinks = 0;
const markdownFiles = await collectMarkdownFiles(root);
const sourceCache = new Map();

for (const markdownFile of markdownFiles) {
  const source = await readFile(markdownFile, "utf8");
  sourceCache.set(markdownFile, source);
  for (const rawTarget of extractTargets(source)) {
    if (!rawTarget || isExternalTarget(rawTarget)) continue;
    checkedLinks += 1;
    const [rawPathname, rawAnchor] = rawTarget.split("#", 2);
    const pathname = decodeURIComponent(rawPathname.split("?", 1)[0]);
    const targetPath = pathname
      ? path.resolve(pathname.startsWith("/") ? root : path.dirname(markdownFile), pathname.replace(/^\//, ""))
      : markdownFile;

    let targetStats;
    try {
      targetStats = await stat(targetPath);
    } catch {
      errors.push(`${path.relative(root, markdownFile)}: missing target ${rawTarget}`);
      continue;
    }

    if (!rawAnchor) continue;
    if (!targetStats.isFile() || path.extname(targetPath).toLowerCase() !== ".md") {
      errors.push(`${path.relative(root, markdownFile)}: anchor on non-Markdown target ${rawTarget}`);
      continue;
    }
    const targetSource =
      sourceCache.get(targetPath) ?? (await readFile(targetPath, "utf8"));
    sourceCache.set(targetPath, targetSource);
    const decodedAnchor = decodeURIComponent(rawAnchor).toLowerCase();
    if (!headingAnchors(targetSource).has(decodedAnchor)) {
      errors.push(`${path.relative(root, markdownFile)}: missing anchor #${rawAnchor} in ${path.relative(root, targetPath)}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${checkedLinks} local Markdown links across ${markdownFiles.length} documentation files.`,
  );
}
