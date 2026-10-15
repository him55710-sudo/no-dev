# Read and edit React interface source

Pureobom 0.5 adds a source structure view for JSX/TSX in both VS Code and the browser. It reads elements, component references, text, props, conditional expressions and simple `map` callbacks. Every displayed node links to its source line. It does not load React, import project packages or execute project code.

Try [the interactive example](https://him55710-sudo.github.io/pureobom/?demo=interface&lang=en), or run **Pureobom: Edit React interface text** in VS Code. Open the non-member branch, expand the button, select its text, enter a new phrase, inspect the diff, apply, and undo. The browser also has a shortcut to the example's button text.

![The public React example with a text change ready to apply](interface-preview-ko.png)

## What the structure means

- These are source fragments, not a screenshot or a prediction of the final DOM. CSS, runtime values, control flow outside a fragment and component internals can change what appears. Multiple roots need not appear together.
- Native HTML tags have readable roles. Custom components show only the props and children passed at the call site; their implementation is not guessed.
- `condition ? a : b` keeps both named branches. `&&`, `||` and `??` describe value selection; `&&` does not incorrectly promise that a falsy value always disappears. In React, a numeric zero can appear.
- A direct call in `onClick={submit()}` runs while constructing JSX; `onClick={submit}` passes a value; `onClick={() => submit()}` passes a function. Custom `onSomething` props are not asserted to be native browser events.
- Simple expression-bodied `map` callbacks expand. Block-bodied callbacks remain explicitly linked to source, because flattening their returns would lose control flow. A custom object's `map` is not assumed to behave like `Array.map`.
- Spread props remain visible and may override earlier props. Runtime values are not invented.

React semantics references: [conditional rendering](https://react.dev/learn/conditional-rendering) and [responding to events](https://react.dev/learn/responding-to-events).

## Text edits

Static JSX text and quoted attributes are decoded using TypeScript 5.9's JSX compiler. The analyzer compiles a bounded array of literal probes and reads emitted string literals as data; it never executes the result. This preserves entity decoding and JSX whitespace normalization, including significant inline spaces.

Changing `Join` in `<button>Join</button>` to `Start trial` produces `<button>{"Start trial"}</button>`. A quoted attribute becomes a string expression in the same way. The new string remains editable after reanalysis. Brackets, markup and quotes in user-entered text stay string data. This prevents a phrase from accidentally becoming a new element or JavaScript expression.

Only the anchored literal range changes. Existing syntax checks, explicit diff/apply, original-source checks and editor undo still apply. These checks do not prove runtime behavior, accessibility or application correctness. JSX-bearing functions are excluded from the restricted calculation simulator.

## Bounds

The structure has a roughly 300-node / 12-level display budget per file and at most 500 literal decoding probes. Omitted/deeper structure is explicitly marked. Complex expressions link to source. No JSX rendering, component execution, cross-component expansion, CSS interpretation, hook/state simulation or whole-screen generation is provided.

Coverage is exercised in `tests/jsx.test.ts` and a real VS Code integration flow that opens TSX, follows its source, prepares a text diff, applies, reanalyzes and undoes it. Actual nondeveloper comprehension remains to be measured.
