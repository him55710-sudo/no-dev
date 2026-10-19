/** Presentation helpers. These do not infer a business purpose from a filename. */
export const beginnerExplanationInstruction =
  "프로그래밍을 전혀 모르는 사람에게 설명하세요. summary는 이 부분이 하는 일을 쉬운 한국어 1~2문장으로만 요약하세요. 함수, 변수, JSON, stdio, Git, API, AST, 파일 확장자 같은 말을 요약에 쓰지 마세요. citations의 explanation에서 시작 조건 → 실제로 하는 일 → 결과 → 멈추는 조건을 차례로 설명하세요. 전문 용어가 꼭 필요하면 먼저 일상어로 뜻을 설명하세요. 중요한 승인 조건, 실패, 변경 범위는 상세 설명에서 빠뜨리지 마세요. 이름이나 주석만으로 목적을 확정하지 말고 실제 처리 내용을 근거로 삼으세요. 알 수 없는 부분은 짧게 밝히세요. 원문은 quote에만 두세요. 코드를 실행하거나 수정하지 마세요.";

export const beginnerEditInstruction = (request: string) =>
  `사용자의 변경 요청: ${request}\n비개발자가 읽습니다. summary와 각 edit.reason은 사용자에게 보이는 행동이 어떻게 달라지는지 쉬운 한국어로 설명하세요. 현재 파일에서 근거를 확인할 수 있는 수정만 제안하세요. 다른 파일이나 시스템 전체를 수정했다고 말하지 마세요. 요청에 여러 해석이 가능하면 edits를 비우고 무엇을 정해야 하는지 summary에 적으세요.`;

/** A reviewed reading of the exact example supplied in this conversation.
 * It is an explicit example, never substituted for an arbitrary open document. */
export const approvalExampleGuide = {
  title: "승인을 받으면 정해진 내용을 바꾸는 테스트",
  summary:
    "실제 AI를 호출하지 않고, 변경 승인을 받으면 세 파일을 정해진 내용으로 수정하는 테스트 프로그램입니다.",
  steps: [
    {
      title: "먼저, 시험용 작업 공간인지 확인해요",
      text: "시작할 때 지정된 시험용 프로젝트인지 확인합니다. 수정 요청을 받으면 따로 분리된 작업 공간인지 한 번 더 확인하고, 조건이 맞지 않으면 멈춥니다.",
      detail:
        "프로젝트 이름과 작업 공간 연결 정보를 검사합니다. 이 검사는 이 예제를 시험 환경에 한정하려는 장치이며, 이 검사만으로 모든 위험을 막는다는 뜻은 아닙니다.",
    },
    {
      title: "외부에서 오는 요청을 기다려요",
      text: "준비 요청에는 준비됐다고 답하고, 새 작업 요청에는 시험용 작업 번호를 돌려줍니다. 실제 AI가 답을 생각하거나 로그인하는 과정은 없습니다.",
      detail:
        "한 줄씩 들어오는 정해진 형식의 메시지를 읽습니다. 초기화, 계정 확인, 작업 시작, 중단 요청에 각각 미리 작성된 응답을 보냅니다. 잘못된 형식의 메시지를 처리하는 별도 복구 절차는 이 코드에 없습니다.",
    },
    {
      title: "바꾸기 전에 승인을 요청해요",
      text: "수정 작업을 시작하라는 요청이 오면 세 파일을 바꿔도 되는지 묻습니다. 승인을 받지 못하면 중단했다고 알리고 수정하지 않습니다.",
      detail:
        "승인 응답이 accept인 경우에만 아래 변경 절차로 넘어갑니다. 다른 응답은 interrupted, 즉 중단 상태로 끝납니다.",
    },
    {
      title: "승인되면 세 가지 내용을 순서대로 바꿔요",
      text: "보기 전용 사용자를 허용 대상에서 빼고, 접근이 거절됐을 때 ‘접근 불가’라는 응답 번호를 붙이며, 수정할 수 없는 화면에는 ‘읽기 전용’을 표시하도록 바꿉니다.",
      detail:
        "권한 규칙의 owner·editor·viewer 조건을 owner·editor로 바꿉니다. 거절 오류에는 403을 붙입니다. 화면의 안내 문구는 수정 가능하면 비우고, 불가능하면 ‘읽기 전용’으로 만듭니다. 실제 앱 전체에 미치는 영향은 이 세 파일의 사용처를 함께 봐야 합니다.",
    },
    {
      title: "끝나면 완료됐다고 알려요",
      text: "세 파일의 교체를 마치면 완료 메시지를 보냅니다. 중간에 예상한 문구가 없으면 오류로 멈춥니다.",
      detail:
        "파일은 하나씩 바로 저장합니다. 뒤의 파일에서 실패했을 때 앞에서 바꾼 파일을 자동으로 되돌리는 처리는 없습니다. 중단 요청을 받으면 중단 응답을 보내며, 입력 연결이 닫히면 프로그램을 종료합니다.",
    },
  ],
  changes: [
    {
      topic: "수정 가능한 사람",
      before: "관리자 · 편집자 · 보기 전용 사용자",
      after: "관리자 · 편집자",
    },
    {
      topic: "접근이 거절됐을 때",
      before: "거절 오류만 전달",
      after: "거절 오류에 ‘접근 불가(403)’도 전달",
    },
    {
      topic: "수정할 수 없는 화면",
      before: "안내 문구 없음",
      after: "‘읽기 전용’ 표시",
    },
  ],
};

export function plainError(error: unknown): {
  message: string;
  technical: string;
} {
  const technical = error instanceof Error ? error.message : String(error);
  const message = /Ollama|local model|모델|connect|연결/i.test(technical)
    ? "쉬운 설명을 만드는 AI에 아직 연결하지 못했어요. 예제 설명은 바로 볼 수 있고, 연결 설정은 아래에서 열 수 있어요."
    : /finite number|유한한 숫자/i.test(technical)
      ? "숫자만 적어 주세요. 예를 들어 ‘7만’은 ‘70000’으로 적으면 돼요."
      : /stale|바뀌|changed/i.test(technical)
        ? "설명하던 내용이 바뀌었어요. 최신 내용으로 다시 요청해 주세요."
        : /cancel|취소/i.test(technical)
          ? "요청을 멈췄어요."
          : "이번 요청을 마치지 못했어요. 입력 내용을 확인하고 다시 시도해 주세요.";
  return { message, technical };
}
