import type { z } from 'zod';

export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);

    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

const formatIssue = (issue: z.core.$ZodIssue): string => {
  const path = issue.path.map(String).join('.');

  return `${path === '' ? '(root)' : path}: ${issue.message}`;
};

export const parseEnv = <T extends z.ZodType>(
  schema: T,
  raw: Record<string, unknown>,
): z.output<T> => {
  const result = schema.safeParse(raw);

  if (!result.success) {
    throw new EnvValidationError(result.error.issues.map(formatIssue));
  }

  return result.data;
};
