import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  initialNavigation,
  navigationSchema,
  type WorkspaceNavigation,
} from "../../src/workspace/navigation";
import { readRecord, writeRecord } from "./agent/records";

const recordSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectKey: z.string().regex(/^[a-f0-9]{64}$/),
    view: navigationSchema,
  })
  .strict();
/** Navigation is local UI preference data, never project source or an execution grant. */
export class NavigationStore {
  private readonly directory: string;
  private readonly path: string;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    storage: string,
    readonly projectKey: string,
  ) {
    if (!/^[a-f0-9]{64}$/.test(projectKey))
      throw Error("잘못된 탐색 프로젝트입니다.");
    this.directory = resolve(storage, "navigation");
    this.path = resolve(this.directory, projectKey + ".json");
  }
  async read(): Promise<WorkspaceNavigation> {
    try {
      const record = await readRecord(this.path, recordSchema, 2 * 1024 * 1024);
      if (record.projectKey !== this.projectKey)
        throw Error("다른 프로젝트의 탐색 기록입니다.");
      return record.view;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return initialNavigation();
      throw error;
    }
  }
  save(raw: WorkspaceNavigation) {
    const record = recordSchema.parse({
      schemaVersion: 1,
      projectKey: this.projectKey,
      view: raw,
    });
    if (
      Buffer.byteLength(JSON.stringify(record, null, 2)) + 1 >
      2 * 1024 * 1024
    )
      throw Error("탐색 기록이 2MB를 초과합니다.");
    const work = this.pending.then(async () => {
      await mkdir(this.directory, { recursive: true });
      await writeRecord(this.path, record);
    });
    this.pending = work.catch(() => {});
    return work;
  }
}
