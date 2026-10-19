import { runAgentHost } from "./agent/host";

const [root, storage] = process.argv.slice(2);
if (!root || !storage) throw Error("Missing implementation host location");
void runAgentHost(root, storage).catch((error: NodeJS.ErrnoException) => {
  // Concurrent launch: the winning process owns the endpoint. Clients attach to it.
  if (error.code !== "EADDRINUSE") console.error(error.message);
  process.exitCode = error.code === "EADDRINUSE" ? 0 : 1;
});
