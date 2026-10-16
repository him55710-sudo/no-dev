# Changes you can explain

Development desktop readers: open [shipping.go](shipping.go) with a Go SDK or [shipping.py](shipping.py) with Python installed. Read the negative-input path, threshold and final return; change the threshold literal, review the language-specific diff, apply and undo. These readers do not provide the JavaScript calculation simulator. [Go scope and setup](../docs/GO_SOURCE.md) · [Python scope and setup](../docs/PYTHON_SOURCE.md).

Development preview: open [retry.jsonc](local-ai/semantic/retry.jsonc) to inspect literal values without a model. Change `$["retryLimit"]` from `3` to `4`, review the preserved comments and exact diff, apply and undo. The data does not establish how a consuming program retries. [JSON/JSONC guide](../docs/JSON_DATA.md).

[typedShipping.ts](typedShipping.ts) adds an editor check: in VS Code, change `shippingFee` from `3000` to `4000`, apply it and open **Editor reports**. TypeScript reports that the declared type only permits `3000 | 5000`. Jump to the exact source, then undo. [Guide and limits](../docs/EDITOR_REPORTS.md).

Also try [SignupCard.tsx](SignupCard.tsx): expand the React interface structure, find **무료로 시작하기**, change it to **14일 무료 체험**, inspect the string-expression diff, apply and undo. JSX is read without rendering or execution, so this example uses source comparison instead of calculation scenarios. [Open in the browser](https://him55710-sudo.github.io/pureobom/?demo=interface&lang=en).

[saveSettings.ts](saveSettings.ts) is a reading example for error handling. Find the success return, the catch return and the final `setSaving(false)` cleanup. Both return paths pass through `finally` before leaving. This example uses async callbacks and is outside the restricted calculation simulator.

Open a file in VS Code and run **풀어봄: 현재 파일 설명 열기**. Choose English in the panel if preferred. Edit a rule, compare the cases, inspect the native diff, apply, then undo.

| Example | Change | Input | Expected before → after |
| --- | --- | --- | --- |
| shipping.ts | 50000 → 70000 | 60000 | 0 → 3000 |
| trial.ts | 14 → 30 | 14 | false → true |
| discount.ts | 0.1 → 0.15 | 10000, true | 1000 → 1500 |

Also try an unchanged case. For shipping, 70000 remains free. For trial, day 30 remains outside the trial. For discounts, a non-member remains at zero. These are synthetic product rules, not business recommendations. Negative shipping or trial inputs produce an unavailable result with the thrown error; unavailable is never treated as a pass.
