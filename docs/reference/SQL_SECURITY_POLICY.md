# SQL Security Policy

This document outlines the SQL security practices enforced in the SB-OS codebase to prevent SQL injection and related vulnerabilities.

## Overview

SB-OS uses **Drizzle ORM** for database access, which provides automatic parameterization for most queries. However, certain patterns still require manual attention to prevent injection attacks.

## Safe Patterns (Already Used)

### 1. Drizzle ORM Query Builders ✅

All standard CRUD operations use Drizzle's query builders with automatic parameterization:

```typescript
// Safe: Drizzle parameterizes id automatically
await db.select().from(users).where(eq(users.id, userId));

// Safe: All values are parameterized
await db.insert(tasks).values({ title, status, priority });

// Safe: Updates are parameterized
await db.update(tasks).set({ status: 'done' }).where(eq(tasks.id, taskId));
```

### 2. Drizzle SQL Template Tags ✅

When using raw SQL, the `sql` template tag from Drizzle automatically parameterizes interpolated values:

```typescript
// Safe: ${userId} is parameterized, not interpolated as raw SQL
const result = await db.execute(sql`
  SELECT * FROM sessions WHERE (sess->>'userId')::text = ${userId}
`);
```

## Vulnerable Patterns (Avoid)

### 1. LIKE Wildcard Injection ⚠️

**Problem**: User input containing `%` or `_` characters can manipulate LIKE query behavior.

```typescript
// VULNERABLE: User can search for "%" to match all records
const results = await db.select()
  .from(docs)
  .where(like(docs.title, `%${userQuery}%`));
```

**Solution**: Use `escapeLikeWildcards()` from `server/storage.ts`:

```typescript
import { escapeLikeWildcards } from './storage';

// SAFE: Wildcards are escaped
const escapedQuery = escapeLikeWildcards(userQuery);
const results = await db.select()
  .from(docs)
  .where(like(docs.title, `%${escapedQuery}%`));
```

### 2. Dynamic Table/Column Names ⚠️

**Problem**: Dynamic identifiers cannot be parameterized.

```typescript
// NEVER DO THIS
const table = req.query.table;
await db.execute(sql`SELECT * FROM ${table}`); // NOT parameterized!
```

**Solution**: Use allowlists for dynamic identifiers:

```typescript
const ALLOWED_TABLES = ['tasks', 'projects', 'ventures'] as const;
if (!ALLOWED_TABLES.includes(table)) {
  throw new Error('Invalid table name');
}
```

### 3. ORDER BY Injection ⚠️

Similar to table names, ORDER BY columns require validation:

```typescript
const ALLOWED_SORT_COLUMNS = ['createdAt', 'updatedAt', 'title'];
if (!ALLOWED_SORT_COLUMNS.includes(sortColumn)) {
  throw new Error('Invalid sort column');
}
```

## Security Functions Reference

### `escapeLikeWildcards(input: string): string`

Location: `server/storage.ts`

Escapes SQL LIKE wildcard characters:
- `%` → `\%` (matches zero or more characters)
- `_` → `\_` (matches exactly one character)
- `\` → `\\` (escape character itself)

```typescript
escapeLikeWildcards('%admin%')  // Returns: \%admin\%
escapeLikeWildcards('test_value')  // Returns: test\_value
```

## Code Review Checklist

When reviewing code that involves database queries:

- [ ] All user inputs flow through Drizzle query builders or parameterized `sql` tags
- [ ] LIKE patterns with user input use `escapeLikeWildcards()`
- [ ] Dynamic table/column names use allowlist validation
- [ ] No string concatenation for SQL construction
- [ ] LIMIT/OFFSET values are parsed as integers with bounds checking

## Testing Requirements

1. Unit tests for escape functions exist in `server/__tests__/sql-security.test.ts`
2. Any new LIKE search functionality must include tests for wildcard injection
3. Integration tests should verify that wildcard characters are treated literally

## Running Security Tests

```bash
# Run all tests including security tests
npm test

# Run only SQL security tests
npx vitest run server/__tests__/sql-security.test.ts
```

## Grep Patterns for Auditing

Use these patterns to find potentially vulnerable code:

```bash
# Find LIKE queries with template literals (potential wildcard injection)
grep -rn "like(.*\`%\${" server/

# Find raw SQL execution
grep -rn "db.execute" server/

# Find dynamic LIKE patterns
grep -rn "like.*\+" server/
```

## References

- [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
- [Drizzle ORM Documentation](https://orm.drizzle.team/docs/overview)
- [PostgreSQL LIKE Pattern Matching](https://www.postgresql.org/docs/current/functions-matching.html)
