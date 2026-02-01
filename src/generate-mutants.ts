#!/usr/bin/env node
import { Project, SyntaxKind, Node, SourceFile } from "ts-morph";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

export interface MutantInfo {
  id: string;
  fileName: string;
  mutatorName: string;
  original: string;
  replacement: string;
  location: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  context: string;
  description: string;
  expressionText?: string;
}

interface GenerateMutantsOptions {
  files?: string[];
  fromGitDiff?: boolean;
  baseBranch?: string;
}

// Mutation operators
const BINARY_OPERATOR_MUTATIONS: Record<string, string[]> = {
  "+": ["-"],
  "-": ["+"],
  "*": ["/"],
  "/": ["*"],
  "%": ["*"],
  "===": ["!=="],
  "!==": ["==="],
  "==": ["!="],
  "!=": ["=="],
  ">": [">=", "<", "<="],
  "<": ["<=", ">", ">="],
  ">=": [">", "<", "<="],
  "<=": ["<", ">", ">="],
  "&&": ["||"],
  "||": ["&&"],
};

const UNARY_OPERATOR_MUTATIONS: Record<number, { original: string; replacements: string[] }> = {
  [SyntaxKind.ExclamationToken]: { original: "!", replacements: [""] },
  [SyntaxKind.MinusToken]: { original: "-", replacements: [""] },
  [SyntaxKind.PlusToken]: { original: "+", replacements: ["-"] },
  [SyntaxKind.PlusPlusToken]: { original: "++", replacements: ["--"] },
  [SyntaxKind.MinusMinusToken]: { original: "--", replacements: ["++"] },
};

function getChangedFiles(baseBranch: string = "main"): string[] {
  try {
    const diff = execSync(`git diff --name-only ${baseBranch}...HEAD 2>/dev/null || git diff --name-only HEAD`, {
      encoding: "utf-8",
    });
    return diff
      .split("\n")
      .filter((f) => /\.(ts|tsx|js|jsx)$/.test(f))
      .filter((f) => !f.includes(".test.") && !f.includes(".spec."))
      .filter((f) => fs.existsSync(f));
  } catch {
    try {
      const diff = execSync("git diff --name-only", { encoding: "utf-8" });
      return diff
        .split("\n")
        .filter((f) => /\.(ts|tsx|js|jsx)$/.test(f))
        .filter((f) => !f.includes(".test.") && !f.includes(".spec."))
        .filter((f) => fs.existsSync(f));
    } catch {
      return [];
    }
  }
}

function getContext(sourceFile: SourceFile, node: Node, lines: number = 2): string {
  const startLine = Math.max(1, node.getStartLineNumber() - lines);
  const endLine = Math.min(sourceFile.getEndLineNumber(), node.getEndLineNumber() + lines);
  const text = sourceFile.getFullText();
  const allLines = text.split("\n");
  return allLines.slice(startLine - 1, endLine).join("\n");
}

function describeMutation(mutatorName: string, original: string, replacement: string): string {
  const descriptions: Record<string, string> = {
    BinaryOperator: `Change operator "${original}" to "${replacement}"`,
    UnaryOperator: replacement ? `Change unary "${original}" to "${replacement}"` : `Remove unary operator "${original}"`,
    BooleanLiteral: `Flip boolean from ${original} to ${replacement}`,
    ConditionalRemoval: `Remove conditional - always take ${replacement} branch`,
    BoundaryCondition: `Change boundary: "${original}" to "${replacement}"`,
  };
  return descriptions[mutatorName] || `${mutatorName}: "${original}" → "${replacement}"`;
}

function collectBinaryMutations(sourceFile: SourceFile, fileName: string): MutantInfo[] {
  const mutants: MutantInfo[] = [];
  let id = 0;

  sourceFile.forEachDescendant((node) => {
    if (Node.isBinaryExpression(node)) {
      const operator = node.getOperatorToken().getText();
      const mutations = BINARY_OPERATOR_MUTATIONS[operator];

      if (mutations) {
        for (const replacement of mutations) {
          const opToken = node.getOperatorToken();
          const startPos = opToken.getStart();
          const endPos = opToken.getEnd();
          const isBoundary = [">", "<", ">=", "<="].includes(operator);

          mutants.push({
            id: `${path.basename(fileName)}-${++id}`,
            fileName,
            mutatorName: isBoundary ? "BoundaryCondition" : "BinaryOperator",
            original: operator,
            replacement,
            location: {
              start: sourceFile.getLineAndColumnAtPos(startPos),
              end: sourceFile.getLineAndColumnAtPos(endPos),
            },
            context: getContext(sourceFile, node),
            description: describeMutation(isBoundary ? "BoundaryCondition" : "BinaryOperator", operator, replacement),
            expressionText: node.getText(),
          });
        }
      }
    }
  });

  return mutants;
}

