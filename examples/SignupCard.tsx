type Props = {
  isMember: boolean;
  benefits: string[];
  onJoin: () => void;
};

export const trialDays = 14;

export function SignupCard({ isMember, benefits, onJoin }: Props) {
  return (
    <section aria-label="멤버십 안내">
      <h1>작은 시작, 더 큰 가능성</h1>
      <p>{trialDays}일 동안 모든 기능을 사용해 보세요.</p>
      <ul>
        {benefits.map(benefit => <li key={benefit}>{benefit}</li>)}
      </ul>
      {isMember ? (
        <p>이미 멤버십을 이용 중이에요.</p>
      ) : (
        <button type="button" onClick={onJoin}>무료로 시작하기</button>
      )}
      <small>카드 등록 없이 시작할 수 있어요.</small>
    </section>
  );
}
