import nodePath from "node:path";

import prettier from "prettier";

import type { Coder } from "./coder";
import type { Repository } from "./repository";

interface Export {
  name?: string;
  id: string;
  done: boolean;
  isType: boolean;
  isDefault: boolean;
  typeDeclaration: unknown;
  beforeExport: string;
  promise?: Promise<Coder>;
  code?: string & { raw?: string };
  error?: unknown;
}

interface Import {
  name?: string;
}

export class Script {
  private readonly repository: Repository;

  private readonly exports: Map<string, Export>;

  private readonly imports: Map<string, Import>;

  private readonly externalImports: Map<string, Import>;

  private readonly cache: Map<string, string>;

  private readonly typeCache: Map<string, unknown>;

  private readonly path: string;

  public constructor(repository: Repository, path: string) {
    this.repository = repository;
    this.exports = new Map();
    this.imports = new Map();
    this.externalImports = new Map();
    this.cache = new Map();
    this.typeCache = new Map();
    this.path = path;
  }

  public firstUniqueName(coder: Coder): string {
    for (const name of coder.names()) {
      if (!this.imports.has(name) && !this.exports.has(name)) {
        return name;
      }
    }

    throw new Error(`could not find a unique name for ${coder.id}`);
  }

  public export(coder: Coder, isType = false, isDefault = false) {
    const cacheKey = isDefault ? "default" : `${coder.id}:${String(isType)}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const name = this.firstUniqueName(coder);

    this.cache.set(cacheKey, name);

    const exportStatement: Export = {
      id: coder.id,
      done: false,
      isType,
      isDefault,
      typeDeclaration: coder.typeDeclaration(this.exports, this),
      beforeExport: coder.beforeExport(this.path),
    };

    exportStatement.promise = coder
      .delegate()
      // eslint-disable-next-line promise/prefer-await-to-then
      .then((availableCoder) => {
        exportStatement.name = name;
        exportStatement.code = availableCoder.write(this);

        return availableCoder;
      })
      // eslint-disable-next-line promise/prefer-await-to-then
      .catch((error: unknown) => {
        exportStatement.code = `{/* error creating export "${name}" for ${this.path}: ${error.stack} */}`;
        exportStatement.error = error;
      })
      // eslint-disable-next-line promise/prefer-await-to-then
      .finally(() => {
        exportStatement.done = true;
      });

    this.exports.set(name, exportStatement);

    return name;
  }

  public exportDefault(coder: Coder, isType = false) {
    this.export(coder, isType, true);
  }

  public import(coder: Coder, isType = false, isDefault = false) {
    const modulePath: string = coder.modulePath();

    const cacheKey = `${coder.id}@${modulePath}:${String(isType)}:${String(
      isDefault
    )}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const name = this.firstUniqueName(coder);

    this.cache.set(cacheKey, name);

    const scriptFromWhichToExport = this.repository.get(modulePath);

    const exportedName = scriptFromWhichToExport.export(
      coder,
      isType,
      isDefault
    );

    this.imports.set(name, {
      script: scriptFromWhichToExport,
      name: exportedName,
      isType,
      isDefault,
    });

    return name;
  }

  public importType(coder: Coder) {
    return this.import(coder, true);
  }

  public importDefault(coder: Coder, isType = false) {
    return this.import(coder, isType, true);
  }

  public importExternal(name: string, modulePath: string, isType = false) {
    this.externalImports.set(name, { modulePath, isType });

    return name;
  }

  public importExternalType(name: string, modulePath: string) {
    return this.importExternal(name, modulePath, true);
  }

  public exportType(coder: Coder) {
    return this.export(coder, true);
  }

  public isInProgress() {
    return Array.from(this.exports.values()).some(
      (exportStatement) => !exportStatement.done
    );
  }

  private externalImportsStatements() {
    return Array.from(
      this.externalImports,
      ([name, { modulePath, isType, isDefault }]) =>
        `import${isType ? " type" : ""} ${
          isDefault ? name : `{ ${name} }`
        } from "${modulePath}";`
    );
  }

  private importStatements() {
    return Array.from(
      this.imports,
      ([name, { script, isType, isDefault }]) =>
        `import${isType ? " type" : ""} ${
          isDefault ? name : `{ ${name} }`
        } from "./${nodePath.relative(
          nodePath.dirname(this.path),
          script.path.replace(/\.ts$/u, ".js")
        )}";`
    );
  }

  private exportStatements() {
    return Array.from(
      this.exports.values(),
      ({
        name,
        isType,
        isDefault,
        code,
        typeDeclaration,
        beforeExport,
      }): string => {
        if (code?.raw !== undefined) {
          return code.raw;
        }

        if (isDefault) {
          return `${beforeExport}export default ${String(code)};`;
        }

        const keyword = isType ? "type" : "const";
        const typeAnnotation =
          typeDeclaration.length === 0 ? "" : `:${typeDeclaration}`;

        return `${beforeExport}export ${keyword} ${String(
          name
        )}${typeAnnotation} = ${String(code)};`;
      }
    );
  }

  public contents() {
    return prettier.format(
      [
        this.externalImportsStatements().join("\n"),
        this.importStatements().join("\n"),
        "\n\n",
        this.exportStatements().join("\n\n"),
      ].join(""),
      { parser: "typescript" }
    );
  }

  public async finished() {
    return await Promise.all(
      Array.from(this.exports.values(), async (value) => await value.promise)
    );
  }
}
