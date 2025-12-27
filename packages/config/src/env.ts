import { z } from "zod";

export class EnvError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(message: string, issues: z.ZodIssue[]) {
    super(message);
    this.name = "EnvError";
    this.issues = issues;
  }
}

const formatIssues = (issues: z.ZodIssue[]): string => {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
};

export const readEnv = <T extends z.ZodTypeAny>(
  schema: T,
  env: Record<string, string | undefined> = Bun.env
): z.infer<T> => {
  const result = schema.safeParse(env);

  if (!result.success) {
    const details = formatIssues(result.error.issues);
    throw new EnvError(`Invalid environment: ${details}`, result.error.issues);
  }

  return result.data;
};
