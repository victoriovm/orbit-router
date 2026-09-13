// Stream handler with disconnect detection - shared for all providers
import { STREAM_STALL_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { SSE_HEARTBEAT } from "./sseConstants.js";
import { dbg, isDebugEnabled } from "./debugLog.js";

const heartbeatBytes = new TextEncoder().encode(SSE_HEARTBEAT);

// Get HH:MM:SS timestamp
function getTimeString() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Create stream controller with abort and disconnect detection
 * @param {object} options
 * @param {function} options.onDisconnect - Callback when client disconnects
 * @param {object} options.log - Logger instance
 * @param {string} options.provider - Provider name
 * @param {string} options.model - Model name
 */
export function createStreamController({ onDisconnect, onError, log, provider, model, reqTag = "" } = {}) {
  const abortController = new AbortController();
  const startTime = Date.now();
  let disconnected = false;
  let abortTimeout = null;

  // Only abnormal terminations are logged; normal completion is covered by "📊 done".
  // isError uses errorLine (always shown, ignores LOG_LEVEL) so failures survive quiet levels.
  const logStream = (symbol, status, isError = false) => {
    const duration = Date.now() - startTime;
    const emit = isError ? log?.errorLine : log?.line;
    if (emit) emit(reqTag, symbol, `${status} · ${provider}/${model} · ${duration}ms`);
    else console.log(`[${getTimeString()}] ${symbol} ${provider}/${model} · ${status} · ${duration}ms`);
  };

  return {
    signal: abortController.signal,
    startTime,

    isConnected: () => !disconnected,

    // Call when client disconnects
    handleDisconnect: (reason = "client_closed") => {
      if (disconnected) return;
      disconnected = true;

      // Debug-only: Responses API has no [DONE] sentinel, so codex/droid close the
      // socket on every completed request. "📊 done" is the authoritative outcome line.
      dbg("CTRL", `${provider}/${model} | disconnect=${reason} | dur=${Date.now() - startTime}ms`);

      // Delay abort to allow cleanup
      abortTimeout = setTimeout(() => {
        abortController.abort();
      }, 500);

      onDisconnect?.({ reason, duration: Date.now() - startTime });
    },

    // Call when stream completes normally (no line here — "📊 done" is authoritative)
    handleComplete: () => {
      if (disconnected) return;
      disconnected = true;

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }
    },

    // Call on error
    handleError: (error) => {
      if (disconnected) return;
      disconnected = true;

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }

      if (error.name === "AbortError") {
        logStream("⚡", "ABORTED");
        return;
      }

      logStream("✗", `ERROR: ${error.message}${error.stack ? `\n    ${error.stack}` : ""}`, true);
      onError?.(error);
    },

    abort: (reason) => abortController.abort(reason)
  };
}

/**
 * Create transform stream with disconnect detection
 * Wraps existing transform stream and adds abort capability.
 *
 * Stall detection lives in pipeWithDisconnect (tied to upstream byte
 * activity), not here — output of the transform stream may be silent
 * for long periods while raw bytes still flow (e.g. Kiro EventStream
 * binary frames buffering, Claude reasoning streams).
 */
