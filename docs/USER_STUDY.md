# First-use observation protocol

This is a prepared protocol, not a completed study. There are no enrolled participants or measured results yet. The goal is to test whether nondevelopers can understand a small code change and carry it into their own work. Product decisions and threshold targets remain in [PRODUCT.md](PRODUCT.md).

## Recruit and prepare

Start with five consenting people who have used AI to create a JS/TS app but do not regularly read source code. Explain that the product is being tested, not the participant. They may stop at any time. Use an anonymous participant ID; do not put names, contact details, private code or recordings in this public repository.

Offer one browser example first. Record which example was used and any help provided. Do not show the expected answer or tell participants where to click before they attempt the task. Observers should avoid interpreting a hesitant “yes” as understanding.

## Task A: a shipping rule

Prompt: “Orders of 50,000 or more currently ship free. Change the rule so that free shipping starts at 70,000. Before applying, explain what happens to an order of 60,000 and one of 70,000. Apply the change and return to the original rule.”

Observer checks: the participant identifies the correct rule; predicts 60,000 changes from 0 to 3,000 and 70,000 stays 0; checks the displayed comparison; applies; undoes. Record each check separately, the time from the task prompt, help count and the participant's explanation in their own words. A correct final number alone does not prove understanding.

## Task B: a React button

Prompt: “Change the sign-up button from ‘무료로 시작하기’ to ‘14일 무료 체험’. Explain which membership condition chooses this button, inspect the proposed source change, apply it and undo it.”

Observer checks: the participant locates the non-member/falsy branch, finds the button text, understands that the displayed tree is source structure rather than a running screen, reviews the string-expression diff and can undo. Do not count use of the shortcut alone as finding the condition independently.

## Then try a real task

Invite the participant to choose one small change in a project they are allowed to use. They may work on their own device without sharing the source. Record the intended change, whether the language/construct is supported, where they stop, and whether the participant can explain what changed. Keep this result separate from example-task completion. No real task chosen is “not attempted,” not a failure or success.

Ask: “What was confusing?”, “What would you do next without this tool?”, and “Would you choose it again for a specific task?” If they agree to a follow-up, ask after seven days whether they used it again and for what. Do not substitute an intention to return for actual reuse.

## Record and decide

Use the empty [observation sheet](user-study-observations.csv). Keep completed, stuck, unsupported and not-attempted outcomes explicit. Add evidence or an observer note for each result. With five people, report counts and examples; do not generalize percentages to the market or claim causality.

The first decision is the most frequent blocking step: comprehension, finding a rule, reviewing changes, installation, unsupported syntax or applying to a real project. Fix that step before broadening language support. Community posting and participant outreach require the maintainer's explicit choice of destination; the prepared [launch text](LAUNCH.md) has not been sent automatically.
