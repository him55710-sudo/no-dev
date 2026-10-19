import { spawn } from "node:child_process";
import { resolve } from "node:path";

// Windows libuv jobs deliberately allow descendants to break away. A separate
// non-inheritable job, without breakaway flags, owns this entire invocation.
// Job-list assignment is atomic with creation, including if this wrapper dies.
// Windows PowerShell/.NET are OS components; no runtime download or policy change.
const windowsScope = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:PUREOBOM_PROCESS_SCOPE)) | ConvertFrom-Json
  [Environment]::SetEnvironmentVariable('PUREOBOM_PROCESS_SCOPE', $null, 'Process')
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class PureobomProcessScope {
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long ProcessTime, JobTime;
    public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters {
    public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public BasicLimits Basic;
    public IoCounters Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
    public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
  }
  [StructLayout(LayoutKind.Sequential)] struct Startup {
    public uint Size;
    public IntPtr Reserved, Desktop, Title;
    public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
    public ushort Show, ReservedSize;
    public IntPtr ReservedBytes, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
    public IntPtr Process, Thread;
    public uint ProcessId, ThreadId;
  }
  [StructLayout(LayoutKind.Sequential)] struct StartupEx {
    public Startup Startup;
    public IntPtr Attributes;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting info, uint size, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool InitializeProcThreadAttributeList(IntPtr attributes, int count, uint flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool UpdateProcThreadAttribute(IntPtr attributes, uint flags, IntPtr kind, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr attributes);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes,
    IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string cwd,
    ref StartupEx startup, out ProcessInfo info);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  // The CommandLineToArgvW/CRT escaping rule; no shell interpolation.
  static string Quote(string value) {
    if (value.Length > 0 && value.IndexOfAny(new char[] {' ', '\t', '\n', '\r', '"'}) < 0) return value;
    var text = new StringBuilder("\"");
    int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      text.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
      text.Append(c); slashes = 0;
    }
    return text.Append('\\', slashes * 2).Append('"').ToString();
  }
  public static int Run(string executable, string[] args, string cwd) {
    IntPtr job = IntPtr.Zero;
    IntPtr attributes = IntPtr.Zero, jobList = IntPtr.Zero;
    bool attributesReady = false;
    var process = new ProcessInfo();
    bool assigned = false;
    try {
      job = CreateJobObjectW(IntPtr.Zero, null);
      Check(job != IntPtr.Zero);
      var limits = new ExtendedLimits();
      limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, no breakaway.
      Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)));
      IntPtr size = IntPtr.Zero;
      InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
      Check(size != IntPtr.Zero);
      attributes = Marshal.AllocHGlobal(size);
      Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref size));
      attributesReady = true;
      jobList = Marshal.AllocHGlobal(IntPtr.Size);
      Marshal.WriteIntPtr(jobList, job);
      Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000d), jobList,
        new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero)); // JOB_LIST (Windows 10+)
      var startup = new StartupEx();
      startup.Attributes = attributes;
      startup.Startup.Size = (uint)Marshal.SizeOf(startup);
      startup.Startup.Flags = 0x100; // STARTF_USESTDHANDLES
      startup.Startup.Input = GetStdHandle(-10); startup.Startup.Output = GetStdHandle(-11); startup.Startup.Error = GetStdHandle(-12);
      var command = new StringBuilder(Quote(executable));
      foreach (string arg in args) command.Append(' ').Append(Quote(arg));
      Check(CreateProcessW(null, command, IntPtr.Zero, IntPtr.Zero, true,
        0x08080004, IntPtr.Zero, cwd, ref startup, out process)); // NO_WINDOW | EXTENDED_STARTUPINFO | SUSPENDED
      assigned = true;
      Check(ResumeThread(process.Thread) != UInt32.MaxValue);
      Check(WaitForSingleObject(process.Process, UInt32.MaxValue) == 0);
      uint code; Check(GetExitCodeProcess(process.Process, out code));
      // Even a successful launcher can leave descendants holding files or pipes.
      Check(TerminateJobObject(job, 125));
      var deadline = DateTime.UtcNow.AddSeconds(5);
      while (true) {
        Accounting info;
        Check(QueryInformationJobObject(job, 1, out info, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
        if (info.ActiveProcesses == 0) break;
        if (DateTime.UtcNow >= deadline) throw new Exception("Process scope termination was not confirmed.");
        Thread.Sleep(10);
      }
      return unchecked((int)code);
    } finally {
      // A failed assignment never resumes the suspended child. Use its owned
      // handle, never a persisted PID that could now identify a different process.
      if (!assigned && process.Process != IntPtr.Zero) {
        TerminateProcess(process.Process, 125);
        WaitForSingleObject(process.Process, 5000);
      }
      if (job != IntPtr.Zero) CloseHandle(job);
      if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
      if (process.Process != IntPtr.Zero) CloseHandle(process.Process);
      if (attributesReady) DeleteProcThreadAttributeList(attributes);
      if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
      if (jobList != IntPtr.Zero) Marshal.FreeHGlobal(jobList);
    }
  }
}
'@
  $code = [PureobomProcessScope]::Run($config.executable, [string[]]$config.args, $config.cwd)
  [Environment]::Exit($code)
} catch {
  [Console]::Error.WriteLine('Pureobom process scope: ' + $_.Exception.Message)
  [Environment]::Exit(125)
}
`;

/** Own one invocation and its Windows descendants, including detached children. */
export function spawnOwnedProcess(
  executable: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
) {
  const windows = process.platform === "win32";
  const env = options.env ?? process.env;
  return spawn(
    windows
      ? resolve(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32/WindowsPowerShell/v1.0/powershell.exe",
        )
      : executable,
    windows
      ? [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-InputFormat",
          "Text",
          "-OutputFormat",
          "Text",
          "-EncodedCommand",
          Buffer.from(windowsScope, "utf16le").toString("base64"),
        ]
      : args,
    {
      cwd: options.cwd,
      env: windows
        ? {
            ...env,
            PUREOBOM_PROCESS_SCOPE: Buffer.from(
              JSON.stringify({ executable, args, cwd: options.cwd }),
            ).toString("base64"),
          }
        : env,
      windowsHide: true,
      shell: false,
      detached: !windows,
      stdio: "pipe",
    },
  );
}
