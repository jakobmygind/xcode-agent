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
export declare function parseBuildOutput(output: string): BuildOutput;
/**
 * Xcode build wrapper with streaming output
 */
export declare class XcodeBuilder extends EventEmitter {
    private repoPath;
    private currentProcess;
    constructor(repoPath: string);
    /**
     * Run xcodebuild with streaming output
     */
    build(scheme?: string, destination?: string): Promise<BuildOutput>;
    /**
     * Run tests with streaming output
     */
    test(scheme?: string, destination?: string): Promise<BuildOutput>;
    /**
     * Kill current build process
     */
    kill(): void;
    /**
     * Infer scheme from project
     */
    private inferScheme;
}
//# sourceMappingURL=xcode.d.ts.map