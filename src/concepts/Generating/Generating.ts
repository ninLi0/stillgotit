/** An external generation action. Its provider receives values, never peer concepts. */
export class Generating<Owner, Request, Answer> {
  constructor(private readonly provider: (owner: Owner, request: Request) => Promise<Answer> = async () => { throw new Error("No provider configured"); }) {}
  async generate({ owner, request }: { owner: Owner; request: Request }): Promise<{ answer: Answer }> {
    try { return { answer: await this.provider(owner, request) }; }
    catch { throw new GenerationFailed(); }
  }
}
export class GenerationFailed extends Error {
  readonly code = "GENERATION_FAILED";
  constructor() { super("The tutor could not finish. Check your connection and retry. Your saved work is still available."); }
}
