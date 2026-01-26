# Mutation-Guided Test Generator

A tool that generates mutations for your code and creates prompts for AI agents to write high-quality tests that catch those mutations.

## The Problem

When you ask AI coding agents to "add comprehensive tests," they typically produce low-value tests:
- Tautological assertions that mirror implementation
- Weak assertions like `assertNotNull(result)`
- Happy-path-only coverage
- Tests that wouldn't catch real bugs

## The Solution

This tool uses **mutation testing** to guide test generation:

1. **Generate mutations** from your code (wrong operators, flipped conditions, boundary errors)
2. **Each mutation represents a realistic bug**
3. **Prompt AI to write tests that would catch each mutation**
4. **Result: Tests that actually catch bugs**

Inspired by [Meta's ACH system](https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/).

## Installation

```bash
npm install
npm run build
```

Or use directly:
```bash
npx ts-node src/generate-mutants.ts [files...]
```

## Usage

### Generate mutations for specific files
```bash
npx ts-node src/generate-mutants.ts src/calculator.ts
```

### Generate mutations for git diff (changed files)
```bash
npx ts-node src/generate-mutants.ts --git-diff
npx ts-node src/generate-mutants.ts --git-diff --base main
```

### Save to file
```bash
npx ts-node src/generate-mutants.ts src/calculator.ts --output mutations.md
```

## Example Output

For this code:
```typescript
export function isPositive(n: number): boolean {
  return n > 0;
}
```

Generates mutations like:
```
**calculator.ts-5**: Change boundary: ">" to ">="
- Location: Line 21
- Original: `>`
- Mutated to: `>=`
- Test requirement: Write a test that fails if `>` becomes `>=`
```

This guides you (or an AI) to write:
```typescript
it('should return false for zero (boundary case)', () => {
  expect(isPositive(0)).toBe(false);  // Would fail if > became >=
});
```

## Integration with Claude Code

Use with Claude Code to automatically generate mutation-guided tests:

```
"Generate mutation-guided tests for the changed files"
```

Or run manually and paste the output into Claude:
```bash
npx ts-node src/generate-mutants.ts --git-diff | claude
```

## Supported Mutations

- **Binary operators**: `+` → `-`, `===` → `!==`, etc.
- **Boundary conditions**: `>` → `>=`, `<` → `<=`
- **Logical operators**: `&&` → `||`
- **Unary operators**: Remove `!`, flip `++`/`--`
- **Boolean literals**: `true` → `false`
- **Conditionals**: Always true/false

## Why This Works

Traditional mutation testing runs your tests against mutated code to find weak tests. This tool **inverts the process**:

1. Generate mutations first (potential bugs)
2. Use mutations to guide test writing
3. Each test targets a specific bug pattern
4. No need to run mutations - the framing itself produces better tests

Research shows AI generates better tests when given an adversarial framing ("catch this bug") vs coverage framing ("test this function").

## Sources

- [Meta: LLMs and Mutation Testing](https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/)
- [When AI-Generated Tests Pass But Miss the Bug](https://dev.to/jamesdev4123/when-ai-generated-tests-pass-but-miss-the-bug-a-postmortem-on-tautological-unit-tests-2ajp)
- [Test Smells in LLM-Generated Unit Tests](https://arxiv.org/abs/2410.10628)
