/**
 * Touchpad provider abstraction (input layer).
 *
 * A provider is the boundary between GestureFlow and a concrete touchpad
 * input source:
 *
 *   - a Windows native bridge (Raw Input / WM_INPUT contact frames,
 *     optionally driving the system gesture takeover controller);
 *   - the Electron `webContents` `input-event` observer (compatibility mode —
 *     gesture-level events, NO contact frames);
 *   - future macOS / Linux native providers.
 *
 * Every provider reports its honest {@link TouchpadCapabilities}.  A provider
 * that cannot deliver raw contact frames MUST say so (supportsRawContacts
 * false, observerMode true) — it is never allowed to fabricate finger counts.
 *
 * Coordinates in {@link TouchpadFrame} are **normalised to the touchpad
 * surface** (0..1 on both axes) whenever the source can provide surface
 * geometry.  Recognition works on these normalised coordinates and never
 * converts them into screen-mouse coordinates first.
 */

/** A single tracked contact (finger) on the touchpad. */
export interface TouchpadContact {
    /** Stable contact id for the lifetime of the touch (from the OS). */
    id: number;
    /** Normalised x position on the touchpad surface (0..1). */
    x: number;
    /** Normalised y position on the touchpad surface (0..1). */
    y: number;
    /** Whether the contact is currently touching (down). */
    touching: boolean;
    /** Contact pressure (0..1) if the device reports it reliably. */
    pressure?: number;
    /** Contact ellipse major axis (normalised) if reported reliably. */
    width?: number;
    /** Contact ellipse minor axis (normalised) if reported reliably. */
    height?: number;
}

/** High-level gesture event produced by a non-contact observer source. */
export type TouchpadGestureEventData =
    | { type: "scroll"; state: "begin" | "update" | "end"; deltaX: number; deltaY: number; hasPrecise: boolean }
    | { type: "pinch"; state: "begin" | "update" | "end"; scale: number }
    | { type: "tap" }
    | { type: "twoFingerTap" }
    | { type: "longPress" }
    | { type: "longTap" }
    | { type: "doubleTap" };

/** One frame of touchpad state at a point in time. */
export interface TouchpadFrame {
    /** High-resolution timestamp (performance.now()-ish). */
    timestamp: number;
    /** Active contacts (empty when no fingers are down). */
    contacts: TouchpadContact[];
    /** Optional stable device identifier. */
    deviceId?: string;
    /**
     * How this frame was produced.
     *
     * - `raw-contacts`   — real per-contact frames from the hardware.
     * - `gesture-events` — gesture-level events from the OS recognizer
     *                      (observer mode; {@link gesture} carries the data).
     * - `synthetic`      — frames from the settings recorder/player.
     */
    source: "raw-contacts" | "gesture-events" | "synthetic";
    /** Present only when `source === "gesture-events"`. */
    gesture?: TouchpadGestureEventData;
    /**
     * Whether the touchpad's physical surface button is currently pressed
     * (only when the device/provider can report it — most cannot).
     */
    surfacePressed?: boolean;
    /**
     * Real contact count from the native TouchpadGesturesController
     * (no per-contact geometry — used for diagnostics).
     */
    contactCount?: number;
    /**
     * A real single-point controller pointer sample (diagnostics only — it is
     * never fed into the recognizer because it carries no per-contact data).
     */
    pointer?: { x: number; y: number; state: "pressed" | "moved" | "released" };
    /**
     * A real 3/4/5-finger action from the native TouchpadGesturesController.
     */
    nativeAction?: { kind: "tap" | "press" | "release"; fingerCount: number };
}

/** Everything the plugin knows about the current touchpad input source. */
export interface TouchpadCapabilities {
    /** Provider implementation id. */
    providerType: "windows-native" | "electron-input-event" | "none";
    /** Current platform (process.platform when available). */
    platform: string;
    /** Whether a Precision Touchpad is detected on this device. */
    precisionTouchpad: boolean;
    /** Whether true multi-contact frames are delivered. */
    supportsRawContacts: boolean;
    /**
     * Whether raw multi-contact gesture recognition is available (HID
     * descriptor contact map parsed).  Independent of system-gesture takeover.
     */
    multiContactGestures: boolean;
    /** Maximum trackable contact count the hardware reports (0 = unknown/none). */
    maxContacts: number;
    /**
     * Authoritative HARDWARE maximum contact count (HID descriptor / Feature
     * report).  0 when unknown.  This — NOT the observed max — is what limits
     * the recorder's finger-count options.
     */
    hardwareMaxContacts: number;
    /**
     * Largest contact count actually observed in live frames.  Diagnostic
     * only: observing 3 fingers means observed >= 3, never "hardware max 3".
     */
    observedMaxContacts: number;
    /** Whether a reliable hardware maximum is known (hardwareMaxContacts > 0). */
    maxContactsKnown: boolean;
    /** Whether multi-finger tap gestures can be detected. */
    supportsMultiFingerTap: boolean;
    /** Whether the physical surface button press state is available. */
    supportsPress: boolean;
    /** Whether GestureFlow can take over the system 3/4/5-finger gestures. */
    canOverrideSystemGestures: boolean;
    /** Observer-only provider: it never consumes/modifies system input. */
    observerMode: boolean;
    /** Human-readable notes (why a capability is missing, etc.). */
    notes: string[];
    /** Optional low-level diagnostics shown in the settings page. */
    diagnostics?: {
        /** Native addon load path / reason (when provider is windows-native). */
        nativeAddonPath?: string;
        /** Whether the native addon module was loaded. */
        nativeModuleLoaded?: boolean;
        /** TouchpadGesturesController::IsSupported() result. */
        controllerSupported?: boolean;
        /** Whether the controller was created + enabled. */
        controllerEnabled?: boolean;
        /** Whether Raw Input contact frames are active. */
        rawContactsActive?: boolean;
        /** Frames rejected by the provider's second-layer invariant. */
        providerInvalidFrameDropCount?: number;
        /** HID parser / capture diagnostics (low-level, advanced only). */
        parser?: TouchpadParserDiagnostics;
    };
}

