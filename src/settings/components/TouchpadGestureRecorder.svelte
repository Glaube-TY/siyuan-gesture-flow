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
        TouchpadRecognitionResult,
    } from "@/gesture/touchpad/recognition/TouchpadGestureTracker";
    import type {
        TouchpadGestureKind,
        TouchpadGestureSpec,
    } from "@/gesture/touchpad/types";
    import { dispatchAllowed } from "@/gesture/conflict/TouchpadConflictPolicy";
    import { touchpadDescriptorLabel, touchpadKindLabel } from "@/gesture/touchpad/labels";
    import {
        createReleaseGate,
        onGateFrame,
        onCompletedPrimaryClick,
        canArmReleaseGate,
        RELEASE_QUIET_MS,
        type ReleaseGateState,
    } from "@/settings/touchpadRecorderGate";
    import {
        RECORDER_RELEASE_IDLE_MS,
        recorderReleaseFrameAfterIdle,
        shouldCommitRecorderResult,
        shouldArmRecorderReleaseWatchdog,
        hasRecorderContactMovement,
    } from "@/settings/touchpadRecorderLifecycle";

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
     * Finger count and gesture kind are both auto-detected by the Tracker.
     * The Tracker locks the acquired contact count once movement starts and
     * completes at the first finger drop, so a 3→2→1 release tail never
     * pollutes the recorded gesture.
     * While mounted, the runtime's touchpad dispatch is paused.
     */

    export let i18n: Record<string, string>;
    /** Recognition thresholds (from the current touchpad config). */
    export let trackerConfig: Partial<TouchpadTrackerConfig> = {};

    const dispatch = createEventDispatcher<{
        update: { gesture: TouchpadGestureSpec };
        clear: Record<string, never>;
    }>();

    /** Square recorder space: screen geometry must not distort recorded paths. */
    const PAD_W = 900;
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

    type RecorderSnapshot = {
        result: TouchpadRecognitionResult;
        path: Array<{ x: number; y: number }>;
        contactPaths: Array<{ id: number; points: Array<{ x: number; y: number }> }>;
        anchorIds: number[];
        movingIds: number[];
        contacts: Array<{ id: number; x: number; y: number }>;
    };
    /** Recognition may finish at the first staggered drop; commit only at 0 contacts. */
    let pendingCompletion: RecorderSnapshot | null = null;

    /** Latest physical contact count seen on ANY raw frame (incl. DISARMED). */
    let lastPhysicalContactCount = 0;
    /** Pure release-gate state while PREPARING. */
    let releaseGate: ReleaseGateState | null = null;

    // Live display data.
    let livePath: Array<{ x: number; y: number }> = [];
    let contactPaths: Array<{ id: number; points: Array<{ x: number; y: number }> }> = [];
    /** Direct raw-frame trails: visual/lifecycle fallback independent of Tracker stage. */
    let rawContactPaths: Array<{ id: number; points: Array<{ x: number; y: number }> }> = [];
    let rawContactPathMap = new Map<number, { id: number; points: Array<{ x: number; y: number }> }>();
    let rawAttemptActive = false;
    let liveContacts: Array<{ id: number; x: number; y: number }> = [];
    let liveAnchorIds: number[] = [];
    let liveMovingIds: number[] = [];
    let currentKind: TouchpadGestureKind | null = null;

    // Frozen result display.
    let finalPath: Array<{ x: number; y: number }> = [];
    let finalContactPaths: Array<{ id: number; points: Array<{ x: number; y: number }> }> = [];
    let finalAnchorIds: number[] = [];
    let finalMovingIds: number[] = [];
    let finalContacts: Array<{ id: number; x: number; y: number }> = [];

    let rawContacts = false;
    let waitTimer: ReturnType<typeof setTimeout> | null = null;
    let prepareTimer: ReturnType<typeof setTimeout> | null = null;
    let releaseWatchdogTimer: ReturnType<typeof setTimeout> | null = null;

    // Tracker is created explicitly — never rebuilt by Svelte reactivity.
    let tracker: TouchpadGestureTracker;

    function buildTracker(): TouchpadGestureTracker {
        return new TouchpadGestureTracker(
            {
                ...DEFAULT_TRACKER_CONFIG,
                ...trackerConfig,
                minFingerCount: 2,
                // Recording discovers the physical finger count from frames.
                // Explicitly discard any stale selector-era restriction.
                requiredFingerCount: undefined,
                allowedFingerCounts: undefined,
                // There is no recorder-side maximum finger count. Raw frames
                // decide how many fingers belong to this physical gesture.
                dynamicFingerCount: true,
                // Without a selector, give staggered finger placement enough
                // time to settle before the observed count is locked.
                settleWindowMs: Math.max(trackerConfig.settleWindowMs ?? 0, 240),
                // Keep several seconds of high-rate raw movement so long
                // recorder gestures never appear to stop before finger-up.
                maxTrailPoints: Math.max(trackerConfig.maxTrailPoints ?? 0, 512),
            },
            new Set(AUTO_RECORD_KINDS),
        );
    }

    function resetRawContactPaths(): void {
        rawContactPathMap = new Map();
        rawContactPaths = [];
        rawAttemptActive = false;
    }

    /**
     * Preserve every physical contact trail directly from raw frames.  This is
     * deliberately independent of the recognition state machine: the Tracker
     * still decides the final gesture, while the UI never loses live feedback
     * if acquisition/settling takes an extra frame.
     */
    function appendRawContactPaths(
        contacts: Array<{ id: number; x: number; y: number }>,
    ): void {
        if (!rawAttemptActive) {
            if (contacts.length < 2) return;
            rawAttemptActive = true;
        }
        if (contacts.length === 0) return;

        for (const contact of contacts) {
            const path = rawContactPathMap.get(contact.id) ?? { id: contact.id, points: [] };
            const last = path.points[path.points.length - 1];
            // Skip identical high-rate reports without sacrificing sensitivity.
            if (!last || last.x !== contact.x || last.y !== contact.y) {
                path.points.push({ x: contact.x, y: contact.y });
            }
            rawContactPathMap.set(contact.id, path);
        }
        // A new outer array invalidates Svelte's reactive view. Individual
        // paths stay mutable, avoiding a full-history deep copy on every frame.
        rawContactPaths = Array.from(rawContactPathMap.values());
    }

    function preferredLiveContactPaths(
        rawActive: boolean,
        rawPaths: Array<{ id: number; points: Array<{ x: number; y: number }> }>,
        trackerPaths: Array<{ id: number; points: Array<{ x: number; y: number }> }>,
    ): Array<{ id: number; points: Array<{ x: number; y: number }> }> {
        // Raw per-contact frames are the most complete and current visual
        // source. Tracker paths may restart while the finger count settles.
        return rawActive && rawPaths.length > 0 ? rawPaths : trackerPaths;
    }

    /** Reset to the initial disarmed state (no recording, no draft change). */
    function drainToDisarmed(): void {
        clearTimeout(waitTimer as ReturnType<typeof setTimeout> | undefined);
        clearTimeout(prepareTimer as ReturnType<typeof setTimeout> | undefined);
        clearReleaseWatchdog();
        waitTimer = null;
        prepareTimer = null;
        tracker = buildTracker();
        session = "DISARMED";
        message = "";
        livePath = [];
        contactPaths = [];
        resetRawContactPaths();
        liveContacts = [];
        liveAnchorIds = [];
        liveMovingIds = [];
        currentKind = null;
        pendingCompletion = null;
    }

    /** Enter PREPARING: pause runtime dispatch, wait for release + quiet gate. */
    function startPreparing(completedPrimaryClick = false): void {
        if (!rawContacts) {
            message = i18n.tpRecorderNeedsNative ?? "需要原生触点数据才能录制";
            return;
        }
        clearTimeout(prepareTimer as ReturnType<typeof setTimeout> | undefined);
        clearReleaseWatchdog();
        prepareTimer = null;
        // A fresh tracker for the upcoming attempt.
        tracker = buildTracker();
        livePath = [];
        contactPaths = [];
        resetRawContactPaths();
        liveContacts = [];
        liveAnchorIds = [];
        liveMovingIds = [];
        currentKind = null;
        pendingCompletion = null;
        session = "PREPARING";
        message = i18n.tpRecorderPreparing ?? "请松开触控板上的所有手指…";
        setTouchpadRecording(true);
        // The gate only arms after a CONFIRMED 0-contact frame + quiet gate.
        releaseGate = createReleaseGate(lastPhysicalContactCount);
        // Some precision-touchpad drivers omit the final empty HID frame for
        // the tap/click that activated this panel. A completed browser click
        // proves that primary pointer was released, so it may clear one stale
        // native contact; multi-contact state still requires a real 0 frame.
        if (!releaseGate.zeroContactConfirmed && completedPrimaryClick) {
            releaseGate = onCompletedPrimaryClick(releaseGate);
            lastPhysicalContactCount = releaseGate.currentContactCount;
        }
        if (releaseGate.zeroContactConfirmed) {
            armReleaseQuietTimer();
        }
    }

    /** The visual pad is the record control; click again after a result to retry. */
    function activateRecorder(event?: MouseEvent): void {
        if (session === "DISARMED" || session === "DONE" || session === "ERROR") {
            const completedPrimaryClick =
                event !== undefined && event.button === 0 && event.buttons === 0 && event.detail > 0;
            startPreparing(completedPrimaryClick);
        }
    }

    function onRecorderKeydown(event: KeyboardEvent): void {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        activateRecorder();
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

    function clearReleaseWatchdog(): void {
        if (releaseWatchdogTimer !== null) {
            clearTimeout(releaseWatchdogTimer);
            releaseWatchdogTimer = null;
        }
    }

    /**
     * Recover devices that omit the final empty frame. While fingers remain
     * down their raw reports continuously reset this timer; once reporting
     * stops after real movement, feed the Tracker the missing zero-contact
     * frame so it classifies and freezes the gesture normally.
     */
    function armReleaseWatchdog(lastFrame: TouchpadFrame, live: TouchpadLiveState): void {
        clearReleaseWatchdog();
        const rawTrailCanFinish =
            rawAttemptActive &&
            lastPhysicalContactCount >= 2 &&
            hasRecorderContactMovement(rawContactPaths);
        if (!shouldArmRecorderReleaseWatchdog(live, lastPhysicalContactCount) && !rawTrailCanFinish) return;
        releaseWatchdogTimer = setTimeout(() => {
            releaseWatchdogTimer = null;
            if (session !== "RECORDING") return;
            const current = tracker.getLiveState();
            const rawStillCanFinish =
                rawAttemptActive &&
                lastPhysicalContactCount >= 2 &&
                hasRecorderContactMovement(rawContactPaths);
            if (!shouldArmRecorderReleaseWatchdog(current, lastPhysicalContactCount) && !rawStillCanFinish) return;
            onRawFrame(recorderReleaseFrameAfterIdle(lastFrame));
        }, RECORDER_RELEASE_IDLE_MS);
    }

    /** Wait for the remainder of a staggered release before committing. */
    function armPendingReleaseWatchdog(lastFrame: TouchpadFrame): void {
        clearReleaseWatchdog();
        releaseWatchdogTimer = setTimeout(() => {
            releaseWatchdogTimer = null;
            if (session !== "WAIT_RELEASE" || !pendingCompletion) return;
            onRawFrame(recorderReleaseFrameAfterIdle(lastFrame));
        }, RECORDER_RELEASE_IDLE_MS);
    }

    function freezeSnapshot(snapshot: RecorderSnapshot): void {
        finalPath = snapshot.path.map((p) => ({ ...p }));
        finalContactPaths = snapshot.contactPaths.map((contactPath) => ({
            id: contactPath.id,
            points: contactPath.points.map((p) => ({ ...p })),
        }));
        finalAnchorIds = snapshot.anchorIds.slice();
        finalMovingIds = snapshot.movingIds.slice();
        finalContacts = snapshot.contacts.map((contact) => ({ ...contact }));
    }

    /** Final recognition/validation/dispatch after every finger is released. */
    function commitSnapshot(snapshot: RecorderSnapshot): void {
        pendingCompletion = null;
        freezeSnapshot(snapshot);
        const result = snapshot.result;
        if (result.valid) {
            const spec = buildSpec(result);
            if (spec) {
                const decision = dispatchAllowed(spec);
                if (!decision.allowed) {
                    session = "ERROR";
                    setTouchpadRecording(false);
                    message = i18n.tpRecorderSystemConflict ?? "这是系统内置触控板手势，请录制各手指轨迹不同的动作";
                    return;
                }
                session = "DONE";
                setTouchpadRecording(false);
                message = touchpadDescriptorLabel(spec, i18n);
                dispatch("update", { gesture: spec });
                return;
            }
        }
        session = "ERROR";
        setTouchpadRecording(false);
        message = i18n.tpRecorderUnrecognised ?? "无法识别，请重试";
    }

    // ------------------------------------------------------------- raw frames

    function onRawFrame(frame: TouchpadFrame): void {
        // Every real or inferred frame supersedes the previous release timer.
        clearReleaseWatchdog();
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
            if (pendingCompletion) {
                tracker.feed(frame);
                applyLive(tracker.getLiveState());
                if (shouldCommitRecorderResult(contacts.length)) {
                    liveContacts = [];
                    const completion = pendingCompletion;
                    commitSnapshot(completion);
                } else {
                    armPendingReleaseWatchdog(frame);
                }
                return;
            }
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
        appendRawContactPaths(contacts);
        // Keep the last full live snapshot: feed() clears the completed run
        // before returning its result, so getLiveState() afterwards no longer
        // contains the trails that must be frozen in DONE.
        const previousLivePath = livePath.slice();
        const previousContactPaths = preferredLiveContactPaths(
            rawAttemptActive,
            rawContactPaths,
            contactPaths,
        ).map((c) => ({
            id: c.id,
            points: c.points.map((p) => ({ x: p.x, y: p.y })),
        }));
        const previousAnchorIds = liveAnchorIds.slice();
        const previousMovingIds = liveMovingIds.slice();
        const previousLiveContacts = liveContacts.map((c) => ({ ...c }));
        const result = tracker.feed(frame);
        const live = tracker.getLiveState();
        applyLive(live);

        if (result) {
            const snapshot: RecorderSnapshot = {
                result,
                path: result.points?.length
                    ? result.points.map((p) => ({ x: p.x, y: p.y }))
                    : previousLivePath,
                contactPaths: previousContactPaths,
                anchorIds: previousAnchorIds,
                movingIds: previousMovingIds,
                contacts: previousLiveContacts,
            };
            freezeSnapshot(snapshot);
            if (!shouldCommitRecorderResult(contacts.length)) {
                pendingCompletion = snapshot;
                session = "WAIT_RELEASE";
                message = i18n.tpRecorderWaitRelease ?? "请松开剩余手指";
                armPendingReleaseWatchdog(frame);
                return;
            }
            commitSnapshot(snapshot);
            return;
        }

        // No completed result — map the tracker stage to a session state.
        if (live.runActive) {
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
        armReleaseWatchdog(frame, live);
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
        }
    }

    function buildSpec(result: {
        kind: TouchpadGestureKind;
        fingerCount: number;
        directions: string[];
        contactDirections?: string[][];
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
            case "multiShape":
                if (!result.contactDirections || result.contactDirections.length !== result.fingerCount) return null;
                return {
                    kind: "multiShape",
                    fingerCount: result.fingerCount,
                    paths: result.contactDirections as never,
                };
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
                return { kind: "pinch", fingerCount: result.fingerCount, direction: result.pinchDirection };
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
        clearReleaseWatchdog();
        if (unsubscribeDiag) {
            unsubscribeDiag();
            unsubscribeDiag = null;
        }
        if (unsubscribeFrames) {
            unsubscribeFrames();
            unsubscribeFrames = null;
        }
    });

    /** Cancel a PREPARING cycle back to the disarmed state. */
    function cancelPreparing(): void {
        drainToDisarmed();
        setTouchpadRecording(false);
    }

    /** 清除: explicitly clear the current gesture draft and disarm. */
    function clearGesture(): void {
        finalPath = [];
        finalContactPaths = [];
        finalAnchorIds = [];
        finalMovingIds = [];
        finalContacts = [];
        drainToDisarmed();
        setTouchpadRecording(false);
        dispatch("clear", {});
    }

    // Display trails (live during RECORDING, frozen after DONE).
    $: useFrozenTrail = session === "DONE" || (session === "WAIT_RELEASE" && pendingCompletion !== null);
    $: shownPath = useFrozenTrail ? finalPath : livePath;
    // Keep every live source as an explicit reactive dependency. Svelte does
    // not infer dependencies hidden inside a called function; without these
    // arguments the view stayed on its first path until session changed at
    // finger-up, then suddenly rendered all contacts at once.
    $: shownContactPaths = useFrozenTrail
        ? finalContactPaths
        : preferredLiveContactPaths(rawAttemptActive, rawContactPaths, contactPaths);
    $: shownAnchorIds = useFrozenTrail ? finalAnchorIds : liveAnchorIds;
    $: shownMovingIds = useFrozenTrail ? finalMovingIds : liveMovingIds;
    // Render as soon as samples exist. Trail visibility must not depend on a
    // later state assignment in the same raw-frame callback.
    $: showTrails =
        shownPath.length >= 2 || shownContactPaths.some((path) => path.points.length >= 2);
    // Dots: full set while recording; ONLY pre-qualified anchors during
    // acquisition (a moving single finger must never look like it is recording).
    $: dotsToShow = (() => {
        if (session === "DONE") return finalContacts;
        if (session === "RECORDING") return liveContacts;
        if (session === "ACQUIRING") return liveContacts;
        if (session === "WAIT_RELEASE") return liveContacts;
        return [];
    })();
    $: mainTrailPoints = shownPath
        .map((p) => `${(p.x * PAD_W).toFixed(1)},${(p.y * PAD_H).toFixed(1)}`)
        .join(" ");
    const TRAIL_COLORS = [
        "var(--b3-theme-primary, #4285f4)",
        "var(--b3-theme-success, #2e9d74)",
        "var(--b3-theme-warning, #d9822b)",
        "#8b6fd6",
        "#d45d9e",
    ];
    $: fingerTrailPolylines = shownContactPaths.map((contactPath, index) => ({
        id: contactPath.id,
        color: TRAIL_COLORS[index % TRAIL_COLORS.length],
        points: contactPath.points
            .map((p) => `${(p.x * PAD_W).toFixed(1)},${(p.y * PAD_H).toFixed(1)}`)
            .join(" "),
        pointCount: contactPath.points.length,
    }));
    $: hasFingerTrails = fingerTrailPolylines.some((trail) => trail.pointCount >= 2);

    function contactColor(contactId: number): string {
        const index = shownContactPaths.findIndex((path) => path.id === contactId);
        return TRAIL_COLORS[(index < 0 ? 0 : index) % TRAIL_COLORS.length];
    }
</script>

<div class="gf-tp-recorder" data-gesture-flow-tp-recorder>
    <div
        class="gf-tp-recorder-pad"
        class:gf-tp-recorder-pad--clickable={rawContacts && (session === "DISARMED" || session === "DONE" || session === "ERROR")}
        role="button"
        tabindex={rawContacts ? 0 : -1}
        aria-disabled={!rawContacts}
        on:click={activateRecorder}
        on:keydown={onRecorderKeydown}
    >
        <svg
            class="gf-tp-recorder-trail"
            viewBox="0 0 {PAD_W} {PAD_H}"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
        >
            {#if showTrails}
                {#each fingerTrailPolylines as trail (trail.id)}
                    <polyline
                        points={trail.points}
                        fill="none"
                        stroke="var(--b3-theme-surface, #fff)"
                        stroke-width="6"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        vector-effect="non-scaling-stroke"
                        opacity="0.72"
                    />
                    <polyline
                        points={trail.points}
                        fill="none"
                        stroke={trail.color}
                        stroke-width="3.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        vector-effect="non-scaling-stroke"
                        opacity="0.96"
                    />
                {/each}
            {/if}
            {#if showTrails && !hasFingerTrails && mainTrailPoints}
                <polyline
                    points={mainTrailPoints}
                    fill="none"
                    stroke="var(--b3-theme-primary, #4285f4)"
                    stroke-width="3.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    vector-effect="non-scaling-stroke"
                    opacity="0.96"
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
                    style={`--gf-contact-color:${contactColor(c.id)};left:${(c.x * 100).toFixed(1)}%;top:${(c.y * 100).toFixed(1)}%`}
                    title={`id=${c.id}`}
                >
                    <span class="gf-tp-recorder-contact-id">
                        {isAnchor ? "A" : isMoving ? "M" : c.id}
                    </span>
                </div>
            {/each}
        {/if}
        <span
            class="gf-tp-recorder-status"
            class:gf-tp-recorder-status--recording={session === "RECORDING"}
            class:gf-tp-recorder-status--waiting={session === "WAIT_RELEASE"}
            class:gf-tp-recorder-status--done={session === "DONE"}
            class:gf-tp-recorder-status--error={session === "ERROR"}
        >
            {#if session === "DISARMED"}
                {i18n.tpRecorderDisarmed ?? "点击此面板开始录制"}
            {:else if session === "PREPARING"}
                {message}
            {:else if session === "ARMED"}
                {message}
            {:else if session === "ACQUIRING"}
                {#if shownAnchorIds.length > 0}
                    {i18n.tpRecorderAnchorWait ?? "已识别固定指，等待其他手指加入"}
                {:else}
                    {i18n.tpRecorderDetected ?? "已检测"} {liveContacts.length} {i18n.tpFingers ?? "指"}
                {/if}
            {:else if session === "RECORDING"}
                {i18n.tpRecorderRecording ?? "录制中 · 松开全部手指完成"}
            {:else if session === "ERROR"}
                {message}
            {:else if session === "DONE"}
                {i18n.tpRecorderDone ?? "录制完成"} · {i18n.tpRecorderClickRetry ?? "点击面板重新录制"}
            {:else if session === "WAIT_RELEASE"}
                {i18n.tpRecorderWaitRelease ?? "请松开剩余手指"}
            {/if}
        </span>
        {#if session !== "DISARMED" && session !== "DONE" && session !== "ERROR"}
            <span class="gf-tp-recorder-live">
                {lastPhysicalContactCount}{i18n.tpFingers ?? "指"}
                {#if currentKind}
                    · {touchpadKindLabel(currentKind, i18n)}
                {/if}
            </span>
        {/if}
    </div>

    {#if !rawContacts}
        <p class="gf-tp-recorder-note">{i18n.tpRecorderNeedsNative ?? "需要原生触点数据才能录制"}</p>
    {/if}

    {#if session === "PREPARING" || session === "DONE"}
        <div class="gf-tp-recorder-actions">
        {#if session === "PREPARING"}
            <button type="button" class="b3-button b3-button--text" on:click={cancelPreparing}>
                {i18n.gestureRecorderCancel ?? "取消"}
            </button>
        {:else if session === "DONE"}
            <button type="button" class="b3-button b3-button--text" on:click={clearGesture}>
                {i18n.gestureRecorderClear ?? "清除"}
            </button>
        {/if}
        </div>
    {/if}
</div>

<style>
    .gf-tp-recorder {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .gf-tp-recorder-pad {
        position: relative;
        /* Compact square: fit the complete editor on ordinary laptop screens. */
        width: min(100%, 340px, 40vh);
        aspect-ratio: 1 / 1;
        height: auto;
        align-self: center;
        border: 1px dashed var(--b3-border-color, #e9e9ea);
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: var(--b3-theme-surface, transparent);
        overflow: hidden;
    }
    .gf-tp-recorder-pad--clickable {
        cursor: pointer;
        border-color: var(--b3-theme-primary, #4285f4);
    }
    .gf-tp-recorder-pad--clickable:hover,
    .gf-tp-recorder-pad--clickable:focus-visible {
        background: color-mix(in srgb, var(--b3-theme-primary, #4285f4) 6%, var(--b3-theme-surface, transparent));
        outline: 2px solid color-mix(in srgb, var(--b3-theme-primary, #4285f4) 45%, transparent);
        outline-offset: 2px;
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
        opacity: 0.22;
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
        background: var(--gf-contact-color, var(--b3-theme-primary, #4285f4));
        color: var(--b3-theme-on-primary, #fff);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 9px;
        font-weight: 600;
        box-shadow: 0 0 0 3px var(--b3-theme-surface, #fff), 0 2px 8px rgba(0, 0, 0, 0.18);
        z-index: 2;
    }
    /* Anchor: hollow ring + A. */
    .gf-tp-recorder-contact--anchor {
        background: transparent;
        border: 2px solid var(--gf-contact-color, var(--b3-theme-primary, #4285f4));
        color: var(--gf-contact-color, var(--b3-theme-primary, #4285f4));
        box-shadow: 0 0 0 2px var(--b3-theme-surface, #fff);
    }
    /* Moving: solid + M. */
    .gf-tp-recorder-contact--moving {
        background: var(--gf-contact-color, var(--b3-theme-primary-light, #4285f4));
        border: 2px solid var(--gf-contact-color, var(--b3-theme-primary, #4285f4));
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
        position: absolute;
        top: 8px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 3;
        background: color-mix(in srgb, var(--b3-theme-surface, #fff) 90%, transparent);
        box-shadow: 0 1px 5px rgba(0, 0, 0, 0.08);
        white-space: nowrap;
    }
    .gf-tp-recorder-status--recording {
        color: var(--b3-theme-on-primary, #fff);
        background: var(--b3-theme-primary, #4285f4);
    }
    .gf-tp-recorder-status--waiting {
        color: var(--b3-theme-on-surface, #1f2329);
        background: color-mix(in srgb, var(--b3-theme-warning, #d9822b) 22%, var(--b3-theme-surface, #fff));
    }
    .gf-tp-recorder-status--done {
        color: var(--b3-theme-on-primary, #fff);
        background: var(--b3-theme-success, #2e9d74);
    }
    .gf-tp-recorder-status--error {
        color: var(--b3-theme-on-primary, #fff);
        background: var(--b3-theme-error, #d23f31);
    }
    .gf-tp-recorder-live {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light, #9aa0a6);
        position: absolute;
        right: 8px;
        bottom: 8px;
        z-index: 3;
        padding: 2px 8px;
        border-radius: 9px;
        background: color-mix(in srgb, var(--b3-theme-surface, #fff) 88%, transparent);
    }
    .gf-tp-recorder-note {
        margin: 0;
        font-size: 12px;
        color: var(--b3-theme-error, #d23f31);
    }
    .gf-tp-recorder-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
    }
</style>
