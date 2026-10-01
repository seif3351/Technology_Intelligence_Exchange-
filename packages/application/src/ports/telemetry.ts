/**
 * Minimal instrumentation port so use cases can report spans and metrics
 * without depending on a telemetry SDK. Implemented by @atx/observability.
 */
export type TelemetryAttributes = Readonly<Record<string, string | number | boolean>>;

export interface Telemetry {
  span<T>(name: string, attributes: TelemetryAttributes, work: () => Promise<T>): Promise<T>;
  recordDuration(metric: string, milliseconds: number, attributes: TelemetryAttributes): void;
  increment(metric: string, attributes: TelemetryAttributes): void;
}

export const noopTelemetry: Telemetry = {
  span: (_name, _attributes, work) => work(),
  recordDuration: () => undefined,
  increment: () => undefined,
};
