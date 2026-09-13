export const SIGINT_EXIT = 130;
export const CANCELLED = "cancelled";

export function isExitPromptError(error) {
  return Boolean(error && error.name === "ExitPromptError");
}

export function printCancelled(io) {
  io.dim(CANCELLED);
  return SIGINT_EXIT;
}
