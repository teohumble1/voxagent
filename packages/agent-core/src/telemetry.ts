import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  SimpleSpanProcessor,
  type SpanExporter,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

/**
 * Exporter gọn: in mỗi span 1 dòng (tên + thời lượng + vài thuộc tính chính).
 * Dễ đọc hơn ConsoleSpanExporter mặc định, hợp cho dev local.
 */
class CompactConsoleExporter implements SpanExporter {
  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    for (const span of spans) {
      const ms = (span.duration[0] * 1e3 + span.duration[1] / 1e6).toFixed(0);
      const model = span.attributes["ai.model.id"] ?? "";
      const fn = span.attributes["ai.telemetry.functionId"] ?? "";
      const tokens = span.attributes["ai.usage.totalTokens"];
      const extras = [fn && `fn=${fn}`, model && `model=${model}`, tokens && `tokens=${tokens}`]
        .filter(Boolean)
        .join(" ");
      console.error(`  📊 ${span.name} (${ms}ms)${extras ? " " + extras : ""}`);
    }
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Nếu có LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY thì gửi trace lên Langfuse
 * qua endpoint OTLP của Langfuse (Basic auth). Không có key thì trả null.
 */
function langfuseExporter(): SpanExporter | null {
  const pub = process.env.LANGFUSE_PUBLIC_KEY;
  const secret = process.env.LANGFUSE_SECRET_KEY;
  if (!pub || !secret) return null;

  const host = process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com";
  const auth = Buffer.from(`${pub}:${secret}`).toString("base64");
  return new OTLPTraceExporter({
    url: `${host}/api/public/otel/v1/traces`,
    headers: { Authorization: `Basic ${auth}` },
  });
}

let provider: NodeTracerProvider | null = null;

/**
 * Khởi tạo tracing một lần cho tiến trình. Trả về hàm shutdown() để flush trace
 * trước khi thoát. Bật bằng cách gọi trước khi chạy agent.
 */
export function initTelemetry(serviceName = "voxagent"): () => Promise<void> {
  if (provider) return () => provider!.shutdown();

  const exporters: SpanExporter[] = [];
  const lf = langfuseExporter();
  if (lf) {
    exporters.push(lf);
    console.error("  🔭 telemetry -> Langfuse");
  } else {
    exporters.push(new CompactConsoleExporter());
    console.error("  🔭 telemetry -> console (đặt LANGFUSE_* để gửi lên Langfuse)");
  }

  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    spanProcessors: exporters.map((e) => new SimpleSpanProcessor(e)),
  });
  provider.register();

  return () => provider!.shutdown();
}

/** Đã bật telemetry chưa (để truyền experimental_telemetry.isEnabled). */
export function telemetryEnabled(): boolean {
  return provider !== null;
}
