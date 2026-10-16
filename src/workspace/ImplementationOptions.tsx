import { useState } from "react";
import {
  approvalMatches,
  checkNames,
  type ExecutionUse,
  type ExecutionContext,
  type SaveExecution,
  type RevokeExecution,
} from "./execution";
import type { DesignWorkspaceState } from "./state";
import { jobIsActive, type VerificationName } from "./job";

export type ExecutionActions = {
  saveExecution?: (request: SaveExecution) => Promise<unknown>;
  revokeExecution?: (request: RevokeExecution) => Promise<unknown>;
  checkConnection?: (context: ExecutionContext) => Promise<unknown>;
  executionSettings?: () => Promise<unknown>;
};
/** Parent keys this form by project/context/profile revision, never by job progress. */
export function ImplementationOptions({
  state,
  actions,
  disabled,
  onImplement,
}: {
  state: DesignWorkspaceState;
  actions: ExecutionActions;
  disabled: boolean;
  onImplement: (request: ExecutionUse) => void;
}) {
  const execution = state.execution;
  const matches = execution
    ? approvalMatches(execution.profile, execution.context)
    : false;
  const [allowExternal, setAllowExternal] = useState(matches);
  const [checks, setChecks] = useState<VerificationName[]>(
    () =>
      execution?.profile.approval?.checks.filter(
        (name) => execution.context.scripts[name] !== undefined,
      ) ?? [],
  );
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const names = checkNames.filter(
    (name) => execution?.context.scripts[name] !== undefined,
  );
  const savedSelection =
    matches &&
    JSON.stringify([...checks].sort()) ===
      JSON.stringify([...(execution?.profile.approval?.checks ?? [])].sort());
  const perform = async (work: () => Promise<unknown>) => {
    setPending(true);
    setFeedback("");
    try {
      await work();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };
  const canChoose =
    !!execution && state.trusted && !state.busy && !state.stale && !pending;
  return (
    <section className="implementation-options" aria-label="구현 설정">
      <strong>Codex로 구현</strong>
      <p>
        별도 Git 작업 공간에서 수정하고 검사합니다. 결과를 검토한 뒤 원본
        프로젝트에 반영합니다.
      </p>
      {state.executionError ? <p role="alert">{state.executionError}</p> : null}
      {execution ? (
        <>
          <div className="execution-connection">
            <span>모델: {execution.context.model || "Codex 기본 설정"}</span>
            <div className="execution-buttons">
              {actions.checkConnection ? (
                <button
                  disabled={
                    !canChoose ||
                    state.connection?.status === "checking" ||
                    jobIsActive(state.job)
                  }
                  onClick={() =>
                    void perform(() =>
                      actions.checkConnection!(execution.context),
                    )
                  }
                >
                  {state.connection?.status === "checking"
                    ? "연결 확인 중…"
                    : "Codex 연결 확인"}
                </button>
              ) : null}
              {actions.executionSettings ? (
                <button
                  onClick={() =>
                    void perform(() => actions.executionSettings!())
                  }
                >
                  실행기·모델 설정
                </button>
              ) : null}
            </div>
            {state.connection ? (
              <p role="status">
                {state.connection.message}
                {state.connection.provider
                  ? ` (${state.connection.provider})`
                  : ""}
              </p>
            ) : (
              <p>
                연결 확인은 실행기와 로그인 상태를 확인합니다. 모델 구현 요청은
                시작하지 않습니다.
              </p>
            )}
            <details>
              <summary>실행기 경로</summary>
              <code>{execution.context.executable}</code>
            </details>
          </div>
          {execution.profile.approval ? (
            <p role="status">
              {matches
                ? "이 컴퓨터에 보관한 프로젝트 설정을 불러왔습니다."
                : "실행기, 모델 또는 검사 명령이 바뀌었습니다. 아래 설정을 다시 확인해 주세요."}
            </p>
          ) : null}
          <label>
            <input
              type="checkbox"
              checked={allowExternal}
              disabled={!canChoose}
              onChange={(event) => setAllowExternal(event.target.checked)}
            />
            설계와 프로젝트 코드를 Codex 모델에 전달하고, 선택한 검사 명령을
            실행합니다.
          </label>
          <fieldset disabled={!canChoose}>
            <legend>구현 후 실행할 검사</legend>
            {names.length ? (
              names.map((name) => (
                <div key={name} className="execution-check">
                  <label>
                    <input
                      type="checkbox"
                      checked={checks.includes(name)}
                      onChange={(event) =>
                        setChecks((current) =>
                          event.target.checked
                            ? [...current, name]
                            : current.filter((item) => item !== name),
                        )
                      }
                    />
                    {execution.context.manager} run {name}
                  </label>
                  <code>{execution.context.scripts[name]}</code>
                </div>
              ))
            ) : (
              <p>
                package.json에 test, build, typecheck 또는 check 명령이
                필요합니다.
              </p>
            )}
          </fieldset>
          <div className="execution-buttons">
            {actions.saveExecution ? (
              <button
                disabled={
                  !canChoose ||
                  !allowExternal ||
                  !checks.length ||
                  savedSelection
                }
                onClick={() =>
                  void perform(() =>
                    actions.saveExecution!({
                      context: execution.context,
                      checks,
                      allowExternal: true,
                      expectedRevision: execution.profile.revision,
                    }),
                  )
                }
              >
                이 프로젝트에 보관
              </button>
            ) : null}
            {execution.profile.approval && actions.revokeExecution ? (
              <button
                disabled={!canChoose}
                onClick={() =>
                  void perform(() =>
                    actions.revokeExecution!({
                      projectKey: execution.context.projectKey,
                      expectedRevision: execution.profile.revision,
                    }),
                  )
                }
              >
                보관 해제
              </button>
            ) : null}
          </div>
          <p>
            보관하면 다음에도 이 설정을 사용합니다. 해제는 이후 구현에 적용되며,
            진행 중인 작업은 작업 패널에서 취소할 수 있습니다.
          </p>
          <button
            className="primary"
            disabled={
              disabled || !canChoose || !allowExternal || !checks.length
            }
            onClick={() =>
              onImplement({
                context: execution.context,
                checks,
                allowExternal: true,
                profileRevision: execution.profile.revision,
                ...(savedSelection ? { useSaved: true } : {}),
              })
            }
          >
            저장하고 구현
          </button>
        </>
      ) : (
        <p>
          프로젝트의 실행 설정을 읽는 중입니다. 불러오지 못하면 구조를 새로 읽어
          주세요.
        </p>
      )}
      {feedback ? <p role="alert">{feedback}</p> : null}
    </section>
  );
}
