# Security and privacy

Pureobom 0.3 is a preview. The analysis and scenario interpreter run locally. There are no analytics SDKs, account requirements or AI API calls in the application. Loading a hosted demo still sends ordinary asset requests to its hosting provider; this is separate from source-code analysis.

The browser stores an imported workspace in IndexedDB on the current origin. `?demo=shipping` skips reading and writing that saved workspace. Use a separate browser profile on shared computers, or clear this site's storage when finished. Imported-file ZIPs contain only included files, not a complete project backup. Reports contain displayed file names, inputs and outputs and should be reviewed before sharing.

VS Code uses its own editor, save and undo behavior. Changes require a trusted workspace. Applying a patch edits the buffer and does not automatically save. The extension rejects patches and comparisons from stale document contexts. Computation has operation and recursion limits and runs in a terminable worker. This is a restricted interpreter, not a sandbox for executing arbitrary JavaScript.

To report a vulnerability, use [Security → Report a vulnerability](https://github.com/him55710-sudo/pureobom/security/advisories/new). Private vulnerability reporting is enabled. Do not put credentials or private source in public issues. We do not claim a response-time SLA or completed external audit.

Custom project terms are also local data: browser workspace IndexedDB, or VS Code workspace state keyed by document URI. Untitled-document terms are not persisted across extension sessions. Terms can appear in explanation reports, so avoid private business labels in reports you intend to share. Code ZIP exports do not include the local term dictionary.

Supported maintenance line: the latest 0.4 preview. Older local prototypes are not a supported release line.
