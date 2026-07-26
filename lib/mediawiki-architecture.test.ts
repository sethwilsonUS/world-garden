import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const WORKSPACE_ROOT = process.cwd();
const DOCUMENT_ROOT = path.join(WORKSPACE_ROOT, "lib/mediawiki-document");

const CLIENT_LOCAL_DATA_FILES = [
  "lib/data-context.tsx",
  "lib/local-data-provider.tsx",
  "lib/local-wikipedia-client.ts",
  "lib/wikipedia-contracts.ts",
  "lib/wikipedia-utils.ts",
] as const;

const SEMANTIC_CONTEXT_ENTRYPOINTS = [
  "lib/article-context-extractor.ts",
  "lib/article-context-document.ts",
] as const;

const OBSOLETE_CONTEXT_PARSERS = [
  "article-context-assembly",
  "article-context-html-tables",
  "article-context-maps",
] as const;

const productionTypeScriptFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(absolutePath);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
    if (/\.(?:test|spec)\.tsx?$/.test(entry.name)) return [];
    return [absolutePath];
  });

const sourceFileFor = (absolutePath: string): ts.SourceFile =>
  ts.createSourceFile(
    absolutePath,
    readFileSync(absolutePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    absolutePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

const walk = (node: ts.Node, visit: (node: ts.Node) => void): void => {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
};

/**
 * Regex remains appropriate for scalar cleanup and validation after parse5 has
 * produced nodes. It must not recover HTML structure, table/list nesting, or
 * section boundaries from source text.
 */
const structuralRegexReason = (literal: string): string | null => {
  const lower = literal.toLowerCase();

  if (
    lower.includes("<") ||
    lower.includes(">") ||
    lower.includes("&lt;") ||
    lower.includes("&gt;") ||
    /\\x3[ce]|\\u0*03[ce]/i.test(lower)
  ) {
    return "HTML delimiter";
  }

  if (
    /\b(?:class|id|href|src|rel|typeof|rowspan|colspan|headers|scope|data-mw-section-id)\b/i.test(
      lower,
    ) ||
    /\b(?:infobox|wikitable|navbox|mw-parser-output|mw-heading)\b/i.test(lower)
  ) {
    return "HTML attribute or structural class";
  }

  if (lower.includes("h[1-6]")) return "heading tag name";

  if (
    /\b(?:table|caption|colgroup|thead|tbody|tfoot|tr|th|td|section|article|figure|figcaption|blockquote|ol|ul|li|dl|dt|dd)\b/i.test(
      lower,
    )
  ) {
    return "structural element name";
  }

  if (literal.includes("[\\s\\S]") || literal.includes("[\\S\\s]")) {
    return "cross-node nesting wildcard";
  }

  if (lower.includes("==") || lower.includes("={2")) {
    return "section-heading boundary";
  }

  return null;
};

const isParsedTagNameTest = (node: ts.RegularExpressionLiteral): boolean => {
  const testAccess = node.parent;
  if (
    !ts.isPropertyAccessExpression(testAccess) ||
    testAccess.name.text !== "test"
  ) {
    return false;
  }
  const call = testAccess.parent;
  if (!ts.isCallExpression(call) || call.arguments.length !== 1) return false;
  const [argument] = call.arguments;
  return (
    ts.isPropertyAccessExpression(argument) && argument.name.text === "tagName"
  );
};

type ModuleReference = {
  specifier: string;
  line: number;
};

const moduleReferences = (sourceFile: ts.SourceFile): ModuleReference[] => {
  const references: ModuleReference[] = [];
  const add = (literal: ts.StringLiteralLike) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(
      literal.getStart(sourceFile),
    );
    references.push({ specifier: literal.text, line: line + 1 });
  };

  walk(sourceFile, (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      add(node.moduleSpecifier);
      return;
    }

    if (!ts.isCallExpression(node) || node.arguments.length === 0) return;
    const [firstArgument] = node.arguments;
    if (!ts.isStringLiteralLike(firstArgument)) return;
    if (
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require")
    ) {
      add(firstArgument);
    }
  });

  return references;
};