export function createDisconnectAwareStream(transformStream, streamController, onAbortTerminal = null, options = {}) {
  const reader = transformStream.readable.getReader();
  const writer = transformStream.writable.getWriter();
  const heartbeatMs = options.heartbeatMs ?? 0;
  // Muse Spark requests opt in to surfacing mid-stream failures as transport
  // errors; everything else keeps the legacy graceful-close contract.
  const surfaceErrors = options.surfaceMidStreamErrors === true;
  let terminalEmitted = false;
  let pendingRead = null;
  let heartbeatTimer = null;

  // Emit a synthesized terminal payload (e.g. Responses response.failed + [DONE]) once
  const emitTerminal = (controller) => {
    if (terminalEmitted || !onAbortTerminal) return;
    terminalEmitted = true;
    try {
      const bytes = onAbortTerminal();
      if (bytes) controller.enqueue(bytes);
    } catch { /* best-effort terminal */ }
  };

  // Shared terminal path for pulls that find the controller already finished.
  // Muse Spark (surfaceErrors): client disconnects close quietly, upstream
  // failures (stalls, logged errors) surface a transport error so clients
  // retry. Everyone else keeps the legacy emit-terminal + graceful close.
  // Plain controllers without pipe metadata (unit stubs) also close.
  const finishDownstream = (controller) => {
    emitTerminal(controller);
    const hasPipeInfo = typeof streamController.isStalled === "function";
    if (!surfaceErrors || !hasPipeInfo) {
      controller.close();
      return;
    }
    const clientGone = streamController.isClientGone?.() === true;
    const stalled = streamController.isStalled?.() === true;
    if (clientGone) {
      controller.close();
    } else if (stalled) {
      try {
        controller.error(streamController.stallError?.() || new Error("stream stall timeout"));
      } catch { /* already closed or cancelled */ }
    } else {
      try {
        controller.error(streamController.lastError?.() || new Error("stream disconnected"));
      } catch { /* already closed or cancelled */ }
    }
  };

  const clearHeartbeat = () => {
    if (heartbeatTimer) { clearTimeout(heartbeatTimer); heartbeatTimer = null; }
  };

  return new ReadableStream({
    async pull(controller) {
      if (!streamController.isConnected()) {
        // Stall watchdog marks the controller disconnected before aborting the
        // fetch, so a plain isConnected check would turn stalls into clean EOF.
        finishDownstream(controller);
        return;
      }

      try {
        // Keep a single pending upstream read across pulls so heartbeat waits
        // never drop data: the race below only decides whether to emit a
        // `: ping` comment while upstream reasoning stays silent.
        if (!pendingRead) pendingRead = reader.read();
        const result = heartbeatMs > 0
          ? await Promise.race([
            pendingRead.then(
              (r) => ({ kind: "data", ...r }),
              (e) => ({ kind: "error", error: e }),
            ),
            new Promise((resolve) => {
              heartbeatTimer = setTimeout(() => resolve({ kind: "heartbeat" }), heartbeatMs);
            }),
          ])
          : await pendingRead.then(
            (r) => ({ kind: "data", ...r }),
            (e) => ({ kind: "error", error: e }),
          );
        clearHeartbeat();

        if (result.kind === "heartbeat") {
          // Upstream silent for heartbeatMs — keep middleboxes (nginx/CF/NAT)
          // from killing the idle downstream without touching pendingRead.
          heartbeatTimer = null;
          if (!streamController.isConnected()) {
            finishDownstream(controller);
            return;
          }
          controller.enqueue(heartbeatBytes);
          return;
        }
        pendingRead = null;

        if (result.kind === "error") throw result.error;
        const { done, value } = result;

        if (done) {
          streamController.handleComplete();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        const wasConnected = streamController.isConnected();
        // Controller already closed = downstream ended; not an upstream error, skip noisy log.
        const msg0 = error?.message || "";
        const isControllerClosed = msg0.includes("already closed") || msg0.includes("Invalid state");
        if (!isControllerClosed) streamController.handleError(error);
        reader.cancel().catch(() => {});
        writer.abort().catch(() => {});
        pendingRead = null;
        clearHeartbeat();

        // Treat network resets / socket hang up / abort as graceful close
        const msg = error?.message || "";
        const code = error?.code || error?.cause?.code || "";
        const isNetworkClose =
          error.name === "AbortError" ||
          msg.includes("aborted") ||
          msg.includes("socket hang up") ||
          msg.includes("ECONNRESET") ||
          msg.includes("ETIMEDOUT") ||
          msg.includes("EPIPE") ||
          code === "ECONNRESET" ||
          code === "ETIMEDOUT" ||
          code === "EPIPE" ||
          code === "UND_ERR_SOCKET";
        // Stall watchdog aborts the fetch after handleError already marked the
        // controller disconnected — still a mid-stream failure, never a clean EOF.
        // Prefer the explicit stall flag (abort reasons don't reliably propagate
        // to the body-stream error message) with message sniffing as fallback.
        const isStall = msg.includes("stall timeout") || streamController.isStalled?.() === true;

        // Legacy path (every non-Muse-Spark request): network resets / aborts
        // close quietly, and a structured terminal (Responses response.failed)
        // still emits before closing.
        // Muse Spark (surfaceErrors): the client being gone is the only quiet
        // path; any other mid-stream upstream failure surfaces as a transport
        // error (after the error terminal) so SDKs retry the truncated turn.
        try {
          if (!surfaceErrors) {
            if (!wasConnected || isNetworkClose || onAbortTerminal) {
              emitTerminal(controller);
              controller.close();
            } else {
              controller.error(error);
            }
          } else if (!wasConnected && !isStall) {
            emitTerminal(controller);
            controller.close();
          } else {
            emitTerminal(controller);
            controller.error(error);
          }
        } catch (e) { /* already closed or cancelled */ }
      }
    },

    cancel(reason) {
      pendingRead = null;
      clearHeartbeat();
      streamController.handleDisconnect(reason || "cancelled");
      reader.cancel();
      writer.abort();
    }
  });
}

/**
 * Pipe provider response through transform with disconnect detection.
 *
 * Stall watchdog tracks raw upstream byte activity, not transform output.
 * Reasoning models (Claude thinking via Kiro, etc.) can produce zero SSE
 * output for long stretches while partial EventStream frames keep arriving.
 * Measuring stall on the transform output caused false stalls and the
 * "failed to pipe response" error in Next.
 *
 * Any upstream chunk resets the timer. If no bytes arrive for
 * STREAM_STALL_TIMEOUT_MS, abort the underlying fetch via the controller.
 * An optional time-to-first-byte timer catches hangs during prompt prefill,
 * where the stall timer alone would wait the full inter-chunk budget before
 * noticing nothing ever arrived.
 *
 * @param {Response} providerResponse - Response from provider
 * @param {TransformStream} transformStream - Transform stream for SSE
 * @param {object} streamController - Stream controller from createStreamController
 * @param {function} [onAbortTerminal] - Synthesized terminal payload builder
 * @param {number} [stallTimeoutMs] - Inter-chunk stall budget
 * @param {object} [options]
 * @param {number} [options.heartbeatMs] - Downstream `: ping` interval while silent (0 disables)
 * @param {number} [options.firstChunkTimeoutMs] - Time-to-first-byte budget (0 disables)
 * @param {boolean} [options.surfaceMidStreamErrors] - Emit transport errors for
 *   mid-stream upstream failures instead of closing gracefully (Muse Spark)
 */
export function pipeWithDisconnect(providerResponse, transformStream, streamController, onAbortTerminal = null, stallTimeoutMs = STREAM_STALL_TIMEOUT_MS, options = {}) {
  const heartbeatMs = options.heartbeatMs ?? 0;
  const firstChunkTimeoutMs = options.firstChunkTimeoutMs ?? 0;
  let stallTimer = null;
  let firstChunkTimer = null;
  let chunkCount = 0;
  let totalBytes = 0;
  let lastChunkAt = Date.now();
  let stallFired = false;
  let stallError = null;
  let clientGone = false;
  let lastError = null;
  const t0 = Date.now();
  const tag = "STREAM";
  const clearStall = () => {
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
  };
  const clearFirstChunk = () => {
    if (firstChunkTimer) { clearTimeout(firstChunkTimer); firstChunkTimer = null; }
  };
  const fireTimeout = (kind, budgetMs) => {
    stallFired = true;
    stallError = new Error(kind === "ttft" ? "stream first-chunk timeout (ttft)" : "stream stall timeout");
    dbg(tag, `TIMEOUT ${kind}=${budgetMs}ms | chunks=${chunkCount} | bytes=${totalBytes} | sinceLast=${Date.now() - lastChunkAt}ms`);
    streamController.handleError?.(stallError);
    streamController.abort?.(stallError);
  };
  const armStall = () => {
    clearStall();
    stallTimer = setTimeout(() => {
      stallTimer = null;
      clearFirstChunk();
      fireTimeout("stall", stallTimeoutMs);
    }, stallTimeoutMs);
  };

  // Wrap controller so every termination path clears the stall timer.
  // Without this, abort/cancel/downstream-error paths leave the timer armed
  // and a stale abort could fire after the request has already ended.
  const wrappedController = {
    signal: streamController.signal,
    startTime: streamController.startTime,
    isConnected: () => streamController.isConnected(),
    isStalled: () => stallFired,
    stallError: () => stallError,
    isClientGone: () => clientGone,
    lastError: () => lastError,
    handleComplete: () => { dbg(tag, `complete | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); clearFirstChunk(); streamController.handleComplete(); },
    handleError: (e) => { dbg(tag, `error: ${e?.message} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); lastError = e; clearStall(); clearFirstChunk(); streamController.handleError(e); },
    handleDisconnect: (r) => { dbg(tag, `disconnect: ${r} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clientGone = true; clearStall(); clearFirstChunk(); streamController.handleDisconnect(r); },
    abort: (reason) => { clearStall(); clearFirstChunk(); streamController.abort(reason); }
  };

  armStall();
  if (firstChunkTimeoutMs > 0) {
    firstChunkTimer = setTimeout(() => {
      firstChunkTimer = null;
      if (chunkCount === 0) {
        clearStall();
        fireTimeout("ttft", firstChunkTimeoutMs);
      }
    }, firstChunkTimeoutMs);
  }
  dbg(tag, `pipe start | stallTimeout=${stallTimeoutMs}ms | ttftTimeout=${firstChunkTimeoutMs}ms | heartbeat=${heartbeatMs}ms`);

  const upstreamTap = new TransformStream({
    transform(chunk, controller) {
      chunkCount++;
      const sz = chunk?.byteLength || chunk?.length || 0;
      totalBytes += sz;
      const now = Date.now();
      const gap = now - lastChunkAt;
      lastChunkAt = now;
      if (isDebugEnabled && (chunkCount <= 5 || chunkCount % 20 === 0 || gap > 5000)) {
        dbg(tag, `chunk #${chunkCount} | size=${sz}B | gap=${gap}ms | total=${totalBytes}B`);
      }
      if (chunkCount === 1) clearFirstChunk();
      armStall();
      controller.enqueue(chunk);
    },
    flush() { dbg(tag, `upstream EOF | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); clearFirstChunk(); }
  });

  const transformedBody = providerResponse.body
    .pipeThrough(upstreamTap)
    .pipeThrough(transformStream);

  return createDisconnectAwareStream(
    { readable: transformedBody, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
    wrappedController,
    onAbortTerminal,
    { heartbeatMs, surfaceMidStreamErrors: options.surfaceMidStreamErrors }
  );
}

