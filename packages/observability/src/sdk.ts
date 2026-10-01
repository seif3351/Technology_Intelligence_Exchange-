import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

let sdk: NodeSDK | null = null;

/**
 * Starts the OpenTelemetry SDK when an OTLP endpoint is configured. Without
 * one, the API is a no-op and the application runs unchanged (local default).
 * Locally, `docker compose --profile observability up` provides a collector.
 */
export const startTelemetry = (options: { readonly serviceName: string; readonly namespace: string; readonly otlpEndpoint: string | undefined }): void => {
  if (!options.otlpEndpoint || sdk) return;
  const base = options.otlpEndpoint.replace(/\/$/, '');
  sdk = new NodeSDK({
    resource: resourceFromAttributes({ 'service.name': options.serviceName, 'service.namespace': options.namespace }),
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }), exportIntervalMillis: 15_000 })],
  });
  sdk.start();
};

export const stopTelemetry = async (): Promise<void> => {
  await sdk?.shutdown();
  sdk = null;
};