function collectUnaryMutations(sourceFile: SourceFile, fileName: string, startId: number): MutantInfo[] {
  const mutants: MutantInfo[] = [];
  let id = startId;

  sourceFile.forEachDescendant((node) => {
    if (Node.isPrefixUnaryExpression(node)) {
      const operator = node.getOperatorToken();
      const mutation = UNARY_OPERATOR_MUTATIONS[operator];

      if (mutation) {
        for (const replacement of mutation.replacements) {
          const startPos = node.getStart();

          mutants.push({
            id: `${path.basename(fileName)}-${++id}`,
            fileName,
            mutatorName: "UnaryOperator",
            original: mutation.original,
            replacement: replacement || "(removed)",
            location: {
              start: sourceFile.getLineAndColumnAtPos(startPos),
              end: sourceFile.getLineAndColumnAtPos(startPos + mutation.original.length),
            },
            context: getContext(sourceFile, node),
            description: describeMutation("UnaryOperator", mutation.original, replacement),
            expressionText: node.getText(),
          });
        }
      }
    }
  });

  return mutants;
}

function collectBooleanMutations(sourceFile: SourceFile, fileName: string, startId: number): MutantInfo[] {
  const mutants: MutantInfo[] = [];
  let id = startId;

  sourceFile.forEachDescendant((node) => {
    if (Node.isTrueLiteral(node) || Node.isFalseLiteral(node)) {
      const original = node.getText();
      const replacement = original === "true" ? "false" : "true";
      const startPos = node.getStart();
      const endPos = node.getEnd();

      mutants.push({
        id: `${path.basename(fileName)}-${++id}`,
        fileName,
        mutatorName: "BooleanLiteral",
        original,
        replacement,
        location: {
          start: sourceFile.getLineAndColumnAtPos(startPos),
          end: sourceFile.getLineAndColumnAtPos(endPos),
        },
        context: getContext(sourceFile, node),
        description: describeMutation("BooleanLiteral", original, replacement),
        expressionText: node.getText(),
      });
    }
  });

  return mutants;
}

function collectConditionalMutations(sourceFile: SourceFile, fileName: string, startId: number): MutantInfo[] {
  const mutants: MutantInfo[] = [];
  let id = startId;

  sourceFile.forEachDescendant((node) => {
    if (Node.isIfStatement(node)) {
      const condition = node.getExpression();
      const startPos = condition.getStart();
      const endPos = condition.getEnd();

      mutants.push({
        id: `${path.basename(fileName)}-${++id}`,
        fileName,
        mutatorName: "ConditionalRemoval",
        original: condition.getText(),
        replacement: "true (always if-branch)",
        location: {
          start: sourceFile.getLineAndColumnAtPos(startPos),
          end: sourceFile.getLineAndColumnAtPos(endPos),
        },
        context: getContext(sourceFile, node, 3),
        description: describeMutation("ConditionalRemoval", condition.getText(), "if-branch"),
        expressionText: condition.getText(),
      });

      mutants.push({
        id: `${path.basename(fileName)}-${++id}`,
        fileName,
        mutatorName: "ConditionalRemoval",
        original: condition.getText(),
        replacement: "false (always else-branch)",
        location: {
          start: sourceFile.getLineAndColumnAtPos(startPos),
          end: sourceFile.getLineAndColumnAtPos(endPos),
        },
        context: getContext(sourceFile, node, 3),
        description: describeMutation("ConditionalRemoval", condition.getText(), "else-branch"),
        expressionText: condition.getText(),
      });
    }
  });

  return mutants;
}