/** Raw capture + descriptor + frame-assembler diagnostics from the native addon. */
export interface TouchpadParserDiagnostics {
    buildId?: string;
    capture?: {
        wmInputCount?: number;
        rawInputReadSuccessCount?: number;
        rawInputHidPacketCount?: number;
        rawInputHidReportCount?: number;
        dwSizeHid?: number;
        dwCount?: number;
        preparsedDataRequestCount?: number;
        preparsedDataSuccessCount?: number;
        descriptorParseAttemptCount?: number;
        descriptorParseSuccessCount?: number;
        descriptorParseFailureCount?: number;
        callbackDeliveryCount?: number;
    };
    descriptor?: {
        parsed?: boolean;
        parse?: { success?: boolean; stage?: number; reason?: string; status?: number };
        caps?: {
            inputReportByteLength?: number;
            featureReportByteLength?: number;
            numberInputValueCaps?: number;
            numberInputButtonCaps?: number;
            numberFeatureValueCaps?: number;
            numberLinkCollectionNodes?: number;
            deviceUsagePage?: number;
            deviceUsage?: number;
        };
        contactCount?: { valid?: boolean; linkCollection?: number; reportId?: number };
        scanTime?: { valid?: boolean; linkCollection?: number; reportId?: number };
        contactCountMax?: { valid?: boolean; linkCollection?: number; reportId?: number; logicalMax?: number };
        maxContacts?: number;
        maxContactsFromDescriptor?: boolean;
        fingerCollectionCount?: number;
        contactFieldCount?: number;
        fingerCollections?: number[];
        contactMap?: Array<{
            fingerCollection?: number;
            reportId?: number;
            validX?: boolean;
            validY?: boolean;
            validId?: boolean;
            validTip?: boolean;
            xLogicalMin?: number;
            xLogicalMax?: number;
            yLogicalMin?: number;
            yLogicalMax?: number;
        }>;
    };
    assembler?: {
        lastReportId?: number;
        lastScanTime?: number;
        lastReportedContactCount?: number;
        expectedFrameContacts?: number;
        assembledContactCount?: number;
        activeContactCount?: number;
        hybridContinuationCount?: number;
        completedFrameCount?: number;
        emptyFrameCount?: number;
        contactIdParseSuccess?: boolean;
        tipParseSuccess?: boolean;
        xyParseSuccess?: boolean;
    };
}

/** Callbacks emitted by a {@link TouchpadProvider}. */
export interface TouchpadProviderEvents {
    /** A new touchpad frame arrived. */
    onFrame?(frame: TouchpadFrame): void;
    /** The provider's capabilities/status changed (e.g. after start). */
    onStatus?(capabilities: TouchpadCapabilities): void;
    /**
     * A real anomaly occurred (provider init failure, native crash, ...).
     * Called at most rarely — normal frames never log.
     */
    onError?(err: { label: string }): void;
}

/**
 * Base class for touchpad input providers.
 *
 * Lifecycle is strictly reversible: {@link start} acquires whatever native
 * resources are needed, {@link stop} releases ALL of them (raw input
 * registrations, hidden windows, threads, callbacks).  After {@link stop} no
 * further frames are emitted.
 */
export abstract class TouchpadProvider {
    /** Stable provider id (used by capabilities.providerType). */
    abstract readonly id: TouchpadCapabilities["providerType"];
    /** Current capabilities snapshot. */
    abstract get capabilities(): TouchpadCapabilities;

    /** Start delivering frames.  Must be idempotent. */
    abstract start(): void;

    /**
     * Stop delivering frames and release every native resource.
     * Must be idempotent and fully reversible.
     */
    abstract stop(): void;
}
