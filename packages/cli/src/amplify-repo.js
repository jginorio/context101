/**
 * Amplify admin always ships via CodeCommit in the stack.
 * --repo is an optional override to watch an external GitHub repo.
 */
export function defaultAmplifyRepository({ repo } = {}) {
  return repo || "";
}