export async function generateMutants(options: GenerateMutantsOptions): Promise<MutantInfo[]> {
  let filePaths: string[] = [];

  if (options.files && options.files.length > 0) {
    filePaths = options.files.filter((f) => fs.existsSync(f));
  } else if (options.fromGitDiff) {
    filePaths = getChangedFiles(options.baseBranch);
  }

  if (filePaths.length === 0) {
    return [];
  }

  console.error(`Processing ${filePaths.length} files:`, filePaths);

  const project = new Project({
    compilerOptions: { allowJs: true, checkJs: false },
  });

  const allMutants: MutantInfo[] = [];

  for (const filePath of filePaths) {
    const absolutePath = path.resolve(filePath);
    const sourceFile = project.addSourceFileAtPath(absolutePath);
    const relativeFileName = path.relative(process.cwd(), absolutePath);

    let currentId = 0;

    const binaryMutants = collectBinaryMutations(sourceFile, relativeFileName);
    currentId += binaryMutants.length;
    allMutants.push(...binaryMutants);

    const unaryMutants = collectUnaryMutations(sourceFile, relativeFileName, currentId);
    currentId += unaryMutants.length;
    allMutants.push(...unaryMutants);

    const booleanMutants = collectBooleanMutations(sourceFile, relativeFileName, currentId);
    currentId += booleanMutants.length;
    allMutants.push(...booleanMutants);

    const conditionalMutants = collectConditionalMutations(sourceFile, relativeFileName, currentId);
    allMutants.push(...conditionalMutants);
  }

  return allMutants;
}

export function formatMutantsForTestGeneration(mutants: MutantInfo[]): string {
  const groupedByFile = new Map<string, MutantInfo[]>();

  for (const mutant of mutants) {
    const existing = groupedByFile.get(mutant.fileName) || [];
    existing.push(mutant);
    groupedByFile.set(mutant.fileName, existing);
  }

  let output = `# Mutation-Guided Test Generation

Each mutation below represents a **potential bug**. Write tests that would **FAIL if the mutation were applied**.

## Why This Works
- Mutations simulate real bug patterns (wrong operators, off-by-one errors, flipped conditions)
- A test that catches a mutation will catch the real bug it represents
- If your test passes with the mutation, your test is too weak

---

`;

  for (const [fileName, fileMutants] of groupedByFile) {
    output += `## File: ${fileName}\n\n`;

    const byType = new Map<string, MutantInfo[]>();
    for (const m of fileMutants) {
      const existing = byType.get(m.mutatorName) || [];
      existing.push(m);
      byType.set(m.mutatorName, existing);
    }

    for (const [mutationType, mutations] of byType) {
      output += `### ${mutationType} Mutations (${mutations.length})\n\n`;

      for (const mutant of mutations) {
        output += `**${mutant.id}**: ${mutant.description}\n`;
        output += `- Location: Line ${mutant.location.start.line}\n`;
        output += `- Original: \`${mutant.original}\`\n`;
        output += `- Mutated to: \`${mutant.replacement}\`\n`;
        output += `- Context:\n\`\`\`typescript\n${mutant.context}\n\`\`\`\n`;
        output += `- **Test requirement**: Write a test that fails if \`${mutant.original}\` becomes \`${mutant.replacement}\`\n\n`;
      }
    }
  }

  output += `---

## Test Writing Guidelines

For each mutation:
1. **Identify the bug**: What error does this mutation represent?
2. **Find the edge case**: What input would expose the difference?
3. **Write the assertion**: What observable behavior changes?

**Do NOT**:
- Write tests that just check it doesn't throw
- Use mocks that return exactly what you assert against
- Write \`assertNotNull\` without meaningful follow-up
- Mirror the implementation logic (tautological tests)

**DO**:
- Test boundary conditions (exact values where behavior changes)
- Test both sides of conditionals
- Verify specific output values
`;

  return output;
}

export interface MutantGroup {
  signature: string;
  mutatorName: string;
  original: string;
  replacement: string;
  description: string;
  expressionText: string;
  instances: MutantInfo[];
}

export function groupMutantsBySignature(mutants: MutantInfo[]): MutantGroup[] {
  const groups = new Map<string, MutantGroup>();

  for (const mutant of mutants) {
    const exprText = mutant.expressionText || mutant.original;
    const normalized = exprText.replace(/\s+/g, " ").trim();
    const signature = `${mutant.mutatorName}|${mutant.original}|${mutant.replacement}|${normalized}`;

    const existing = groups.get(signature);
    if (existing) {
      existing.instances.push(mutant);
    } else {
      groups.set(signature, {
        signature,
        mutatorName: mutant.mutatorName,
        original: mutant.original,
        replacement: mutant.replacement,
        description: mutant.description,
        expressionText: normalized,
        instances: [mutant],
      });
    }
  }

  return Array.from(groups.values());
}

