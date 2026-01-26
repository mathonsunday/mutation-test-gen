# Mutation-Guided Test Generation Skill

## When to use this skill
Use this skill when the user asks to:
- "Add tests for this feature/file"
- "Write tests that catch bugs"
- "Generate high-quality tests"
- "Add mutation-tested tests"

## How it works
1. Run the mutation generator on the target files
2. Use the generated mutations as a guide for writing tests
3. Each test should catch at least one mutation

## Steps

### Step 1: Identify target files
If the user specified files, use those. Otherwise, use git diff to find changed files.

### Step 2: Generate mutations
Run the mutation generator:
```bash
npx ts-node /path/to/mutation-test-gen/src/generate-mutants.ts [files...]
```

### Step 3: Write tests that catch mutations
For each mutation in the output:
1. Understand what bug the mutation represents
2. Write a test that would FAIL if that mutation were applied
3. Ensure the test passes against the original code

### Test Quality Criteria
Every test MUST:
- [ ] Catch at least one specific mutation
- [ ] Test observable behavior, not implementation
- [ ] Use meaningful assertions (not just `assertNotNull`)
- [ ] Not mirror the implementation logic

### Anti-patterns to avoid
- Tautological tests (asserting what you set up)
- Mocking the system under test
- Tests that only check "doesn't throw"
- Happy-path-only testing

## Example

For this mutation:
```
**calculator.ts-5**: Change boundary: ">" to ">="
- Location: Line 21
- Original: `>`
- Mutated to: `>=`
- Context: return n > 0;
```

Write a test like:
```typescript
// Catches mutation: > to >= on line 21
it('should return false for zero (boundary case)', () => {
  expect(isPositive(0)).toBe(false);  // Would fail if > became >=
});
```
