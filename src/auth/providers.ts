import GitHub from "next-auth/providers/github";

// The sole sign-in path is GitHub (REQ-001: no non-GitHub login path exists).
// Keep this list to exactly one provider; the test enforces it.
export const providers = [GitHub];