describe("MediaWiki source architecture boundaries", () => {
  it("recognizes representative structural-regex failure modes", () => {
    expect(
      structuralRegexReason("/<table[^>]*>([\\s\\S]*?)<\\/table>/gi"),
    ).toBe("HTML delimiter");
    expect(
      structuralRegexReason("/data-mw-section-id=[\"'](\\d+)[\"']/i"),
    ).toBe("HTML attribute or structural class");
    expect(structuralRegexReason("/^={2,}\\s*(.*?)\\s*={2,}$/m")).toBe(
      "section-heading boundary",
    );

    // Scalar cleanup and validation remain valid uses of regex.
    expect(structuralRegexReason("/\\s+/g")).toBeNull();
    expect(structuralRegexReason("/^\\d+$/")).toBeNull();

    // The source scan permits this only when `.test` receives a parsed
    // element's `tagName`; applying it to source text is a violation.
    expect(structuralRegexReason("/^h[1-6]$/")).toBe("heading tag name");
  });

  it("keeps HTML structure recovery in parse5 rather than regular expressions", () => {
    const violations: string[] = [];
    let importsParse5 = false;

    for (const absolutePath of productionTypeScriptFiles(DOCUMENT_ROOT)) {
      const sourceFile = sourceFileFor(absolutePath);
      const relativePath = path.relative(WORKSPACE_ROOT, absolutePath);

      importsParse5 ||= moduleReferences(sourceFile).some(
        ({ specifier }) => specifier === "parse5",
      );

      walk(sourceFile, (node) => {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );

        if (ts.isRegularExpressionLiteral(node)) {
          const literal = node.getText(sourceFile);
          const reason = structuralRegexReason(literal);
          const safeParsedTagClassifier =
            reason === "heading tag name" && isParsedTagNameTest(node);
          if (reason && !safeParsedTagClassifier) {
            violations.push(
              `${relativePath}:${line + 1} uses ${reason} regex ${literal}`,
            );
          }
          return;
        }

        const callsRegExp =
          (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "RegExp";
        if (callsRegExp) {
          violations.push(
            `${relativePath}:${line + 1} constructs a dynamic RegExp`,
          );
        }
      });
    }

    expect(importsParse5).toBe(true);
    expect(
      violations,
      "Parse MediaWiki structure through parse5 nodes; regex is limited to scalar normalization and validation.",
    ).toEqual([]);
  });

  it("keeps client local-data modules behind the typed HTTP boundary", () => {
    const forbidden = CLIENT_LOCAL_DATA_FILES.flatMap((relativePath) => {
      const sourceFile = sourceFileFor(path.join(WORKSPACE_ROOT, relativePath));
      return moduleReferences(sourceFile)
        .filter(
          ({ specifier }) =>
            specifier.includes("convex/lib/wikipedia") ||
            specifier.includes("mediawiki-document") ||
            specifier.includes("app/api/local-wikipedia"),
        )
        .map(
          ({ specifier, line }) =>
            `${relativePath}:${line} imports server module ${specifier}`,
        );
    });

    expect(
      forbidden,
      "Client local-data code must call /api/local-wikipedia and must not bundle the server parser.",
    ).toEqual([]);
  });

  it("keeps semantic context entrypoints detached from legacy source parsers", () => {
    const forbidden = SEMANTIC_CONTEXT_ENTRYPOINTS.flatMap((relativePath) => {
      const sourceFile = sourceFileFor(path.join(WORKSPACE_ROOT, relativePath));
      return moduleReferences(sourceFile)
        .filter(({ specifier }) =>
          OBSOLETE_CONTEXT_PARSERS.some((parser) => specifier.includes(parser)),
        )
        .map(
          ({ specifier, line }) =>
            `${relativePath}:${line} imports obsolete parser ${specifier}`,
        );
    });

    expect(
      forbidden,
      "Article context must project the MediaWikiDocument rather than reparsing HTML or wikitext.",
    ).toEqual([]);
  });
});
