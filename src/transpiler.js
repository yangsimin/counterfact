import { once } from "node:events";
import fs from "node:fs/promises";
import nodePath from "node:path";
import { constants as fsConstants } from "node:fs";

import ts from "typescript";
import chokidar from "chokidar";

async function ensureDirectoryExists(filePath) {
  const directory = nodePath.dirname(filePath);

  try {
    await fs.access(directory, fsConstants.W_OK);
  } catch {
    await fs.mkdir(directory, { recursive: true });
  }
}

export class Transpiler extends EventTarget {
  constructor(sourcePath, destinationPath) {
    super();
    this.sourcePath = sourcePath;
    this.destinationPath = destinationPath;
  }

  async watch() {
    this.watcher = chokidar.watch(`${this.sourcePath}/**/*.{js,mjs,ts,mts}`);

    await once(this.watcher, "ready");

    this.dispatchEvent(new Event("write"));

    this.watcher.on("all", async (eventName, sourcePath) => {
      const destinationPath = sourcePath
        .replace(this.sourcePath, this.destinationPath)
        .replace(".ts", ".js");

      if (["add", "change"].includes(eventName)) {
        this.transpileFile(eventName, sourcePath, destinationPath);
      }

      if (eventName === "unlink") {
        try {
          await fs.rm(destinationPath);
        } catch (error) {
          if (error.code !== "ENOENT") {
            throw error;
          }
        }

        this.dispatchEvent(new Event("delete"));
      }
    });
  }

  async transpileFile(eventName, sourcePath, destinationPath) {
    await ensureDirectoryExists(destinationPath);

    const source = await fs.readFile(sourcePath, "utf8");

    const result = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ES2022 },
    }).outputText;

    await fs.writeFile(
      nodePath.join(
        sourcePath
          .replace(this.sourcePath, this.destinationPath)
          .replace(".ts", ".js")
      ),
      result
    );

    this.dispatchEvent(new Event("write"));
  }
}
