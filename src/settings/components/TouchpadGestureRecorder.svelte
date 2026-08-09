<script lang="ts">
    import { onMount, onDestroy, createEventDispatcher } from "svelte";
    import {
        subscribeTouchpadDiagnostics,
        getTouchpadDiagnostics,
        setTouchpadRecording,
        subscribeTouchpadRawFrames,
    } from "@/runtime/TouchpadRuntimeState";
    import type { TouchpadFrame } from "@/touchpad/types";
    import {
        TouchpadGestureTracker,
        DEFAULT_TRACKER_CONFIG,
        AUTO_RECORD_KINDS,
    } from "@/gesture/touchpad/recognition/TouchpadGestureTracker";
    import type {
        TouchpadTrackerConfig,
        TouchpadLiveState,
    } from "@/gesture/touchpad/recognition/TouchpadGestureTracker";
    import type {
        TouchpadGestureKind,
        TouchpadGestureSpec,
    } from "@/gesture/touchpad/types";
    import { MAX_TOUCHPAD_FINGERS } from "@/gesture/touchpad/types";
    import { touchpadDescriptorLabel, touchpadKindLabel } from "@/gesture/touchpad/labels";
    import {
        createReleaseGate,
        onGateFrame,
        canArmReleaseGate,
        RELEASE_QUIET_MS,
        type ReleaseGateState,
    } from "@/settings/touchpadRecorderGate";

    /**
     * Touchpad gesture recorder (settings).
     *
     * Consumes RAW provider frames via {@link subscribeTouchpadRawFrames}
     * (NOT the throttled diagnostics bus), so every frame — including
     * staggered releases and the final empty frame — reaches the recorder's
     * own Tracker.  Session states:
     *
     *   WAITING → RECORDING → DONE (frozen) → [重新录制/清除]
     *   WAITING → ERROR (finger-count mismatch) → release → WAITING
     *
     * The user only picks the finger count; the gesture KIND is auto-detected
     * by the Tracker ({@link AUTO_RECORD_KINDS}).  The finger count is fixed
     * (`requiredFingerCount`); the Tracker locks it and completes at the first
     * finger drop, so a 3→2→1 tail never pollutes the recorded gesture.
     * While mounted, the runtime's touchpad dispatch is paused.
     */

    export let i18n: Record<string, string>;
    /** Recognition thresholds (from the current touchpad config). */
    export let trackerConfig: Partial<TouchpadTrackerConfig> = {};
    /** Safe mode: only 3+ finger gestures may be recorded (default ON). */
    export let safeMode: boolean = true;

    const dispatch = createEventDispatcher<{
        update: { gesture: TouchpadGestureSpec };
        clear: Record<string, never>;
    }>();

    let fingerCount = 3;

    /** Surface coordinate space — 4:3, matching the pad container aspect ratio. */
    const PAD_W = 1200;
    const PAD_H = 900;

    /**
     * Explicit recording lifecycle:
     *
     *   DISARMED → [开始录制] → PREPARING → (release + quiet gate) → ARMED
     *   ARMED    → partial fingers → ACQUIRING → full count → RECORDING
     *   RECORDING → first drop → DONE (frozen)
     *   PREPARING/ARMED/ACQUIRING/RECORDING/ERROR/DONE → [重新录制] → PREPARING
     *   DONE     → [清除] → DISARMED
     *
     * While DISARMED no raw frame enters the tracker, so browsing the editor
     * or touching the touchpad never changes the draft.  `setTouchpadRecording`
     * is true only between PREPARING and DONE (the runtime gesture dispatch is
     * paused during that window).
     *
     * PREPARING → ARMED only after a CONFIRMED 0-contact frame plus the
     * {@link RELEASE_QUIET_MS} gate — never from frame inactivity alone (see
     * {@link ReleaseGateState}).
     */
    type SessionState =
        | "DISARMED"
        | "PREPARING"
        | "ARMED"
        | "ACQUIRING"
        | "RECORDING"
        | "DONE"
        | "ERROR"
        | "WAIT_RELEASE";
    let session: SessionState = "DISARMED";
    let message = "";
    let recorded: TouchpadGestureSpec | null = null;

    /** Latest physical contact count seen on ANY raw frame (incl. DISARMED). */
    let lastPhysicalContactCount = 0;
    /** Pure release-gate state while PREPARING. */
    let releaseGate: ReleaseGateState | null = null;

    // Live display data.
    let livePath: Array<{ x: number; y: number }> = [];
    let contactPaths: Array<{ id: number; points: Array<{ x: number; y: number }> }> = [];
    let liveContacts: Array<{ id: number; x: number; y: number }> = [];
    let liveAnchorIds: number[] = [];
    let liveMovingIds: number[] = [];
    let currentKind: TouchpadGestureKind | null = null;

    // Frozen result display.
    let finalPath: Array<{ x: number; y: number }> = [];
    let finalContactPaths: Array<{ id: number; points: Array<{ x: number; y: number }> }> = [];
    let finalAnchorIds: number[] = [];
    let finalMovingIds: number[] = [];

    let rawContacts = false;
    /** Authoritative hardware max (from the HID Feature report), 0 = unknown. */
    let hardwareMaxContacts = 0;
    let hardwareMaxKnown = false;
    let waitTimer: ReturnType<typeof setTimeout> | null = null;
    let prepareTimer: ReturnType<typeof setTimeout> | null = null;

    // Tracker is created explicitly — never rebuilt by Svelte reactivity.
    let tracker: TouchpadGestureTracker;

    function buildTracker(): TouchpadGestureTracker {
        return new TouchpadGestureTracker(
            {
                ...DEFAULT_TRACKER_CONFIG,
                ...trackerConfig,
                minFingerCount: fingerCount,
                requiredFingerCount: fingerCount,
            },
            new Set(AUTO_RECORD_KINDS),
        );
    }

    /** Minimum recordable finger count: 3 in safe mode, otherwise 1. */
    function minFingers(): number {
        return safeMode ? 3 : 1;
    }

    /**
     * Highest finger count the UI may offer.  Only the AUTHORITATIVE hardware
     * maximum (HID descriptor / Feature report) caps the options — the
     * observed max (what the user has done so far) never hides higher options.
     */
    function maxFingersFor(): number {
        if (hardwareMaxKnown) {
            return Math.max(1, Math.min(MAX_TOUCHPAD_FINGERS, hardwareMaxContacts));
        }
        // Hardware maximum unknown: safe-mode offers 3/4/5, otherwise 1–5.
        return 5;
    }

    /** Selectable finger counts (safe mode starts at 3). */
    $: fingerOptions = (() => {
        const min = minFingers();
        const max = maxFingersFor();
        const out: number[] = [];
        for (let f = min; f <= max; f++) out.push(f);
        if (out.length === 0) out.push(min);
        return out;
    })();

    function clampFingers(): void {
        const min = minFingers();
        const max = maxFingersFor();
        if (fingerCount < min) fingerCount = min;
        if (fingerCount > max) fingerCount = max;
    }

    function onFingerChange(e: Event): void {
        const v = Number((e.currentTarget as HTMLSelectElement).value);
        if (Number.isFinite(v)) {
            fingerCount = v;
            // Changing the finger count restarts the arming cycle.
            if (session !== "DISARMED") {
                startPreparing();
            }
        }
    }

    /** Reset to the initial disarmed state (no recording, no draft change). */
    function drainToDisarmed(): void {
        clearTimeout(waitTimer as ReturnType<typeof setTimeout> | undefined);
        clearTimeout(prepareTimer as ReturnType<typeof setTimeout> | undefined);
        waitTimer = null;
        prepareTimer = null;
        tracker = buildTracker();
        session = "DISARMED";
        message = "";
        livePath = [];
        contactPaths = [];
        liveContacts = [];
        liveAnchorIds = [];
        liveMovingIds = [];
        currentKind = null;
    }

    /** Enter PREPARING: pause runtime dispatch, wait for release + quiet gate. */
    function startPreparing(): void {
        clearTimeout(prepareTimer as ReturnType<typeof setTimeout> | undefined);
        prepareTimer = null;
        // A fresh tracker for the upcoming attempt.
        tracker = buildTracker();
        livePath = [];
        contactPaths = [];
        liveContacts = [];
        liveAnchorIds = [];
        liveMovingIds = [];
        currentKind = null;
        session = "PREPARING";
        message = i18n.tpRecorderPreparing ?? "请松开触控板上的所有手指…";
        setTouchpadRecording(true);
        // The gate only arms after a CONFIRMED 0-contact frame + quiet gate.
        releaseGate = createReleaseGate(lastPhysicalContactCount);
        if (releaseGate.zeroContactConfirmed) {
            armReleaseQuietTimer();
        }
    }

    /** (Re)start the 0-contact quiet gate countdown. */
    function armReleaseQuietTimer(): void {
        if (prepareTimer !== null) return;
        prepareTimer = setTimeout(() => {
            prepareTimer = null;
            if (session === "PREPARING" && releaseGate && canArmReleaseGate(releaseGate, RELEASE_QUIET_MS)) {
                arm();
            }
        }, RELEASE_QUIET_MS);
    }

    /** ARMED: touchpad input may now enter the tracker (fresh epoch). */
    function arm(): void {
        if (session !== "PREPARING") return;
        session = "ARMED";
        message = i18n.tpRecorderArmed ?? "可以开始手势";
        releaseGate = null;
        // Fresh epoch: the finger that pressed 开始 must never become a
        // pre-qualified anchor of the next gesture.
        tracker.resetAcquisitionHistory();
    }

    function armWaitTimer(): void {
        clearTimeout(waitTimer as ReturnType<typeof setTimeout> | undefined);
        if (session === "WAIT_RELEASE") {
            waitTimer = setTimeout(() => {
                if (session === "WAIT_RELEASE") {
                    session = "ARMED";
                    tracker = buildTracker();
                    message = i18n.tpRecorderArmed ?? "可以开始手势";
                }
            }, 600);
        }
    }

    // ------------------------------------------------------------- raw frames

    function onRawFrame(frame: TouchpadFrame): void {
        const contacts = frame.contacts.filter((c) => c.touching !== false);
        // Track the latest real physical state on EVERY frame (all states),
        // so 开始录制 knows whether fingers are actually down right now.
        lastPhysicalContactCount = contacts.length;

        // DISARMED: raw touchpad input must never enter the recorder.
        if (session === "DISARMED") {
            return;
        }
        if (session === "DONE") {
            return; // frozen — never overwrite a recorded result
        }
        if (session === "PREPARING") {
            // Only a CONFIRMED 0-contact frame may start the quiet gate; any
            // touch keeps cancelling it.  Inactivity alone never arms.
            releaseGate = onGateFrame(releaseGate ?? createReleaseGate(contacts.length), contacts.length);
            if (contacts.length > 0) {
                clearTimeout(prepareTimer as ReturnType<typeof setTimeout> | undefined);
                prepareTimer = null;
                message = i18n.tpRecorderPreparing ?? "请松开触控板上的所有手指…";
            } else {
                armReleaseQuietTimer();
            }
            return;
        }
        if (session === "WAIT_RELEASE") {
            if (contacts.length === 0) {
                clearTimeout(waitTimer as ReturnType<typeof setTimeout> | undefined);
                waitTimer = null;
                session = "ARMED";
                tracker = buildTracker();
                message = i18n.tpRecorderArmed ?? "可以开始手势";
            }
            return;
        }

        // ARMED / RECORDING / ERROR → feed the tracker (ERROR still drains).
        const result = tracker.feed(frame);
        const live = tracker.getLiveState();
        applyLive(live);

        if (live.mismatch === "too-many") {
            session = "ERROR";
            message = `${i18n.tpRecorderFingerMismatch ?? "需要"} ${fingerCount} ${i18n.tpFingers ?? "指"}`;
            return;
        }

        if (result) {
            if (result.valid && result.fingerCount === fingerCount) {
                const spec = buildSpec(result);
                if (spec) {
                    recorded = spec;
                    finalPath = live.displayPath.slice();
                    finalContactPaths = live.displayContactPaths.map((c) => ({
                        id: c.id,
                        points: c.points.map((p) => ({ x: p.x, y: p.y })),
                    }));
                    finalAnchorIds = live.displayAnchorIds.slice();
                    finalMovingIds = live.displayMovingIds.slice();
                    session = "DONE";
                    setTouchpadRecording(false);
                    message = touchpadDescriptorLabel(spec, i18n);
                    dispatch("update", { gesture: spec });
                    return;
                }
            }
            session = "ERROR";
            if (result.valid && result.fingerCount !== fingerCount) {
                message = i18n.tpRecorderFingerCountError ?? "手指数与所选不一致，请重试";
            } else {
                message = i18n.tpRecorderUnrecognised ?? "无法识别，请重试";
            }
            return;
        }

        // No completed result — map the tracker stage to a session state.
        if (live.runActive && live.lockedFingerCount === fingerCount) {
            session = "RECORDING";
            message = "";
        } else if (live.stage === "POSSIBLE" || live.stage === "TRACKING") {
            session = "RECORDING";
            message = "";
        } else if (live.stage === "WAIT_RELEASE") {
            session = "WAIT_RELEASE";
            armWaitTimer();
        } else if (live.stage === "IDLE" && live.contacts.length > 0) {
            // Some fingers are down but the target count is not yet reached.
            session = "ACQUIRING";
            message = "";
        } else {
            session = "ARMED";
            message = "";
        }
    }

    function applyLive(live: TouchpadLiveState): void {
        livePath = live.displayPath.slice();
        contactPaths = live.displayContactPaths.map((c) => ({
            id: c.id,
            points: c.points.map((p) => ({ x: p.x, y: p.y })),
        }));
        liveContacts = live.contacts
            .filter((c) => c.touching !== false)
            .map((c) => ({ id: c.id, x: c.x, y: c.y }));
        liveAnchorIds = live.displayAnchorIds.slice();
        liveMovingIds = live.displayMovingIds.slice();
        currentKind = live.currentKind;
    }

    function handleDiagnostics(diag: ReturnType<typeof getTouchpadDiagnostics>): void {
        if (diag.capabilities) {
            rawContacts = diag.capabilities.supportsRawContacts === true;
            // Use the AUTHORITATIVE hardware maximum (Feature report).  The
            // observed max is a diagnostic, not a cap.
            const hw = diag.capabilities.hardwareMaxContacts;
            if (diag.capabilities.maxContactsKnown && hw > 0) {
                hardwareMaxContacts = hw;
                hardwareMaxKnown = true;
                clampFingers();
            }
        }
    }

    function buildSpec(result: {
        kind: TouchpadGestureKind;
        fingerCount: number;
        directions: string[];
        anchorCount?: number;
        pinchDirection?: "in" | "out";
        rotateDirection?: "cw" | "ccw";
    }): TouchpadGestureSpec | null {
        switch (result.kind) {
            case "tap":
                return { kind: "tap", fingerCount: result.fingerCount };
            case "hold":
                return { kind: "hold", fingerCount: result.fingerCount };
            case "swipe":
                if (result.directions.length !== 1) return null;
                return { kind: "swipe", fingerCount: result.fingerCount, direction: result.directions[0] as never };
            case "shape":
                if (result.directions.length === 0) return null;
                return { kind: "shape", fingerCount: result.fingerCount, directions: result.directions as never };
            case "anchorDraw":
                if (result.directions.length === 0) return null;
                return {
                    kind: "anchorDraw",
                    fingerCount: result.fingerCount,
                    anchorCount: result.anchorCount ?? 1,
                    directions: result.directions as never,
                };
            case "pinch":
                if (!result.pinchDirection) return null;
                return { kind: "pinch", fingerCount: 2, direction: result.pinchDirection };
            case "rotate":
                if (!result.rotateDirection) return null;
                return { kind: "rotate", fingerCount: result.fingerCount, direction: result.rotateDirection };
            default:
                return null;
        }
    }

    // ------------------------------------------------------------------ life

    let unsubscribeDiag: (() => void) | null = null;
    let unsubscribeFrames: (() => void) | null = null;

    onMount(() => {
        // DISARMED: nothing is recorded and the runtime dispatch keeps working.
        setTouchpadRecording(false);
        tracker = buildTracker();
        const initial = getTouchpadDiagnostics();
        handleDiagnostics(initial);
        unsubscribeDiag = subscribeTouchpadDiagnostics(handleDiagnostics);
        unsubscribeFrames = subscribeTouchpadRawFrames(onRawFrame);
    });

    onDestroy(() => {
        setTouchpadRecording(false);
        clearTimeout(waitTimer as ReturnType<typeof setTimeout> | undefined);
        waitTimer = null;
        clearTimeout(prepareTimer as ReturnType<typeof setTimeout> | undefined);
        prepareTimer = null;
        if (unsubscribeDiag) {
            unsubscribeDiag();
            unsubscribeDiag = null;
        }
        if (unsubscribeFrames) {
            unsubscribeFrames();
            unsubscribeFrames = null;
        }
    });

    /** 重新录制: re-arm through the release + quiet gate (never clears draft). */
    function reRecord(): void {
        startPreparing();
    }

    /** Cancel a PREPARING cycle back to the disarmed state. */
    function cancelPreparing(): void {
        drainToDisarmed();
        setTouchpadRecording(false);
    }

    /** 清除: explicitly clear the current gesture draft and disarm. */
    function clearGesture(): void {
        recorded = null;
        finalPath = [];
        finalContactPaths = [];
        finalAnchorIds = [];
        finalMovingIds = [];
        drainToDisarmed();
        setTouchpadRecording(false);
        dispatch("clear", {});
    }

    function directionsOf(spec: TouchpadGestureSpec): string[] {
        if (spec.kind === "swipe") return [spec.direction];
        if (spec.kind === "shape" || spec.kind === "anchorDraw") return spec.directions;
        return [];
    }

    // Display trails (live during RECORDING, frozen after DONE).
    $: shownPath = session === "DONE" ? finalPath : livePath;
    $: shownContactPaths = session === "DONE" ? finalContactPaths : contactPaths;
    $: shownAnchorIds = session === "DONE" ? finalAnchorIds : liveAnchorIds;
    $: shownMovingIds = session === "DONE" ? finalMovingIds : liveMovingIds;
    // Trails only render once the full target finger count is acquired.
    $: showTrails = session === "RECORDING" || session === "DONE";
    // Dots: full set while recording; ONLY pre-qualified anchors during
    // acquisition (a moving single finger must never look like it is recording).
    $: dotsToShow = (() => {
        if (session === "RECORDING" || session === "DONE") return liveContacts;
        if (session === "ACQUIRING") return liveContacts.filter((c) => shownAnchorIds.includes(c.id));
        return [];
    })();
    $: mainTrailPoints = shownPath
        .map((p) => `${(p.x * PAD_W).toFixed(1)},${(p.y * PAD_H).toFixed(1)}`)
        .join(" ");
    $: fingerTrailPolylines = shownContactPaths
        .map(
            (c) =>
                c.points
                    .map((p) => `${(p.x * PAD_W).toFixed(1)},${(p.y * PAD_H).toFixed(1)}`)
                    .join(" "),
        );
