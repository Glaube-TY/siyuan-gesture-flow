<script lang="ts">
    import {
        WEBSITE_URL,
        DONATE_URL,
        GITHUB_URL,
        ISSUES_URL,
        DONATE_WECHAT_QR_URL,
        DONATE_ALIPAY_QR_URL,
        WINDOWS_TOUCHPAD_GESTURES_URL,
    } from "@/meta/links";

    export let i18n: Record<string, string> = {};

    // Remote QR images: hide a broken one (onerror), keep the support
    // button as the always-available fallback.
    let wechatFailed = false;
    let alipayFailed = false;
</script>

<div class="gf-about">
    <header class="gf-about-header">
        <h4 class="gf-about-title">GestureFlow</h4>
        <div class="gf-about-meta">
            <span class="gf-about-meta-item">Glaube-TY</span>
            <span class="gf-about-meta-item">MIT License</span>
        </div>
    </header>

    <p class="gf-about-intro">
        {i18n.aboutIntro ??
            "GestureFlow 是思源笔记的手势操作插件，可以通过自定义手势执行标签页、文档操作或快捷键。当前版本支持桌面端鼠标右键输入，未来将继续扩展触控板和其他自定义按键。"}
    </p>

    <section class="gf-about-touchpad">
        <h5 class="gf-about-section-title">
            {i18n.aboutTouchpadTitle ?? "Windows 触控板手势与屏蔽规则"}
        </h5>
        <p class="gf-about-section-text">
            {i18n.aboutTouchpadIntro ??
                "GestureFlow 只屏蔽一/二指基础交互和本机实测会触发系统动作的三指轻点。"}
        </p>
        <ul class="gf-about-touchpad-list">
            <li>{i18n.aboutTouchpadOneFinger ?? "一指：指针移动、点击（始终由系统处理）。"}</li>
            <li>{i18n.aboutTouchpadTwoFinger ?? "二指：点击/按压右键、同向滚动或平移、捏合缩放。"}</li>
            <li>{i18n.aboutTouchpadThreeFour ?? "三指轻点：Windows 10 常见动作为打开 Cortana/搜索，本机实测会触发，因此屏蔽。四指轻点可配置为操作中心但本机未启用，五指无通用默认；两者均不屏蔽。"}</li>
            <li>{i18n.aboutTouchpadAllowed ?? "三指及以上：同向或任意方向滑动、独立轨迹、多段轨迹、固定指+绘制、长按、捏合和旋转全部允许。"}</li>
        </ul>
        <p class="gf-about-touchpad-note">
            {i18n.aboutTouchpadConfigNote ??
                "Windows 设置中可以配置不代表动作当前已启用；插件不会仅因三/四/五指动作可配置就提前屏蔽。"}
        </p>
        <a class="gf-about-official-link" href={WINDOWS_TOUCHPAD_GESTURES_URL} target="_blank" rel="noopener noreferrer">
            {i18n.aboutTouchpadOfficial ?? "查看 Microsoft 官方手势说明"}
        </a>
    </section>

    <section class="gf-about-links">
        <a class="b3-button b3-button--outline gf-about-link" href={WEBSITE_URL} target="_blank" rel="noopener noreferrer" aria-label={i18n.aboutWebsite ?? "个人网站"}>
            {i18n.aboutWebsite ?? "个人网站"}
        </a>
        <a class="b3-button b3-button--outline gf-about-link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub">
            GitHub
        </a>
        <a class="b3-button b3-button--outline gf-about-link" href={ISSUES_URL} target="_blank" rel="noopener noreferrer" aria-label={i18n.aboutIssues ?? "问题反馈"}>
            {i18n.aboutIssues ?? "问题反馈"}
        </a>
    </section>

    <section class="gf-about-support">
        <h5 class="gf-about-support-title">
            {i18n.aboutSupportTitle ?? "支持与打赏"}
        </h5>
        <p class="gf-about-support-text">
            {i18n.aboutSupportText ??
                "欢迎支持，为爱发电。你的支持会帮助插件持续维护和改进。"}
        </p>
        <a class="b3-button b3-button--primary gf-about-support-btn" href={DONATE_URL} target="_blank" rel="noopener noreferrer" aria-label={i18n.aboutSupportAction ?? "前往支持"}>
            {i18n.aboutSupportAction ?? "前往支持"}
        </a>

        <div class="gf-about-qrs">
            {#if !wechatFailed}
                <a class="gf-about-qr" href={DONATE_URL} target="_blank" rel="noopener noreferrer" aria-label={i18n.aboutWechatQr ?? "微信打赏二维码"}>
                    <img
                        src={DONATE_WECHAT_QR_URL}
                        alt={i18n.aboutWechatQr ?? "微信打赏二维码"}
                        width="170"
                        height="170"
                        loading="lazy"
                        on:error={() => (wechatFailed = true)}
                    />
                </a>
            {/if}
            {#if !alipayFailed}
                <a class="gf-about-qr" href={DONATE_URL} target="_blank" rel="noopener noreferrer" aria-label={i18n.aboutAlipayQr ?? "支付宝打赏二维码"}>
                    <img
                        src={DONATE_ALIPAY_QR_URL}
                        alt={i18n.aboutAlipayQr ?? "支付宝打赏二维码"}
                        width="170"
                        height="170"
                        loading="lazy"
                        on:error={() => (alipayFailed = true)}
                    />
                </a>
            {/if}
        </div>
    </section>
</div>

<style>
    /* All styles component-scoped (Svelte data-svelte attribute); only
       gf- prefixed classes are styled.  b3- classes are reused for base
       button appearance.  Theme variables carry fallbacks. */

    .gf-about {
        display: flex;
        flex-direction: column;
        gap: 18px;
        max-width: 640px;
        padding: 4px 2px;
        color: var(--b3-theme-on-background, #1f2329);
    }

    .gf-about-header {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .gf-about-title {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
    }

    .gf-about-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 14px;
        font-size: 13px;
        opacity: 0.75;
    }

    .gf-about-intro {
        margin: 0;
        font-size: 14px;
        line-height: 1.7;
    }

    .gf-about-links {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .gf-about-touchpad {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 14px 16px;
        border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.1));
        border-radius: 8px;
        background: var(--b3-theme-surface, rgba(0, 0, 0, 0.025));
    }

    .gf-about-section-title {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
    }

    .gf-about-section-text,
    .gf-about-touchpad-note {
        margin: 0;
        font-size: 13px;
        line-height: 1.65;
    }

    .gf-about-touchpad-list {
        margin: 0;
        padding-left: 20px;
        font-size: 13px;
        line-height: 1.7;
    }

    .gf-about-touchpad-note {
        opacity: 0.78;
    }

    .gf-about-official-link {
        align-self: flex-start;
        color: var(--b3-theme-primary, #4285f4);
        font-size: 13px;
        text-decoration: none;
    }

    .gf-about-official-link:hover {
        text-decoration: underline;
    }

    .gf-about-link {
        padding: 4px 14px;
        text-decoration: none;
    }

    .gf-about-support {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        padding: 14px 16px;
        border: 1px solid var(--b3-theme-background-light, rgba(0, 0, 0, 0.08));
        border-radius: 8px;
        background-color: var(--b3-theme-background-light, rgba(0, 0, 0, 0.03));
    }

    .gf-about-support-title {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
    }

    .gf-about-support-text {
        margin: 0;
        font-size: 13px;
        line-height: 1.6;
        opacity: 0.85;
    }

    .gf-about-support-btn {
        padding: 6px 18px;
        text-decoration: none;
    }

    /* QR row: side-by-side, wraps on narrow widths. */
    .gf-about-qrs {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        margin-top: 6px;
    }

    .gf-about-qr img {
        display: block;
        width: 170px;
        height: 170px;
        max-width: 100%;
        border-radius: 8px;
        border: 1px solid var(--b3-theme-background-light, rgba(0, 0, 0, 0.12));
    }
</style>
