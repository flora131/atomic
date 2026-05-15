import * as fs from "node:fs";
import * as path from "node:path";

export function writeAtomicJson(filePath: string, payload: object): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tempPath = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
	);
	try {
		fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf-8");
		fs.renameSync(tempPath, filePath);
	} finally {
		fs.rmSync(tempPath, { force: true });
	}
}
