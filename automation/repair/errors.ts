export class RepairError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepairError";
  }
}
