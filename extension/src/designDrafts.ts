import { mkdir, readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  designDraftSchema,
  draftWriteSchema,
  type DesignDraft,
  type DraftWrite,
} from "../../src/workspace/drafts";
import type { LivingSpec } from "../../src/workspace/spec";
import { digest, projectLease, readRecord, writeRecord } from "./agent/records";

const recordSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectKey: z.string(),
    draft: designDraftSchema,
  })
  .strict();
/** Local extension storage only. No project source, confirmed design, or agent mutation. */
export class DesignDrafts {
  readonly projectKey: string;
  private directory: string;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(storage: string, canonicalRoot: string) {
    this.projectKey = digest(
      process.platform === "win32"
        ? canonicalRoot.toLowerCase()
        : canonicalRoot,
    );
    this.directory = resolve(storage, "design-drafts", this.projectKey);
  }
  private path(id: string) {
    return resolve(this.directory, digest(id) + ".json");
  }
  async read(id: string): Promise<DesignDraft | undefined> {
    try {
      const record = await readRecord(this.path(id), recordSchema, 1024 * 1024);
      if (record.projectKey !== this.projectKey || record.draft.base.id !== id)
        throw Error("다른 프로젝트의 초안 기록입니다.");
      return record.draft;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async list() {
    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const paths = files.filter((file) => /^[a-f0-9]{64}\.json$/.test(file));
    if (paths.length > 100)
      throw Error("초안이 100개를 초과합니다. 기존 초안을 확인해 주세요.");
    const drafts: DesignDraft[] = [];
    for (const file of paths) {
      const record = await readRecord(
        resolve(this.directory, file),
        recordSchema,
        1024 * 1024,
      );
      if (
        record.projectKey !== this.projectKey ||
        digest(record.draft.base.id) + ".json" !== file
      )
        throw Error("초안 기록의 프로젝트나 식별자가 일치하지 않습니다.");
      drafts.push(record.draft);
    }
    return drafts;
  }
  private locked<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      const release = await projectLease("pureobom-drafts:" + this.directory);
      try {
        await mkdir(this.directory, { recursive: true });
        return await work();
      } finally {
        await release();
      }
    });
    this.pending = result.catch(() => {});
    return result;
  }
  private async expected(id: string, revision: number) {
    const current = await this.read(id);
    if ((current?.revision ?? 0) !== revision)
      throw Error(
        "다른 창에서 초안이 바뀌었습니다. 입력 내용은 유지됩니다. 저장된 초안을 확인해 주세요.",
      );
    return current;
  }
  private async write(
    base: LivingSpec,
    content: DesignDraft["content"],
    revision: number,
  ) {
    const draft = designDraftSchema.parse({
      base,
      content,
      revision: revision + 1,
      updatedAt: new Date().toISOString(),
    });
    const record = { schemaVersion: 1, projectKey: this.projectKey, draft };
    if (Buffer.byteLength(JSON.stringify(record, null, 2)) + 1 > 1024 * 1024)
      throw Error(
        "초안이 1MB 제한을 초과합니다. 입력 내용을 따로 보관하고 범위를 줄여 주세요.",
      );
    await writeRecord(this.path(base.id), record);
    return draft;
  }
  save(raw: DraftWrite) {
    const request = draftWriteSchema.parse(raw);
    if (request.projectKey !== this.projectKey)
      throw Error("초안을 작성한 프로젝트가 아닙니다.");
    return this.locked(async () => {
      const previous = await this.expected(
        request.base.id,
        request.expectedRevision,
      );
      if (
        previous &&
        JSON.stringify(previous.base) !== JSON.stringify(request.base)
      )
        throw Error("초안의 기준을 바꾸려면 최신 설계와 먼저 비교해 주세요.");
      if (!previous && (await this.list()).length >= 100)
        throw Error(
          "초안이 100개에 도달했습니다. 기존 초안을 저장하거나 버린 뒤 작성해 주세요.",
        );
      return this.write(
        request.base,
        request.content,
        request.expectedRevision,
      );
    });
  }
  rebase(id: string, revision: number, base: LivingSpec) {
    return this.locked(async () => {
      const previous = await this.expected(id, revision);
      if (!previous || id !== base.id)
        throw Error("다시 연결할 초안이 없습니다.");
      return this.write(base, previous.content, revision);
    });
  }
  remove(id: string, revision: number) {
    return this.locked(async () => {
      if (!(await this.read(id))) return;
      await this.expected(id, revision);
      await unlink(this.path(id));
    });
  }
  consume<T>(
    id: string,
    revision: number,
    save: (draft: DesignDraft) => Promise<T>,
  ) {
    return this.locked(async () => {
      const draft = await this.expected(id, revision);
      if (!draft) throw Error("저장할 초안이 없습니다.");
      const result = await save(draft);
      await unlink(this.path(id));
      return result;
    });
  }
}
