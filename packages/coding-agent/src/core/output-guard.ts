interface StdoutTakeoverState {
	rawStdoutWrite: (chunk: string, callback?: (error?: Error | null) => void) => boolean;
	rawStderrWrite: (chunk: string, callback?: (error?: Error | null) => void) => boolean;
	originalStdoutWrite: typeof process.stdout.write;
	originalConsole: {
		log: typeof console.log;
		info: typeof console.info;
		debug: typeof console.debug;
		dir: typeof console.dir;
	};
}

let stdoutTakeoverState: StdoutTakeoverState | undefined;

export function takeOverStdout(): void {
	if (stdoutTakeoverState) {
		return;
	}

	const rawStdoutWrite = process.stdout.write.bind(process.stdout) as StdoutTakeoverState["rawStdoutWrite"];
	const rawStderrWrite = process.stderr.write.bind(process.stderr) as StdoutTakeoverState["rawStderrWrite"];
	const originalStdoutWrite = process.stdout.write;

	process.stdout.write = ((
		chunk: string | Uint8Array,
		encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
		callback?: (error?: Error | null) => void,
	): boolean => {
		if (typeof encodingOrCallback === "function") {
			return rawStderrWrite(String(chunk), encodingOrCallback);
		}
		return rawStderrWrite(String(chunk), callback);
	}) as typeof process.stdout.write;

	// Some runtimes (notably Bun) implement console.log/info/debug/dir natively and
	// write directly to the stdout file descriptor, bypassing the patched
	// process.stdout.write above. Redirect the stdout-bound console methods to
	// stderr (via console.error, which formats identically) so non-interactive
	// modes keep real stdout clean for machine-readable output across runtimes.
	const originalConsole = {
		log: console.log.bind(console),
		info: console.info.bind(console),
		debug: console.debug.bind(console),
		dir: console.dir.bind(console),
	};
	const errorConsole = console.error.bind(console);
	console.log = ((...args: unknown[]): void => {
		errorConsole(...args);
	}) as typeof console.log;
	console.info = ((...args: unknown[]): void => {
		errorConsole(...args);
	}) as typeof console.info;
	console.debug = ((...args: unknown[]): void => {
		errorConsole(...args);
	}) as typeof console.debug;
	console.dir = ((...args: unknown[]): void => {
		errorConsole(...args);
	}) as typeof console.dir;

	stdoutTakeoverState = {
		rawStdoutWrite,
		rawStderrWrite,
		originalStdoutWrite,
		originalConsole,
	};
}

export function restoreStdout(): void {
	if (!stdoutTakeoverState) {
		return;
	}

	process.stdout.write = stdoutTakeoverState.originalStdoutWrite;
	console.log = stdoutTakeoverState.originalConsole.log;
	console.info = stdoutTakeoverState.originalConsole.info;
	console.debug = stdoutTakeoverState.originalConsole.debug;
	console.dir = stdoutTakeoverState.originalConsole.dir;
	stdoutTakeoverState = undefined;
}

export function isStdoutTakenOver(): boolean {
	return stdoutTakeoverState !== undefined;
}

export function writeRawStdout(text: string): void {
	if (stdoutTakeoverState) {
		stdoutTakeoverState.rawStdoutWrite(text);
		return;
	}
	process.stdout.write(text);
}

export async function flushRawStdout(): Promise<void> {
	if (stdoutTakeoverState) {
		await new Promise<void>((resolve, reject) => {
			stdoutTakeoverState?.rawStdoutWrite("", (err) => {
				if (err) reject(err);
				else resolve();
			});
		});
		return;
	}

	await new Promise<void>((resolve, reject) => {
		process.stdout.write("", (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}
