# Three changes you can explain

Also try [SignupCard.tsx](SignupCard.tsx): expand the React interface structure, find **무료로 시작하기**, change it to **14일 무료 체험**, inspect the string-expression diff, apply and undo. JSX is read without rendering or execution, so this example uses source comparison instead of calculation scenarios. [Open in the browser](https://him55710-sudo.github.io/pureobom/?demo=interface&lang=en).

[saveSettings.ts](saveSettings.ts) is a reading example for error handling. Find the success return, the catch return and the final `setSaving(false)` cleanup. Both return paths pass through `finally` before leaving. This example uses async callbacks and is outside the restricted calculation simulator.

Open a file in VS Code and run **풀어봄: 현재 파일 설명 열기**. Choose English in the panel if preferred. Edit a rule, compare the cases, inspect the native diff, apply, then undo.

| Example | Change | Input | Expected before → after |
| --- | --- | --- | --- |
| shipping.ts | 50000 → 70000 | 60000 | 0 → 3000 |
| trial.ts | 14 → 30 | 14 | false → true |
| discount.ts | 0.1 → 0.15 | 10000, true | 1000 → 1500 |

Also try an unchanged case. For shipping, 70000 remains free. For trial, day 30 remains outside the trial. For discounts, a non-member remains at zero. These are synthetic product rules, not business recommendations. Negative shipping or trial inputs produce an unavailable result with the thrown error; unavailable is never treated as a pass.
