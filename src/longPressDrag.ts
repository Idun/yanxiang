/**
 * Long-press pointer drag.
 *
 * Native HTML5 drag-and-drop can only be armed at `mousedown` time, so an
 * element must be `draggable="true"` up front — which permanently kills text
 * selection inside it. That is why dragging an AI reply used to either do
 * nothing (only the small grip handle was draggable) or run away selecting the
 * rest of the conversation.
 *
 * This helper implements the gesture users actually expect:
 *
 *   press and hold still  ->  drag the element
 *   press and move at once ->  normal text selection
 *
 * Nothing is armed until the press survives `delay` ms without moving more than
 * `moveTolerance` px. Once armed we take over: the current selection is dropped,
 * selection is disabled document-wide, and a ghost follows the cursor until
 * mouseup.
 */

export interface LongPressDragOptions {
  /** The originating mousedown. */
  event: MouseEvent;
  /** Hold duration before the drag arms. Default 200ms. */
  delay?: number;
  /** Movement (px) before the arming timer is cancelled. Default 5. */
  moveTolerance?: number;
  /** Text shown inside the floating ghost. */
  ghostLabel: string;
  /** Optional extra CSS for the ghost. */
  ghostVariant?: "card" | "row";
  /** Fired once the gesture arms. */
  onStart?: () => void;
  /** Fired on every move while armed. */
  onMove?: (x: number, y: number, event: MouseEvent) => void;
  /** Fired on mouseup while armed. */
  onDrop?: (x: number, y: number, event: MouseEvent) => void;
  /** Fired when the gesture ends for any reason (after onDrop). */
  onEnd?: () => void;
}

const GHOST_BASE =
  "position:fixed;pointer-events:none;z-index:10000;padding:7px 12px;border-radius:8px;" +
  "font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 10px 28px rgba(15,23,42,0.24);" +
  "transform:translate(10px,10px);transition:opacity .12s ease;";

function createGhost(label: string, variant: "card" | "row"): HTMLDivElement {
  const ghost = document.createElement("div");
  ghost.textContent = label;
  const skin =
    variant === "card"
      ? "background:#ffffff;border:2px solid var(--primary,#43588c);color:var(--primary,#43588c);"
      : "background:var(--primary,#43588c);border:1px solid var(--primary,#43588c);color:#ffffff;";
  ghost.style.cssText = GHOST_BASE + skin;
  document.body.appendChild(ghost);
  return ghost;
}

/**
 * Begin tracking a potential long-press drag. Safe to call directly from a
 * `@mousedown` handler; it self-cleans on mouseup / Escape / blur.
 */
export function startLongPressDrag(options: LongPressDragOptions): void {
  const {
    event,
    delay = 200,
    moveTolerance = 5,
    ghostLabel,
    ghostVariant = "card",
    onStart,
    onMove,
    onDrop,
    onEnd,
  } = options;

  if (event.button !== 0) return;

  const startX = event.clientX;
  const startY = event.clientY;

  let armed = false;
  let ghost: HTMLDivElement | null = null;
  let timer: number | null = null;
  let previousUserSelect = "";
  let previousCursor = "";

  function arm() {
    timer = null;
    armed = true;

    /* Drop whatever the browser selected during the hold, then stop it from
       selecting anything else for the rest of the gesture. */
    window.getSelection()?.removeAllRanges();
    previousUserSelect = document.body.style.userSelect;
    previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";

    ghost = createGhost(ghostLabel, ghostVariant);
    ghost.style.left = `${startX}px`;
    ghost.style.top = `${startY}px`;

    onStart?.();
  }

  function onMouseMove(e: MouseEvent) {
    if (!armed) {
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if (dx > moveTolerance || dy > moveTolerance) {
        /* The user is selecting text, not dragging — stand down. */
        cleanup();
      }
      return;
    }

    e.preventDefault();
    if (ghost) {
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
    }
    onMove?.(e.clientX, e.clientY, e);
  }

  function onMouseUp(e: MouseEvent) {
    const wasArmed = armed;
    const x = e.clientX;
    const y = e.clientY;

    /* Tear down listeners + ghost first, but keep the caller's drag state
       intact: `onDrop` still needs the payload / hovered target, and `onEnd`
       is what clears them. Order matters — running onEnd before onDrop made
       every drop see already-cleared state. */
    teardown();

    if (!wasArmed) {
      finishGesture();
      return;
    }

    onDrop?.(x, y, e);
    finishGesture();

    /* Swallow the click that follows a completed drag. */
    const swallow = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") cleanup();
  }

  /** Remove listeners, ghost and global style overrides. */
  function teardown() {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    window.removeEventListener("mousemove", onMouseMove, true);
    window.removeEventListener("mouseup", onMouseUp, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("blur", cleanup);

    if (ghost) {
      ghost.remove();
      ghost = null;
    }
    if (armed) {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    }
  }

  /** Release the caller's drag state exactly once. */
  function finishGesture() {
    if (!armed) return;
    armed = false;
    onEnd?.();
  }

  /** Cancel path (moved too early / Escape / blur): no drop is committed. */
  function cleanup() {
    teardown();
    finishGesture();
  }

  timer = window.setTimeout(arm, delay);

  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("mouseup", onMouseUp, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("blur", cleanup);
}
