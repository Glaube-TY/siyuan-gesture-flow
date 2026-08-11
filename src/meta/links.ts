/**
 * Centralised external links (RC 0.1.0).
 *
 * Every production module (about page, README helper, funding metadata)
 * must read URLs from here instead of duplicating them.
 *
 * Donation image URLs are the real HTTPS links from
 * https://glaube-ty.top/da-shang/ (verified reachable); the images are
 * hosted remotely and never bundled into the plugin.
 */

/** Personal website. */
export const WEBSITE_URL = "https://glaube-ty.top/";
/** Donation page. */
export const DONATE_URL = "https://glaube-ty.top/da-shang/";
/** GitHub profile. */
export const GITHUB_URL = "https://github.com/Glaube-TY";
/** Plugin repository. */
export const REPO_URL = "https://github.com/Glaube-TY/siyuan-gesture-flow";
/** Issues / feedback. */
export const ISSUES_URL = "https://github.com/Glaube-TY/siyuan-gesture-flow/issues";
/** Microsoft reference for the built-in Windows touchpad gesture language. */
export const WINDOWS_TOUCHPAD_GESTURES_URL =
    "https://support.microsoft.com/windows/hardware/input-devices/touch-gestures-for-windows";

/**
 * WeChat pay QR image, taken from the donation page (relative path
 * resolved to an absolute HTTPS URL, verified 200 OK).
 */
export const DONATE_WECHAT_QR_URL =
    "https://glaube-ty.top/uploads/attachments/halo/8b772b15-f542-4157-a251-e3985f37f84a.png";

/**
 * Alipay QR image, taken from the donation page (relative path resolved
 * to an absolute HTTPS URL, verified 200 OK).
 */
export const DONATE_ALIPAY_QR_URL =
    "https://glaube-ty.top/uploads/attachments/halo/f3d25e23-333e-4356-99d0-d0fda69d11ad.jpg";
