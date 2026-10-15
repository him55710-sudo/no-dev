# Security and privacy

Pureobom 0.3 is a preview. The analysis and scenario interpreter run locally. There are no analytics SDKs, account requirements or AI API calls in the application. Loading a hosted demo still sends ordinary asset requests to its hosting provider; this is separate from source-code analysis.

The browser stores an imported workspace in IndexedDB on the current origin. `?demo=shipping` skips reading and writing that saved workspace. Use a separate browser profile on shared computers, or clear this site's storage when finished. Imported-file ZIPs contain only included files, not a complete project backup. Reports contain displayed file names, inputs and outputs and should be reviewed before sharing.

VS Code uses its own editor, save and undo behavior. Changes require a trusted workspace. Applying a patch edits the buffer and does not automatically save. The extension rejects patches and comparisons from stale document contexts. Computation has operation and recursion limits and runs in a terminable worker. This is a restricted interpreter, not a sandbox for executing arbitrary JavaScript.

To report a vulnerability, use the repository's **Security → Report a vulnerability** when private vulnerability reporting has been enabled. Until then, open a minimal issue asking for a private contact route without including exploit details, credentials or private code. The release checklist includes enabling that route before a public launch. We do not claim a response-time SLA or completed external audit.

Supported maintenance line: the latest 0.3 preview. Older local prototypes are not a supported release line.