</script>

<div class="gf-tp-recorder" data-gesture-flow-tp-recorder>
    <div class="gf-tp-recorder-controls">
        <label class="gf-tp-recorder-field">
            <span class="gf-tp-recorder-label">{i18n.tpRecorderFingers ?? "手指数"}</span>
            <select class="b3-select gf-tp-recorder-select" value={fingerCount} on:change={onFingerChange}>
                {#each fingerOptions as f (f)}
                    <option value={f}>{f}</option>
                {/each}
            </select>
        </label>
        {#if safeMode}
            <span class="gf-tp-recorder-hint">{i18n.tpSafeModeMinHint ?? "安全模式：仅支持 3 指及以上"}</span>
        {/if}
        <span class="gf-tp-recorder-hint">{i18n.tpRecorderAutoHint ?? "直接在触控板上执行任意手势"}</span>
    </div>

    <div class="gf-tp-recorder-pad">
        <svg
            class="gf-tp-recorder-trail"
            viewBox="0 0 {PAD_W} {PAD_H}"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
        >
            {#if showTrails}
                {#each fingerTrailPolylines as pts (pts)}
                    <polyline
                        points={pts}
                        fill="none"
                        stroke="var(--b3-theme-primary, #4285f4)"
                        stroke-width="3"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        opacity="0.6"
                    />
                {/each}
            {/if}
            {#if showTrails && mainTrailPoints}
                <polyline
                    points={mainTrailPoints}
                    fill="none"
                    stroke="var(--b3-theme-primary, #4285f4)"
                    stroke-width="8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    opacity="0.95"
                />
            {/if}
        </svg>
        {#if dotsToShow.length > 0}
            {#each dotsToShow as c (c.id)}
                {@const isAnchor = shownAnchorIds.includes(c.id)}
                {@const isMoving = shownMovingIds.includes(c.id)}
                <div
                    class="gf-tp-recorder-contact"
                    class:gf-tp-recorder-contact--anchor={isAnchor}
                    class:gf-tp-recorder-contact--moving={isMoving}
                    style={`left:${(c.x * 100).toFixed(1)}%;top:${(c.y * 100).toFixed(1)}%`}
                    title={`id=${c.id}`}
                >
                    <span class="gf-tp-recorder-contact-id">
                        {isAnchor ? "A" : isMoving ? "M" : c.id}
                    </span>
                </div>
            {/each}
        {/if}
        <span class="gf-tp-recorder-status">
            {#if session === "DISARMED"}
                {i18n.tpRecorderDisarmed ?? "点击「开始录制」后执行手势"}
            {:else if session === "PREPARING"}
                {message}
            {:else if session === "ARMED"}
                {message}
            {:else if session === "ACQUIRING"}
                {#if shownAnchorIds.length > 0}
                    {i18n.tpRecorderAnchorWait ?? "已识别固定指，等待其他手指加入"}
                {:else}
                    {i18n.tpRecorderDetected ?? "已检测"} {liveContacts.length} / {fingerCount} {i18n.tpFingers ?? "指"}
                {/if}
            {:else if session === "RECORDING"}
                {i18n.tpRecorderRecording ?? "录制中…请完成手势"}
            {:else if session === "ERROR"}
                {message}
            {:else if session === "DONE"}
                {message}
            {:else if session === "WAIT_RELEASE"}
                {i18n.tpRecorderWaitRelease ?? "正在释放手指…"}
            {/if}
        </span>
        <span class="gf-tp-recorder-live">
            {i18n.tpContactCount ?? "触点"}: {liveContacts.length}
            {#if currentKind}
                · {i18n.tpCurrentKind ?? "识别"}: {touchpadKindLabel(currentKind, i18n)}
            {/if}
        </span>
    </div>

    {#if !rawContacts}
        <p class="gf-tp-recorder-note">{i18n.tpRecorderNeedsNative ?? "需要原生触点数据才能录制"}</p>
    {/if}

    <div class="gf-tp-recorder-dirs">
        {#if recorded && (recorded.kind === "swipe" || recorded.kind === "shape" || recorded.kind === "anchorDraw")}
            <span class="gf-tp-recorder-dir">
                {fingerCount}{i18n.tpFingers ?? "指"} · {directionsOf(recorded).join(" → ")}
            </span>
        {/if}
        {#if session === "DISARMED"}
            <button type="button" class="b3-button gf-tp-recorder-start" on:click={startPreparing}>
                {i18n.tpRecorderStart ?? "开始录制"}
            </button>
        {:else if session === "PREPARING"}
            <button type="button" class="b3-button b3-button--text" on:click={cancelPreparing}>
                {i18n.gestureRecorderCancel ?? "取消"}
            </button>
        {:else if session === "ERROR"}
            <button type="button" class="b3-button b3-button--text" on:click={reRecord}>
                {i18n.tpRecorderRetry ?? "重新录制"}
            </button>
        {:else if session === "DONE"}
            <button type="button" class="b3-button b3-button--text" on:click={reRecord}>
                {i18n.tpRecorderRetry ?? "重新录制"}
            </button>
            <button type="button" class="b3-button b3-button--text" on:click={clearGesture}>
                {i18n.gestureRecorderClear ?? "清除"}
            </button>
        {/if}
    </div>
</div>

<style>
    .gf-tp-recorder {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .gf-tp-recorder-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
    }
    .gf-tp-recorder-field {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--b3-theme-on-surface, #1f2329);
    }
    .gf-tp-recorder-label {
        white-space: nowrap;
    }
    .gf-tp-recorder-select {
        max-width: 180px;
    }
    .gf-tp-recorder-hint {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light, #9aa0a6);
        align-self: center;
    }
    .gf-tp-recorder-pad {
        position: relative;
        width: min(100%, 420px);
        aspect-ratio: 4 / 3;
        height: auto;
        align-self: center;
        border: 1px dashed var(--b3-border-color, #e9e9ea);
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        background: var(--b3-theme-surface, transparent);
        overflow: hidden;
    }
    /* Very light reference grid so trail proportions read clearly. */
    .gf-tp-recorder-pad::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 0;
        background-image:
            linear-gradient(to right, var(--b3-border-color, rgba(127, 127, 127, 0.18)) 1px, transparent 1px),
            linear-gradient(to bottom, var(--b3-border-color, rgba(127, 127, 127, 0.18)) 1px, transparent 1px);
        background-size: 25% 25%;
        opacity: 0.4;
        pointer-events: none;
    }
    .gf-tp-recorder-trail {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        display: block;
        z-index: 1;
    }
    .gf-tp-recorder-contact {
        position: absolute;
        width: 16px;
        height: 16px;
        margin: -8px 0 0 -8px;
        border-radius: 50%;
        background: var(--b3-theme-primary, #4285f4);
        color: var(--b3-theme-on-primary, #fff);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 9px;
        font-weight: 600;
        box-shadow: 0 0 0 2px var(--b3-theme-surface, #fff);
        z-index: 2;
    }
    /* Anchor: hollow ring + A. */
    .gf-tp-recorder-contact--anchor {
        background: transparent;
        border: 2px solid var(--b3-theme-primary, #4285f4);
        color: var(--b3-theme-primary, #4285f4);
        box-shadow: 0 0 0 2px var(--b3-theme-surface, #fff);
    }
    /* Moving: solid + M. */
    .gf-tp-recorder-contact--moving {
        background: var(--b3-theme-primary-light, #4285f4);
        border: 2px solid var(--b3-theme-primary, #4285f4);
    }
    .gf-tp-recorder-contact-id {
        line-height: 1;
    }
    .gf-tp-recorder-status {
        font-size: 12px;
        line-height: 1.5;
        padding: 2px 10px;
        border-radius: 10px;
        color: var(--b3-theme-on-surface-light, #9aa0a6);
        position: relative;
        z-index: 3;
    }
    .gf-tp-recorder-live {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light, #9aa0a6);
        position: relative;
        z-index: 3;
    }
    .gf-tp-recorder-note {
        margin: 0;
        font-size: 12px;
        color: var(--b3-theme-error, #d23f31);
    }
    .gf-tp-recorder-dirs {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 20px;
    }
    .gf-tp-recorder-start {
        padding: 2px 16px;
    }
    .gf-tp-recorder-dir {
        font-family: var(--b3-font-family-code, monospace);
        font-size: 13px;
        color: var(--b3-theme-on-surface, #1f2329);
    }
</style>
