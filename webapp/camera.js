// Camera inputs connect directly to the device; there is no PC video relay.
function normalizeVisionSource(source) {
  if (source == null) return { type: "webcam" };
  if (!source || typeof source !== "object") throw new Error("Camera source must be an object");
  if (source.type === "webcam") return { type: "webcam" };
  if (source.type !== "esp32_stream")
    throw new Error("Camera source must be webcam or esp32_stream");
  const value = source.url ?? "";
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("ESP32 camera URL must be a string");
  if (!value.trim()) return { type: "esp32_stream", url: "" };
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("ESP32 camera URL must be http://CAMERA_IP/stream");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error("Use an HTTP/HTTPS camera URL without credentials or fragment");
  if (url.pathname === "/") url.pathname = "/stream";
  return { type: "esp32_stream", url: url.href };
}

// Direct MJPEG input shared by editor previews and standalone CNN widgets.
function createEsp32FrameSource(canvas, update) {
  let controller = null,
    generation = 0,
    lastFrame = 0,
    active = false;
  let retryTimer,
    wakeRetry,
    rejectInitial,
    ownerKey = "";
  const maxBytes = 5 * 1024 * 1024;
  // Coordinate viewers in this browser page, without relaying any video.
  const owners = (globalThis.__phyvibeCameraStreams ||= new Map());
  const owner = { stop: (reason) => stop(reason) };

  function releaseOwner() {
    if (owners.get(ownerKey) === owner) owners.delete(ownerKey);
  }
  function stop(reason) {
    ++generation;
    active = false;
    lastFrame = 0;
    controller?.abort();
    controller = null;
    clearTimeout(retryTimer);
    wakeRetry?.();
    wakeRetry = null;
    const cancelled = new Error(reason || "카메라 연결을 중지했습니다.");
    cancelled.name = "AbortError";
    rejectInitial?.(cancelled);
    rejectInitial = null;
    releaseOwner();
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    if (reason) update(cancelled, { state: "paused" });
  }
  function permanent(message) {
    const error = new Error(message);
    error.retryable = false;
    return error;
  }

  return {
    get active() {
      return active;
    },
    get ready() {
      return active && lastFrame > 0 && Date.now() - lastFrame < 5000;
    },
    stop,
    async start(url) {
      stop();
      const token = generation;
      ownerKey = new URL(url).href;
      owners.get(ownerKey)?.stop("다른 카메라 창으로 연결을 전환했습니다.");
      owners.set(ownerKey, owner);
      active = true;
      let resolved = false,
        totalFrames = 0,
        failures = 0;
      let resolveInitial;
      const initial = new Promise((resolve, reject) => {
        resolveInitial = resolve;
        rejectInitial = reject;
      });
      initial.catch(() => {});

      async function receive(current) {
        let reader,
          timer,
          queuedFrame = null,
          decoding = false,
          receiving = true;
        let firstFrame = true,
          badImages = 0;
        function watchdog() {
          clearTimeout(timer);
          timer = setTimeout(() => current.abort(new Error("ESP32 영상 수신 시간 초과")), 10000);
        }
        async function decodeLatest() {
          decoding = true;
          try {
            while (queuedFrame && token === generation && receiving && !current.signal.aborted) {
              const bytes = queuedFrame;
              queuedFrame = null;
              let image;
              try {
                image = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
              } catch {
                // A single bad JPEG should not drop an otherwise healthy stream.
                if (++badImages >= 3)
                  throw new Error("ESP32 이미지 수신 오류가 반복되어 다시 연결합니다.");
                continue;
              }
              try {
                if (token !== generation || !receiving || current.signal.aborted) return;
                badImages = 0;
                if (canvas.width !== image.width) canvas.width = image.width;
                if (canvas.height !== image.height) canvas.height = image.height;
                canvas.getContext("2d").drawImage(image, 0, 0);
                lastFrame = Date.now();
                failures = 0;
                const resumed = resolved && firstFrame;
                firstFrame = false;
                ++totalFrames;
                if (!resolved) {
                  resolved = true;
                  rejectInitial = null;
                  resolveInitial();
                }
                update(null, {
                  state: "connected",
                  resumed,
                  frames: totalFrames,
                  width: image.width,
                  height: image.height,
                });
              } finally {
                image.close();
              }
            }
          } catch (error) {
            current.abort(error);
          } finally {
            decoding = false;
          }
        }
        try {
          watchdog();
          const response = await fetch(url, {
            mode: "cors",
            credentials: "omit",
            cache: "no-store",
            signal: current.signal,
          });
          if (!response.ok) {
            const message = `ESP32 HTTP ${response.status}`;
            if (response.status >= 400 && response.status < 500) throw permanent(message);
            throw new Error(message);
          }
          if (
            !response.headers
              .get("Content-Type")
              ?.toLowerCase()
              .startsWith("multipart/x-mixed-replace")
          )
            throw permanent("MJPEG /stream 주소를 확인하세요.");
          if (!response.body) throw permanent("이 브라우저는 스트림 읽기를 지원하지 않습니다.");
          reader = response.body.getReader();
          let pending = new Uint8Array(0);
          while (token === generation && active) {
            watchdog();
            const { value, done } = await reader.read();
            if (done) throw new Error("ESP32 카메라 연결이 종료되었습니다.");
            const joined = new Uint8Array(pending.length + value.length);
            joined.set(pending);
            joined.set(value, pending.length);
            pending = joined;
            while (pending.length) {
              let start = -1,
                end = -1;
              for (let i = 0; i + 1 < pending.length; i++)
                if (pending[i] === 255 && pending[i + 1] === 216) {
                  start = i;
                  break;
                }
              if (start < 0) {
                pending = pending.slice(-1);
                break;
              }
              if (start) pending = pending.slice(start);
              for (let i = 2; i + 1 < pending.length; i++)
                if (pending[i] === 255 && pending[i + 1] === 217) {
                  end = i + 2;
                  break;
                }
              if ((end < 0 ? pending.length : end) > maxBytes)
                throw permanent("ESP32 이미지가 너무 큽니다.");
              if (end < 0) break;
              queuedFrame = pending.slice(0, end);
              pending = pending.slice(end);
            }
            if (!decoding && queuedFrame) void decodeLatest();
          }
        } finally {
          receiving = false;
          queuedFrame = null;
          clearTimeout(timer);
          current.abort();
          try {
            await reader?.cancel();
          } catch {}
        }
      }

      (async () => {
        while (active && token === generation) {
          const current = new AbortController();
          controller = current;
          update(null, { state: "connecting", retry: resolved || failures > 0 });
          try {
            await receive(current);
          } catch (error) {
            if (!active || token !== generation) return;
            lastFrame = 0;
            const message =
              error instanceof TypeError
                ? "ESP32 연결 실패: IP, 펌웨어 CORS, 로컬 네트워크 권한을 확인하세요."
                : error.message;
            ++failures;
            if (error.retryable === false || (!resolved && failures >= 3)) {
              active = false;
              releaseOwner();
              rejectInitial?.(new Error(message));
              rejectInitial = null;
              update(new Error(message), { state: "error" });
              return;
            }
            const delay = Math.min(5000, 1000 * 2 ** (failures - 1));
            update(new Error(message), { state: "retrying", delay });
            await new Promise((resolve) => {
              wakeRetry = resolve;
              retryTimer = setTimeout(resolve, delay);
            });
            wakeRetry = null;
          }
        }
      })().catch((error) => {
        if (token !== generation) return;
        active = false;
        lastFrame = 0;
        releaseOwner();
        rejectInitial?.(error);
        rejectInitial = null;
        update(error, { state: "error" });
      });
      await initial;
    },
  };
}
