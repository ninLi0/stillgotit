/**
 * A learner-facing refusal. Its message is a complete sentence the browser may show as `detail`.
 * `code` is the answer's `error` value; most importer refusals use OPERATION_FAILED.
 */
export class Refusal extends Error {
  constructor(message: string, readonly code = "OPERATION_FAILED", readonly status = 400) {
    super(message);
    this.name = "Refusal";
  }
}
