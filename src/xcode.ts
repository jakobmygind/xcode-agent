import { spawn } from "node-pty";
import { EventEmitter } from "events";

export interface XcodeError {
  file: string;
  line: number;
  column: number;
  message: string;
  type: "error" | "warning" | "note";
}

export interface BuildOutput {
  raw: string;
  errors: XcodeError[];
  success: boolean;
}

/**
 * Parse Xcode build output for errors and warnings
 */
export function parseBuildOutput(output: string): BuildOutput {
  const errors: XcodeError[] = [];
  const lines = output.split("\n");
  
  // Xcode error patterns
  const errorPattern = /^(.+):(\d+):(\d+):\s*(error|warning|note):\s*(.+)$/;
  
  for (const line of lines) {
    const match = line.match(errorPattern);
    if (match) {
      errors.push({
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        type: match[4] as "error" | "warning" | "note",
        message: match[5],
      });
    }
  }

  const success = !errors.some(e => e.type === "error");
  
  return {
    raw: output,
    errors,
    success,
  };
}

/**
 * Xcode build wrapper with streaming output
 */
export class XcodeBuilder extends EventEmitter {
  private repoPath: string;
  private currentProcess: any = null;

  constructor(repoPath: string) {
    super();
    this.repoPath = repoPath;
  }

  /**
   * Run xcodebuild with streaming output
   */
  async build(scheme?: string, destination?: string): Promise<BuildOutput> {
    const buildScheme = scheme || this.inferScheme();
    const buildDestination = destination || "platform=iOS Simulator,name=iPhone 15 Pro";
    
    const args = [
      "build",
      "-scheme", buildScheme,
      "-destination", buildDestination,
      "-quiet",
    ];

    this.emit("start", { scheme: buildScheme, destination: buildDestination });
    console.log(`[Xcode] Build started: ${buildScheme}`);

    return new Promise((resolve, reject) => {
      let output = "";
      
      this.currentProcess = spawn("xcodebuild", args, {
        cwd: this.repoPath,
        env: process.env as { [key: string]: string },
      });

      this.currentProcess.onData((data: string) => {
        output += data;
        this.emit("data", data);
        
        // Stream formatted output
        const lines = data.split("\n").filter(l => l.trim());
        for (const line of lines) {
          if (line.includes("error:")) {
            console.log(`[Xcode] ❌ ${line}`);
          } else if (line.includes("warning:")) {
            console.log(`[Xcode] ⚠️  ${line}`);
          } else {
            console.log(`[Xcode] ${line}`);
          }
        }
      });

      this.currentProcess.onExit((code: number) => {
        this.currentProcess = null;
        const result = parseBuildOutput(output);
        result.success = code === 0 && result.success;
        
        if (result.success) {
          console.log(`[Xcode] ✅ Build succeeded`);
        } else {
          console.log(`[Xcode] ❌ Build failed with ${result.errors.filter(e => e.type === "error").length} error(s)`);
        }
        
        this.emit("complete", result);
        resolve(result);
      });
    });
  }

  /**
   * Run tests with streaming output
   */
  async test(scheme?: string, destination?: string): Promise<BuildOutput> {
    const testScheme = scheme || this.inferScheme();
    const testDestination = destination || "platform=iOS Simulator,name=iPhone 15 Pro";
    
    const args = [
      "test",
      "-scheme", testScheme,
      "-destination", testDestination,
      "-quiet",
    ];

    this.emit("start", { scheme: testScheme, destination: testDestination, type: "test" });
    console.log(`[Xcode] Test started: ${testScheme}`);

    return new Promise((resolve) => {
      let output = "";
      
      this.currentProcess = spawn("xcodebuild", args, {
        cwd: this.repoPath,
        env: process.env as { [key: string]: string },
      });

      this.currentProcess.onData((data: string) => {
        output += data;
        this.emit("data", data);
        
        const lines = data.split("\n").filter(l => l.trim());
        for (const line of lines) {
          if (line.includes("failed")) {
            console.log(`[Xcode] ❌ ${line}`);
          } else if (line.includes("passed")) {
            console.log(`[Xcode] ✅ ${line}`);
          } else {
            console.log(`[Xcode] ${line}`);
          }
        }
      });

      this.currentProcess.onExit((code: number) => {
        this.currentProcess = null;
        const result = parseBuildOutput(output);
        result.success = code === 0;
        
        console.log(`[Xcode] Tests ${result.success ? "passed" : "failed"}`);
        this.emit("complete", result);
        resolve(result);
      });
    });
  }

  /**
   * Kill current build process
   */
  kill(): void {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
  }

  /**
   * Infer scheme from project
   */
  private inferScheme(): string {
    // Try to get scheme from project
    try {
      const { execSync } = require("child_process");
      const schemes = execSync("xcodebuild -list -json", {
        cwd: this.repoPath,
        encoding: "utf-8",
      });
      const parsed = JSON.parse(schemes);
      return parsed.project?.schemes?.[0] || parsed.workspace?.schemes?.[0] || "App";
    } catch {
      return "App";
    }
  }
}