import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  approvalMatches,
  executionProfileSchema,
  saveExecutionSchema,
  type ExecutionProfile,
  type ExecutionUse,
  type SaveExecution,
} from "../../src/workspace/execution";
import { projectLease, readRecord, writeRecord } from "./agent/records";

/** Local machine permissions. Never commit these to the project or sync via settings. */
export class ExecutionProfiles {
  private directory: string;
  private path: string;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    storage: string,
    readonly projectKey: string,
  ) {
    if (!/^[a-f0-9]{64}$/.test(projectKey))
      throw Error("잘못된 프로젝트 식별자입니다.");
    this.directory = resolve(storage, "execution-profiles");
    this.path = resolve(this.directory, projectKey + ".json");
  }
  async read(): Promise<ExecutionProfile> {
    try {
      const record = await readRecord(
        this.path,
        executionProfileSchema,
        256 * 1024,
      );
      if (
        record.projectKey !== this.projectKey ||
        (record.approval &&
          record.approval.context.projectKey !== this.projectKey)
      )
        throw Error("다른 프로젝트의 실행 설정입니다.");
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return {
          schemaVersion: 1,
          projectKey: this.projectKey,
          revision: 0,
          approval: null,
        };
      throw error;
    }
  }
  private locked<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      const release = await projectLease("pureobom-execution:" + this.path);
      try {
        return await work();
      } finally {
        await release();
      }
    });
    this.pending = result.catch(() => {});
    return result;
  }
  private async expected(revision: number) {
    const current = await this.read();
    if (current.revision !== revision)
      throw Error(
        "다른 창에서 실행 설정이 바뀌었습니다. 새로 읽고 확인해 주세요.",
      );
    return current;
  }
  save(raw: SaveExecution) {
    const request = saveExecutionSchema.parse(raw);
    if (request.context.projectKey !== this.projectKey)
      throw Error("다른 프로젝트의 실행 설정입니다.");
    return this.locked(async () => {
      await this.expected(request.expectedRevision);
      const record = executionProfileSchema.parse({
        schemaVersion: 1,
        projectKey: this.projectKey,
        revision: request.expectedRevision + 1,
        approval: {
          context: request.context,
          checks: request.checks,
          allowExternal: true,
          savedAt: new Date().toISOString(),
        },
      });
      await mkdir(this.directory, { recursive: true });
      await writeRecord(this.path, record);
      return record;
    });
  }
  revoke(revision: number) {
    return this.locked(async () => {
      const current = await this.expected(revision);
      // Retain the revision so another open window cannot resurrect a revoked choice.
      const record = { ...current, revision: revision + 1, approval: null };
      await mkdir(this.directory, { recursive: true });
      await writeRecord(this.path, record);
      return record;
    });
  }
  use<T>(request: ExecutionUse, start: () => Promise<T>) {
    return this.locked(async () => {
      const current = await this.expected(request.profileRevision);
      if (
        request.useSaved &&
        (!approvalMatches(current, request.context) ||
          JSON.stringify([...current.approval!.checks].sort()) !==
            JSON.stringify([...request.checks].sort()))
      )
        throw Error("보관된 실행 설정과 다릅니다. 다시 확인해 주세요.");
      return start();
    });
  }
}
