import { type Attributes, SpanStatusCode, metrics, trace } from '@opentelemetry/api';
import type { Telemetry } from '@atx/application';

const tracer = trace.getTracer('atx');
const meter = metrics.getMeter('atx');
const histograms = new Map<string, ReturnType<typeof meter.createHistogram>>();
const counters = new Map<string, ReturnType<typeof meter.createCounter>>();


/** OpenTelemetry-backed implementation of the application Telemetry port. */
export const openTelemetry: Telemetry = {
  span(name, attributes, work) {
    return tracer.startActiveSpan(name, { attributes: attributes as Attributes }, async (span) => {
      try {
        return await work();
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  },
  recordDuration(metric, milliseconds, attributes) {
    let histogram = histograms.get(metric);
    if (!histogram) {
      histogram = meter.createHistogram(metric, { unit: 'ms' });
      histograms.set(metric, histogram);
    }
    histogram.record(milliseconds, attributes as Attributes);
  },
  increment(metric, attributes) {
    let counter = counters.get(metric);
    if (!counter) {
      counter = meter.createCounter(metric);
      counters.set(metric, counter);
    }
    counter.add(1, attributes as Attributes);
  },
};
