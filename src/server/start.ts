/* eslint-disable max-statements */
import nodePath from "node:path";
import { pathToFileURL } from "node:url";

import createDebug from "debug";
import Handlebars from "handlebars";
import { createHttpTerminator, type HttpTerminator } from "http-terminator";
import yaml from "js-yaml";
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import { koaSwagger } from "koa2-swagger-ui";

import { readFile } from "../util/read-file.js";
import { counterfact } from "./counterfact.js";

const debug = createDebug("counterfact:server:start");

// eslint-disable-next-line @typescript-eslint/init-declarations
let httpTerminator: HttpTerminator | undefined;

// eslint-disable-next-line no-underscore-dangle, total-functions/no-partial-url-constructor
const __dirname = nodePath.dirname(new URL(import.meta.url).pathname);

const DEFAULT_PORT = 3100;

Handlebars.registerHelper("escape_route", (route: string) =>
  route.replaceAll(/[^\w/]/gu, "-"),
);

function openapi(openApiPath: string, url: string) {
  return async (ctx: Koa.ExtendableContext, next: Koa.Next) => {
    if (ctx.URL.pathname === "/counterfact/openapi") {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const openApiDocument = (await yaml.load(
        await readFile(openApiPath),
      )) as {
        host?: string;
        servers?: { description: string; url: string }[];
      };

      openApiDocument.servers ??= [];

      openApiDocument.servers.unshift({
        description: "Counterfact",
        url,
      });

      // OpenApi 2 support:
      openApiDocument.host = url;

      // eslint-disable-next-line require-atomic-updates
      ctx.body = yaml.dump(openApiDocument);

      return;
    }

    // eslint-disable-next-line  n/callback-return
    await next();
  };
}

function page(
  pathname: string,
  templateName: string,
  locals: { [key: string]: unknown },
) {
  return async (ctx: Koa.ExtendableContext, next: Koa.Next) => {
    const render = Handlebars.compile(
      await readFile(
        nodePath.join(__dirname, `../client/${templateName}.html.hbs`),
      ),
    );

    if (ctx.URL.pathname === pathname) {
      ctx.body = render(locals);

      return;
    }

    // eslint-disable-next-line  n/callback-return
    await next();
  };
}

export async function start(config: {
  basePath: string;
  openApiPath: string;
  port: number;
}) {
  const {
    basePath = process.cwd().replaceAll("\\", "/"),
    openApiPath = nodePath
      .join(basePath, "../openapi.yaml")
      .replaceAll("\\", "/"),
    port = DEFAULT_PORT,
  } = config;

  const app = new Koa();

  const { contextRegistry, koaMiddleware, registry } = await counterfact(
    basePath,
    openApiPath,
    config,
  );

  app.use(openapi(openApiPath, `//localhost:${port}`));

  app.use(
    koaSwagger({
      routePrefix: "/counterfact/swagger",

      swaggerOptions: {
        url: "/counterfact/openapi",
      },
    }),
  );

  debug("basePath: %s", basePath);
  debug("routes", registry.routes);

  app.use(
    page("/counterfact/", "index", {
      basePath,
      methods: ["get", "post", "put", "delete", "patch"],

      openApiHref: openApiPath.includes("://")
        ? openApiPath
        : pathToFileURL(openApiPath).href,

      openApiPath,

      routes: registry.routes,
    }),
  );

  app.use(async (ctx, next) => {
    if (ctx.URL.pathname === "/counterfact") {
      ctx.redirect("/counterfact/");

      return;
    }

    if (ctx.URL.pathname === "/counterfact/stop") {
      debug("Stopping server...");
      await httpTerminator?.terminate();
      debug("Server stopped.");

      return;
    }

    // eslint-disable-next-line  n/callback-return
    await next();
  });

  app.use(
    page("/counterfact/rapidoc", "rapi-doc", {
      basePath,
      routes: registry.routes,
    }),
  );

  app.use(bodyParser());

  app.use(koaMiddleware);

  const server = app.listen({
    port,
  });

  httpTerminator = createHttpTerminator({
    server,
  });

  return { contextRegistry };
}
