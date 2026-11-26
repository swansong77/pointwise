import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
} from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { raw } from "express";
import { AllExceptionsFilter } from "./common/http-exception.filter";

/** Shared HTTP setup used by main.ts and the integration tests. */
export function configureApp(
  app: INestApplication,
  opts: { swagger?: boolean } = {},
): void {
  app.setGlobalPrefix("api/v1", {
    exclude: ["health", { path: "mcp", method: RequestMethod.ALL }],
  });
  // Behind the Next.js proxy / load balancer: use X-Forwarded-For from private networks so
  // per-IP rate limits apply to the real client, not the proxy.
  app
    .getHttpAdapter()
    .getInstance()
    .set("trust proxy", process.env.TRUST_PROXY ?? "loopback, uniquelocal");
  // byte-exact bodies where a signature / MIME message is verified (before Nest's JSON parser)
  app.use("/api/v1/inbound/email", raw({ type: () => true, limit: "15mb" }));
  app.use(
    "/api/v1/connections/plaid/webhook",
    raw({ type: () => true, limit: "1mb" }),
  );
  app.use(helmet());
  app.use(cookieParser());
  const origins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim());
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    maxAge: 600,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  if (opts.swagger) {
    const config = new DocumentBuilder()
      .setTitle("Pointwise API")
      .setDescription(
        "Credit-card rewards optimization API. All money values are integer cents.",
      )
      .setVersion("0.1.0")
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api/docs", app, doc, {
      jsonDocumentUrl: "api/docs-json",
    });
  }
}
