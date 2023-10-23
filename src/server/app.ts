import nodePath from "node:path";

import { createHttpTerminator, type HttpTerminator } from "http-terminator";
import yaml from "js-yaml";
import $RefParser from "json-schema-ref-parser";

import { readFile } from "../util/read-file.js";
import type { Config } from "./config.js";
import { ContextRegistry } from "./context-registry.js";
import { createKoaApp } from "./create-koa-app.js";
import { Dispatcher, type OpenApiDocument } from "./dispatcher.js";
import { koaMiddleware } from "./koa-middleware.js";
import { ModuleLoader } from "./module-loader.js";
import { Registry } from "./registry.js";
import { Transpiler } from "./transpiler.js";

// eslint-disable-next-line @typescript-eslint/init-declarations
let httpTerminator: HttpTerminator | undefined;

async function loadOpenApiDocument(source: string) {
  try {
    const text = await readFile(source);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const openApiDocument = (await yaml.load(text)) as $RefParser.JSONSchema;

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return (await $RefParser.dereference(openApiDocument)) as OpenApiDocument;
  } catch {
    return undefined;
  }
}

// eslint-disable-next-line max-statements
export async function counterfact(config: Config) {
  const openApiDocument = await loadOpenApiDocument(config.openApiPath);

  const modulesPath = config.basePath;

  const compiledPathsDirectory = nodePath
    .join(modulesPath, ".cache")
    .replaceAll("\\", "/");

  const registry = new Registry();

  const contextRegistry = new ContextRegistry();

  const dispatcher = new Dispatcher(registry, contextRegistry, openApiDocument);

  const transpiler = new Transpiler(
    nodePath.join(modulesPath, "paths").replaceAll("\\", "/"),
    compiledPathsDirectory,
  );

  const moduleLoader = new ModuleLoader(
    compiledPathsDirectory,
    registry,
    contextRegistry,
  );

  async function startCounterfact() {
    await transpiler.watch();
    await moduleLoader.load();
    await moduleLoader.watch();
  }

  async function stopCounterfact() {
    await transpiler.stopWatching();
    await moduleLoader.stopWatching();
  }

  const middleware = koaMiddleware(dispatcher, config);

  const app = createKoaApp(registry, middleware, config);

  async function start() {
    await startCounterfact();

    const server = app.listen({
      port: config.port,
    });

    httpTerminator = createHttpTerminator({
      server,
    });
  }

  async function stop() {
    await stopCounterfact();
    await httpTerminator?.terminate();
  }

  return {
    contextRegistry,
    koaMiddleware: middleware,
    start,
    stop,
  };
}