export function formatGroupedMutantsForTestGeneration(mutants: MutantInfo[]): string {
  const groups = groupMutantsBySignature(mutants);

  // Organize groups by file (use first instance's file for ordering)
  const fileOrder: string[] = [];
  const groupsByFile = new Map<string, MutantGroup[]>();

  for (const group of groups) {
    const primaryFile = group.instances[0].fileName;
    if (!groupsByFile.has(primaryFile)) {
      fileOrder.push(primaryFile);
      groupsByFile.set(primaryFile, []);
    }
    groupsByFile.get(primaryFile)!.push(group);
  }

  let output = `# Mutation-Guided Test Generation

Each mutation below represents a **potential bug**. Write tests that would **FAIL if the mutation were applied**.

## Why This Works
- Mutations simulate real bug patterns (wrong operators, off-by-one errors, flipped conditions)
- A test that catches a mutation will catch the real bug it represents
- If your test passes with the mutation, your test is too weak

---

`;

  for (const fileName of fileOrder) {
    const fileGroups = groupsByFile.get(fileName)!;
    output += `## File: ${fileName}\n\n`;

    // Sub-group by mutation type
    const byType = new Map<string, MutantGroup[]>();
    for (const g of fileGroups) {
      const existing = byType.get(g.mutatorName) || [];
      existing.push(g);
      byType.set(g.mutatorName, existing);
    }

    for (const [mutationType, typeGroups] of byType) {
      const totalInstances = typeGroups.reduce((sum, g) => sum + g.instances.length, 0);
      output += `### ${mutationType} Mutations (${typeGroups.length} unique, ${totalInstances} total)\n\n`;

      for (const group of typeGroups) {
        const representative = group.instances[0];
        output += `**${representative.id}**: ${group.description}`;
        if (group.instances.length > 1) {
          output += ` (${group.instances.length} identical instances)`;
        }
        output += `\n`;
        output += `- Expression: \`${group.expressionText}\`\n`;
        output += `- Original: \`${group.original}\`\n`;
        output += `- Mutated to: \`${group.replacement}\`\n`;
        if (group.instances.length > 1) {
          output += `- Locations:\n`;
          for (const instance of group.instances) {
            output += `  - ${instance.fileName} Line ${instance.location.start.line}\n`;
          }
          output += `- Context (representative):\n`;
        } else {
          output += `- Location: Line ${representative.location.start.line}\n`;
          output += `- Context:\n`;
        }
        output += `\`\`\`typescript\n${representative.context}\n\`\`\`\n`;
        output += `- **Test requirement**: Write a test that fails if \`${group.original}\` becomes \`${group.replacement}\` in \`${group.expressionText}\``;
        if (group.instances.length > 1) {
          output += `. This covers ${group.instances.length} locations`;
        }
        output += `\n\n`;
      }
    }
  }

  output += `---

## Test Writing Guidelines

For each mutation:
1. **Identify the bug**: What error does this mutation represent?
2. **Find the edge case**: What input would expose the difference?
3. **Write the assertion**: What observable behavior changes?

**Do NOT**:
- Write tests that just check it doesn't throw
- Use mocks that return exactly what you assert against
- Write \`assertNotNull\` without meaningful follow-up
- Mirror the implementation logic (tautological tests)

**DO**:
- Test boundary conditions (exact values where behavior changes)
- Test both sides of conditionals
- Verify specific output values
`;

  return output;
}

async function main() {
  const args = process.argv.slice(2);

  const options: GenerateMutantsOptions = {};

  if (args.includes("--git-diff")) {
    options.fromGitDiff = true;
    const baseIdx = args.indexOf("--base");
    if (baseIdx !== -1 && args[baseIdx + 1]) {
      options.baseBranch = args[baseIdx + 1];
    }
  } else {
    const files = args.filter((a) => !a.startsWith("--"));
    if (files.length > 0) {
      options.files = files;
    } else {
      options.fromGitDiff = true;
    }
  }

  const mutants = await generateMutants(options);

  console.error(`\nGenerated ${mutants.length} mutants\n`);

  if (mutants.length === 0) {
    console.log("No mutations generated. Provide files or use --git-diff");
    process.exit(0);
  }

  const noDedup = args.includes("--no-dedup");
  const output = noDedup
    ? formatMutantsForTestGeneration(mutants)
    : formatGroupedMutantsForTestGeneration(mutants);

  if (args.includes("--output")) {
    const outputIdx = args.indexOf("--output");
    const outputPath = args[outputIdx + 1] || "mutants.md";
    fs.writeFileSync(outputPath, output);
    console.error(`Written to ${outputPath}`);
  } else {
    console.log(output);
  }
}

main().catch(console.error);
