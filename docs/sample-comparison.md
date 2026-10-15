# Pureobom · Change impact

File: src/shipping.ts · Function: calculateShipping

Free shipping threshold: 50000 → 70000

| Case | Inputs | Before | After | Result |
| --- | --- | --- | --- | --- |
| 1 | &#91;60000&#93; | 0 | 3000 | Changed |
| 2 | &#91;49999&#93; | 3000 | 3000 | Same |
| 3 | &#91;50000&#93; | 0 | 3000 | Changed |
| 4 | &#91;50001&#93; | 0 | 3000 | Changed |
| 5 | &#91;69999&#93; | 0 | 3000 | Changed |
| 6 | &#91;70000&#93; | 0 | 0 | Same |
| 7 | &#91;70001&#93; | 0 | 0 | Same |

Results from a limited AST interpreter, for these inputs only. This is not an app execution, type check or regression suite. Unavailable cases are not passes.

This document contains the displayed file name, inputs and outputs. Review it before sharing. Nothing is automatically uploaded or published.

Made with Pureobom · Read it. Change it. Check it.
