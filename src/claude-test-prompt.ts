import { generateMutants, formatMutantsForTestGeneration } from "./generate-mutants";
import * as fs from "fs";
import * as path from "path";

interface TestGenerationContext {
  mutants: Awaited<ReturnType<typeof generateMutants>>;
  sourceCode: Map<string, string>;
  existingTests?: Map<string, string>;
}

/**
 * Generate the full prompt for Claude to write mutation-catching tests
 */
export function generateTestPrompt(context: TestGenerationContext): string {
  const { mutants, sourceCode, existingTests } = context;

  let prompt = `# Task: Write tests that catch these mutations

You are writing tests for code that has been analyzed for potential bugs using mutation testing.
Each mutation below represents a realistic bug that could occur. Your job is to write tests that would FAIL if any of these mutations were present.

## Why this approach works
- Mutations represent real bug patterns (wrong operators, off-by-one errors, missing conditions)
- A test that catches a mutation will also catch the real bug it represents
- If your test passes with the mutation applied, your test is too weak to catch real bugs

`;

  // Add the formatted mutants
  prompt += formatMutantsForTestGeneration(mutants, sourceCode);

  // Add existing tests if available for context
  if (existingTests && existingTests.size > 0) {
    prompt += `\n## Existing Tests (for reference)\n\n`;
    for (const [testFile, content] of existingTests) {
      prompt += `### ${testFile}\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
    }
    prompt += `Extend these existing tests or add new test files as appropriate.\n\n`;
  }

  prompt += `
## Output Format

For each mutation, provide:
1. A test function with a descriptive name indicating what bug it catches
2. A brief comment explaining which mutation(s) this test catches
3. Meaningful assertions that would fail if the mutation were applied

Group related tests logically. Use the project's existing test framework and patterns.

## Quality Checklist
Before finalizing each test, verify:
- [ ] The test would FAIL if the corresponding mutation were applied
- [ ] The test does not mirror the implementation logic (no tautologies)
- [ ] Assertions test observable behavior, not implementation details
- [ ] Edge cases near the mutation are covered

Now write the tests:
`;

  return prompt;
}

/**
 * Find existing test files for the given source files
 */
function findExistingTests(sourceFiles: string[]): Map<string, string> {
  const tests = new Map<string, string>();

  for (const sourceFile of sourceFiles) {
    const dir = path.dirname(sourceFile);
    const basename = path.basename(sourceFile, path.extname(sourceFile));

    // Common test file patterns
    const testPatterns = [
      path.join(dir, `${basename}.test.ts`),
      path.join(dir, `${basename}.spec.ts`),
      path.join(dir, `${basename}.test.tsx`),
      path.join(dir, `${basename}.spec.tsx`),
      path.join(dir, "__tests__", `${basename}.test.ts`),
      path.join(dir, "__tests__", `${basename}.spec.ts`),
      path.join(dir, "..", "__tests__", `${basename}.test.ts`),
      path.join(dir, "..", "tests", `${basename}.test.ts`),
    ];

    for (const pattern of testPatterns) {
      if (fs.existsSync(pattern)) {
        tests.set(pattern, fs.readFileSync(pattern, "utf-8"));
      }
    }
  }

  return tests;
}

/**
 * Main function to generate a Claude-ready test prompt from changed files
 */
export async function generateClaudeTestPrompt(options: {
  files?: string[];
  fromGitDiff?: boolean;
  baseBranch?: string;
  includeExistingTests?: boolean;
}): Promise<string> {
  const mutants = await generateMutants({
    files: options.files,
    fromGitDiff: options.fromGitDiff,
    baseBranch: options.baseBranch,
  });

  if (mutants.length === 0) {
    return "No mutations generated. Either no files were changed or no mutable code was found.";
  }

  // Collect source code
  const sourceCode = new Map<string, string>();
  const uniqueFiles = [...new Set(mutants.map((m) => m.fileName))];
  for (const file of uniqueFiles) {
    if (fs.existsSync(file)) {
      sourceCode.set(file, fs.readFileSync(file, "utf-8"));
    }
  }

  // Find existing tests
  let existingTests: Map<string, string> | undefined;
  if (options.includeExistingTests) {
    existingTests = findExistingTests(uniqueFiles);
  }

  return generateTestPrompt({
    mutants,
    sourceCode,
    existingTests,
  });
}

// CLI usage
async function main() {
  const args = process.argv.slice(2);

  const options = {
    files: args.filter((a) => !a.startsWith("--")),
    fromGitDiff: args.includes("--git-diff"),
    baseBranch: args.includes("--base") ? args[args.indexOf("--base") + 1] : undefined,
    includeExistingTests: args.includes("--include-existing-tests"),
  };

  if (options.files.length === 0 && !options.fromGitDiff) {
    options.fromGitDiff = true; // Default to git diff
  }

  const prompt = await generateClaudeTestPrompt(options);

  if (args.includes("--output")) {
    const outputPath = args[args.indexOf("--output") + 1] || "test-prompt.md";
    fs.writeFileSync(outputPath, prompt);
    console.log(`Prompt written to ${outputPath}`);
  } else {
    console.log(prompt);
  }
}

main().catch(console.error);
